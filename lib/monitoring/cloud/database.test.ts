import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { IngestBatch } from "../ingestion/types";

const admin = "ca100000-0000-4000-8000-000000000001";
const rh = "ca100000-0000-4000-8000-000000000002";
const reader = "ca100000-0000-4000-8000-000000000003";
const gestor = "ca100000-0000-4000-8000-000000000004";
type Job = { id: string; objectPath: string; status: string; updatedAt: string; cursor: number; attempts: number; processedRows: number; leaseToken?: string; leaseVersion?: number; totalBatches: number | null; plan: unknown };
let db: PGlite;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function rpc(role: string, user: string, fn: string, action: string, data: unknown = {}) {
  await db.exec("savepoint rpc_call");
  await db.exec(`set role ${role};`);
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    return (await db.query<{ value: Record<string, unknown> }>(`select public.${fn}($1,$2::jsonb) value`, [action, JSON.stringify(data)])).rows[0].value;
  } catch (error) { await db.exec("rollback to savepoint rpc_call"); throw error; }
  finally { await db.exec("reset role;release savepoint rpc_call"); }
}
const administrative = (action: string, data: unknown = {}, actor = admin) => rpc("authenticated", actor, "monitoring_cloud_admin", action, data);
const worker = (action: string, data: unknown = {}) => rpc("service_role", "", "monitoring_cloud_worker", action, data);
async function create(suffix = "1", actor = admin, overrides: Record<string, unknown> = {}): Promise<Job> {
  return (await administrative("create", { sourceId: "cloud-test", fileName: "synthetic.txt", byteLength: 100,
    sha256: hash(suffix), parserVersion: "monitoring-import/1.0.0", afdProfile: "legacy", ...overrides }, actor)).job as Job;
}
async function upload(job: Job, size = 100): Promise<Job> {
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('monitoramento-originais',$1,jsonb_build_object('size',$2::int))", [job.objectPath, size]);
  return (await administrative("complete", { id: job.id, expectedUpdatedAt: job.updatedAt })).job as Job;
}
async function token(): Promise<string | null> {
  return (await db.query<{ token: string | null }>("select private.monitoring_cloud_issue_dispatch() token")).rows[0].token;
}
async function claim(): Promise<Job> {
  const value = await token(); expect(value).toMatch(/^[a-f0-9]{64}$/);
  return (await worker("claim", { tokenHash: hash(value!) })).job as Job;
}
function plan(totalBatches = 1, occurrenceCount = 0) {
  return { version: 1, parserVersion: "monitoring-import/1.0.0", batchSize: 500, bodyLimitBytes: 4400000, totalBatches, occurrenceCount, layoutHash: hash("synthetic-plan") };
}
function batch(fileHash = hash("1"), index = 0, totalBatches = 1): IngestBatch {
  return { protocolVersion: 1, source: { id: "cloud-test", kind: "afd", timeZone: "America/Sao_Paulo", identityNamespace: "cloud-test", sourceIdentityConfirmed: false },
    file: { sha256: fileHash, byteLength: 100, parserVersion: "monitoring-import/1.0.0", relativePath: "synthetic.txt", issues: [], observedRange: null, metadata: {} },
    batch: { index, final: index === totalBatches - 1, totalRows: 0, occurrenceCount: 0, totalBatches }, occurrences: [] };
}
function persist(job: Job, value: unknown = batch(), layout = plan(), expectedCursor = job.cursor) {
  return worker("persist", { id: job.id, leaseToken: job.leaseToken, expectedCursor, batch: value, plan: layout });
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    create policy legacy_broad_policy on storage.objects for all to anon,authenticated using(true) with check(true);`);
  const directory = path.resolve("supabase/migrations");
  for (const file of (await readdir(directory)).filter(file => file.endsWith(".sql")).sort()) await db.exec(await readFile(path.join(directory, file), "utf8"));
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("begin");
  await db.exec(`insert into auth.users(id,email,raw_user_meta_data)
    select ('ca100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,encode(sha256(convert_to('66555555'||lpad(i::text,3,'0'),'UTF8')),'hex')||'@auth.administrativo-cd.invalid',jsonb_build_object('nome_completo','Cloud fixture '||i,'cpf_normalizado','66555555'||lpad(i::text,3,'0')) from generate_series(1,4) i;
    update public.perfis set status_usuario='APROVADO',papel_usuario=case right(id::text,1) when '1' then 'ADMIN'::public.papel_usuario when '2' then 'RH'::public.papel_usuario when '3' then 'LEITURA'::public.papel_usuario else 'GESTOR'::public.papel_usuario end,aprovado_em=now() where id::text like 'ca100000-%';
    insert into public.monitoring_sources(id,kind,identity_namespace) values('cloud-test','afd','cloud-test');`);
});
afterEach(async () => { await db.exec("rollback;reset role"); });

describe("durable cloud import SQL", () => {
  it("classifies stored originals under a fenced lease before any ingest", async () => {
    await db.exec("insert into private.monitoring_cloud_routes values('afd','legacy','cloud-test')");
    const draft = await create("automatic", admin, { autoDetect: true });
    expect((draft as Job & { autoDetect: boolean }).autoDetect).toBe(true);
    await upload(draft); const job = await claim();
    await expect(persist(job, batch(hash("automatic")))).rejects.toThrow("CLOUD_DETECTION_REQUIRED");
    await expect(worker("route", { id: job.id, leaseToken: "00000000-0000-4000-8000-000000000000", kind: "afd", afdProfile: "legacy" })).rejects.toThrow("CLOUD_LEASE_LOST");
    const routed = (await worker("route", { id: job.id, leaseToken: job.leaseToken, kind: "afd", afdProfile: "legacy" })).job as Job & { autoDetect: boolean; parserVersion: string };
    expect(routed.autoDetect).toBe(false); expect(routed.parserVersion).toBe("monitoring-import/1.0.0/afd-legacy");
    expect(routed.cursor).toBe(0);
  });
  it("rejects an ambiguous route without changing the frozen job", async () => {
    await db.exec("insert into public.monitoring_sources(id,kind,identity_namespace) values('second-clock','afd','second-clock');insert into private.monitoring_cloud_routes values('afd','legacy','cloud-test'),('afd','legacy','second-clock')");
    await upload(await create("ambiguous", admin, { autoDetect: true })); const job = await claim();
    await expect(worker("route", { id: job.id, leaseToken: job.leaseToken, kind: "afd", afdProfile: "legacy" })).rejects.toThrow("CLOUD_ROUTE_AMBIGUOUS");
  });
  it("creates private bucket and confines admin/worker RPCs and raw Storage even with legacy broad policies", async () => {
    const bucket = (await db.query<{ public: boolean; file_size_limit: number }>("select public,file_size_limit from storage.buckets where id='monitoramento-originais'")).rows[0];
    expect(bucket.public).toBe(false); expect(Number(bucket.file_size_limit)).toBe(20971520);
    const privileges = (await db.query<{ admin_anon: boolean; worker_auth: boolean; issue_service: boolean; raw_service: boolean }>(`select
      has_function_privilege('anon','public.monitoring_cloud_admin(text,jsonb)','execute') admin_anon,
      has_function_privilege('authenticated','public.monitoring_cloud_worker(text,jsonb)','execute') worker_auth,
      has_function_privilege('service_role','private.monitoring_cloud_issue_dispatch()','execute') issue_service,
      has_table_privilege('service_role','private.monitoring_cloud_jobs','select') raw_service`)).rows[0];
    expect(Object.values(privileges)).toEqual([false, false, false, false]);
    await create();
    expect((await administrative("list")).automationReady).toBe(false);
    await db.exec("insert into storage.objects(bucket_id,name,metadata) values('monitoramento-originais','private-original','{}'),('other-bucket','visible','{}')");
    await db.exec("set role authenticated");
    expect((await db.query<{ count: number }>("select count(*)::int count from storage.objects")).rows[0].count).toBe(1);
    await db.exec("reset role");
    await reject(async () => {
      await db.exec("set role authenticated");
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('monitoramento-originais','unauthorized','{}')");
    }, "row-level security");
  });

  it("limits roles using current approved profile, while ADMIN and RH can list/create", async () => {
    await create("rh", rh);
    expect((await administrative("list")).total).toBe(1);
    // Expected failures use a savepoint so the fixture transaction remains usable.
    await reject(() => administrative("list", {}, reader), "CLOUD_FORBIDDEN");
    await reject(() => administrative("create", {}, gestor), "CLOUD_FORBIDDEN");
    await db.query("update public.perfis set status_usuario='PENDENTE',papel_usuario=null,aprovado_em=null where id=$1", [rh]);
    await reject(() => administrative("list", {}, rh), "CLOUD_FORBIDDEN");
  });

  it("freezes metadata, deduplicates upload, enforces size/extension and source activity", async () => {
    const job = await create(); expect((await create()).id).toBe(job.id);
    await reject(() => create("1", admin, { byteLength: 101 }), "CLOUD_DUPLICATE_DIFFERENT_SOURCE");
    await reject(() => create("large", admin, { byteLength: 20971521 }), "CLOUD_INVALID_FILE");
    await reject(() => create("extension", admin, { fileName: "a.exe" }), "CLOUD_INVALID_FILE");
    await reject(() => create("traversal", admin, { fileName: "../a.txt" }), "CLOUD_INVALID_FILE");
    await db.exec("update public.monitoring_sources set active=false where id='cloud-test'");
    await reject(() => create("disabled"), "CLOUD_SOURCE_UNAVAILABLE");
  });

  it("requires a real completed Storage object with exact size and permits lost-response complete replay", async () => {
    const job = await create();
    await reject(() => administrative("complete", { id: job.id, expectedUpdatedAt: job.updatedAt }), "CLOUD_UPLOAD_MISSING");
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('monitoramento-originais',$1,'{\"size\":99}')", [job.objectPath]);
    await reject(() => administrative("complete", { id: job.id, expectedUpdatedAt: job.updatedAt }), "CLOUD_UPLOAD_INVALID");
    await db.query("update storage.objects set metadata='{\"size\":100}' where name=$1", [job.objectPath]);
    const saved = await administrative("complete", { id: job.id, expectedUpdatedAt: job.updatedAt });
    expect((saved.job as Job).status).toBe("queued");
    expect((await administrative("complete", { id: job.id, expectedUpdatedAt: job.updatedAt })).job).toEqual(saved.job);
  });

  it("reports an already uploaded object and permits a new submission after cancellation or exhausted failure", async () => {
    const old = await create();
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('monitoramento-originais',$1,'{\"size\":100}')", [old.objectPath]);
    expect(await administrative("create", { sourceId: "cloud-test", fileName: "synthetic.txt", byteLength: 100,
      sha256: hash("1"), parserVersion: "monitoring-import/1.0.0", afdProfile: "legacy" })).toMatchObject({ duplicate: true, uploadPresent: true });
    await administrative("cancel", { id: old.id, expectedUpdatedAt: old.updatedAt });
    const replacement = await create(); expect(replacement.id).not.toBe(old.id); expect(replacement.objectPath).not.toBe(old.objectPath);
    await db.query("update private.monitoring_cloud_jobs set status='failed',attempts=5 where id=$1", [replacement.id]);
    const next = await create(); expect(next.id).not.toBe(replacement.id);
    expect((await db.query<{ count: number }>("select count(*)::int count from private.monitoring_cloud_jobs")).rows[0].count).toBe(3);
  });

  it("issues a token only for work; stores only hash, enforces expiry and one use", async () => {
    expect(await token()).toBeNull(); await upload(await create());
    const raw = (await token())!; expect(await token()).toBeNull();
    const stored = (await db.query<{ token_hash: string }>("select token_hash from private.monitoring_cloud_dispatches")).rows[0].token_hash;
    expect(stored).toBe(hash(raw)); expect(stored).not.toBe(raw);
    const saved = (await worker("claim", { tokenHash: hash(raw) })).job as Job;
    expect(saved.status).toBe("processing"); expect(saved.attempts).toBe(1); expect(await token()).toBeNull();
    await reject(() => worker("claim", { tokenHash: hash(raw) }), "CLOUD_DISPATCH_INVALID");
    await reject(() => worker("claim", { tokenHash: hash("invalid") }), "CLOUD_DISPATCH_INVALID");
  });

  it("rejects expired dispatch tokens and dispatches only one active import", async () => {
    await upload(await create()); await upload(await create("2"));
    const expired = (await token())!;
    await db.query("update private.monitoring_cloud_dispatches set expires_at=clock_timestamp()-interval '1 second' where token_hash=$1", [hash(expired)]);
    await reject(() => worker("claim", { tokenHash: hash(expired) }), "CLOUD_DISPATCH_INVALID");
    await claim(); expect(await token()).toBeNull();
    expect((await db.query<{ count: number }>("select count(*)::int count from private.monitoring_cloud_jobs where status='processing'")).rows[0].count).toBe(1);
  });

  it("persists ingest and cursor atomically, replays identical last batch, and finishes only after completion", async () => {
    await upload(await create()); let job = await claim();
    await reject(() => worker("finish", { id: job.id, leaseToken: job.leaseToken }), "CLOUD_NOT_FINISHED");
    const saved = await persist(job); expect((saved.job as Job).cursor).toBe(1);
    expect((await persist(job)).replayed).toBe(true);
    await reject(() => persist(job, batch(), { ...plan(), layoutHash: hash("changed") }), "CLOUD_PLAN_CHANGED");
    job = (await worker("finish", { id: job.id, leaseToken: job.leaseToken })).job as Job;
    expect(job.status).toBe("completed"); expect(job.leaseToken).toBeUndefined();
    expect((await db.query<{ count: number }>("select count(*)::int count from public.monitoring_batches")).rows[0].count).toBe(1);
  });

  it("rejects different file identity/source/layout without advancing cursor or writing events", async () => {
    await upload(await create()); const job = await claim();
    await reject(() => persist(job, batch(hash("other"))), "CLOUD_BATCH_INVALID");
    await reject(() => persist(job, { ...batch(), source: { ...batch().source, sourceIdentityConfirmed: true } }), "CLOUD_BATCH_INVALID");
    await reject(() => persist(job, batch(), { ...plan(), parserVersion: "changed" }), "CLOUD_PLAN_CHANGED");
    expect(((await administrative("get", { id: job.id })).job as Job).cursor).toBe(0);
    expect((await db.query<{ count: number }>("select count(*)::int count from public.monitoring_files")).rows[0].count).toBe(0);
  });

  it("rolls back ingest side effects if a later occurrence fails, then commits the valid retry once", async () => {
    await upload(await create()); const job = await claim();
    const occurrence = { key: "synthetic-row-1", line: 1, payloadHash: hash("row"), original: {}, issues: [], event: {
      key: "synthetic-punch", type: "punch", identity: { type: "cpf", value: "52998224725" }, timestamp: "invalid-date",
      device: "synthetic-clock", classification: "authorized", eligible: true, nsr: "000000001", rawTimestamp: "", rawIdentifier: "", precisionSeconds: 60, original: {},
    } };
    const bad = { ...batch(), batch: { ...batch().batch, totalRows: 1, occurrenceCount: 1 }, occurrences: [occurrence] };
    await reject(() => persist(job, bad, plan(1, 1)), "invalid input syntax");
    expect((await db.query<{ count: number }>("select count(*)::int count from public.monitoring_files")).rows[0].count).toBe(0);
    expect(((await administrative("get", { id: job.id })).job as Job).cursor).toBe(0);
    const valid = { ...bad, occurrences: [{ ...occurrence, event: { ...occurrence.event, timestamp: "2026-10-17T10:00:00Z" } }] };
    await persist(job, valid, plan(1, 1)); await persist(job, valid, plan(1, 1));
    expect((await db.query<{ count: number }>("select count(*)::int count from public.monitoring_events")).rows[0].count).toBe(1);
    expect(((await administrative("get", { id: job.id })).job as Job).processedRows).toBe(1);
  });

  it("fences expired and cancelled runners; reclaims a crashed lease with a new token", async () => {
    await upload(await create()); const old = await claim();
    await db.query("update private.monitoring_cloud_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [old.id]);
    await reject(() => persist(old), "CLOUD_LEASE_LOST");
    const current = await claim(); expect(current.leaseToken).not.toBe(old.leaseToken); expect(current.attempts).toBe(2);
    expect(current.leaseVersion).toBeGreaterThan(old.leaseVersion!);
    await reject(() => worker("fail", { id: old.id, leaseToken: old.leaseToken, code: "OLD_FAILURE" }), "CLOUD_LEASE_LOST");
    await administrative("cancel", { id: current.id, expectedUpdatedAt: current.updatedAt });
    await reject(() => persist(current), "CLOUD_LEASE_LOST");
  });

  it("normal yields preserve attempt budget and checkpoint across claims", async () => {
    await upload(await create()); let job = await claim();
    const saved = await persist(job, batch(hash("1"), 0, 2), plan(2)); job = saved.job as Job;
    await worker("release", { id: job.id, leaseToken: job.leaseToken });
    job = await claim(); expect(job.cursor).toBe(1); expect(job.attempts).toBe(1);
    expect(job.plan).toEqual(plan(2));
    await persist(job, batch(hash("1"), 1, 2), plan(2));
    expect(((await worker("finish", { id: job.id, leaseToken: job.leaseToken })).job as Job).status).toBe("completed");
  });

  it("retries with backoff and caps failures at five without leaking arbitrary failure text", async () => {
    await upload(await create());
    for (let attempt = 1; attempt <= 5; attempt++) {
      const job = await claim(); expect(job.attempts).toBe(attempt);
      const failed = (await worker("fail", { id: job.id, leaseToken: job.leaseToken, code: "private employee data", retryable: true })).job as Job;
      expect(failed.status).toBe(attempt < 5 ? "queued" : "failed");
      expect((await administrative("get", { id: job.id })).job).toMatchObject({ lastError: "CLOUD_PROCESSING_FAILED" });
      if (attempt < 5) {
        expect(await token()).toBeNull();
        await db.query("update private.monitoring_cloud_jobs set next_retry_at=clock_timestamp()-interval '1 second' where id=$1", [job.id]);
      } else await reject(() => administrative("retry", { id: failed.id, expectedUpdatedAt: failed.updatedAt }), "CLOUD_RETRY_UNAVAILABLE");
    }
  });

  it("expires the fifth crashed attempt into a terminal failure", async () => {
    await upload(await create()); const job = await claim();
    await db.query("update private.monitoring_cloud_jobs set attempts=5,lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [job.id]);
    expect(await token()).toBeNull();
    expect((await administrative("get", { id: job.id })).job).toMatchObject({ status: "failed", lastError: "CLOUD_ATTEMPTS_EXHAUSTED" });
  });

  it("requires current CAS for manual retry and preserves the attempt counter", async () => {
    await upload(await create()); const job = await claim();
    const failed = (await worker("fail", { id: job.id, leaseToken: job.leaseToken, code: "SYNTHETIC_PARSE_FAILED", retryable: false })).job as Job;
    await reject(() => administrative("retry", { id: job.id, expectedUpdatedAt: job.updatedAt }), "CLOUD_STALE");
    expect((await administrative("retry", { id: failed.id, expectedUpdatedAt: failed.updatedAt })).job).toMatchObject({ status: "queued", attempts: 1 });
    expect((await claim()).attempts).toBe(2);
  });

  it("fails a queued job when its source is disabled before claim", async () => {
    const job = await upload(await create());
    await db.exec("update public.monitoring_sources set active=false where id='cloud-test'");
    const raw = await token();
    expect(await worker("claim", { tokenHash: hash(raw!) })).toEqual({ job: null, reprocess: false });
    expect((await administrative("get", { id: job.id })).job).toMatchObject({ status: "failed", lastError: "CLOUD_SOURCE_CHANGED", attempts: 0 });
  });

  it("keeps existing ingested file deduplication when the same source file is uploaded", async () => {
    // The existing RPC has a one-argument signature; call it as a real service invocation.
    await db.exec("set role service_role");
    await db.query("select public.monitoring_ingest($1::jsonb)", [JSON.stringify(batch())]);
    await db.exec("reset role");
    await upload(await create()); const job = await claim();
    const saved = await persist(job); expect(saved.result).toMatchObject({ duplicate: true });
    expect((await db.query<{ count: number }>("select count(*)::int count from public.monitoring_batches")).rows[0].count).toBe(1);
  });

  it("validates source changes again before every write and refuses stale cancel revisions", async () => {
    const initial = await upload(await create()); const job = await claim();
    await reject(() => administrative("cancel", { id: job.id, expectedUpdatedAt: initial.updatedAt }), "CLOUD_STALE");
    await db.exec("update public.monitoring_sources set configuration='{\"sourceIdentityConfirmed\":true}' where id='cloud-test'");
    await reject(() => persist(job), "CLOUD_SOURCE_CHANGED");
    expect(((await administrative("get", { id: job.id })).job as Job).cursor).toBe(0);
  });

  it("counts retained cancelled files in storage quota and caps outstanding uploads", async () => {
    for (let i = 0; i < 10; i++) await create(`quota-${i}`);
    await reject(() => create("quota-over"), "CLOUD_QUOTA");
    await db.exec("update private.monitoring_cloud_jobs set status='cancelled',byte_length=20971520");
    for (let i = 0; i < 15; i++) {
      const job = await create(`stored-${i}`, admin, { byteLength: 20971520 });
      await administrative("cancel", { id: job.id, expectedUpdatedAt: job.updatedAt });
    }
    await reject(() => create("storage-over"), "CLOUD_QUOTA");
    // Expired, unused upload reservations release capacity; signed tokens have a three-hour grace.
    await db.exec("update private.monitoring_cloud_jobs set updated_at=clock_timestamp()-interval '4 hours' where status='cancelled'");
    expect((await db.query<{ bytes: number }>("select private.monitoring_cloud_reserved_bytes() bytes")).rows[0].bytes).toBe(0);
    const fresh = await create("storage-after-grace");
    await administrative("cancel", { id: fresh.id, expectedUpdatedAt: fresh.updatedAt });
    await db.exec("insert into storage.objects(bucket_id,name,metadata) select 'monitoramento-originais',object_path,jsonb_build_object('size',byte_length) from private.monitoring_cloud_jobs where byte_length=20971520");
    await reject(() => create("actual-storage-over"), "CLOUD_QUOTA");
  });

  it("caps the global active queue even when another administrator has a free personal quota", async () => {
    const template = await create();
    await db.query(`insert into private.monitoring_cloud_jobs(source_id,source,source_contract,file_name,object_path,byte_length,sha256,parser_version,created_by)
      select j.source_id,j.source,j.source_contract,j.file_name,gen_random_uuid()::text||'/original',1,encode(sha256(convert_to('global-'||i,'UTF8')),'hex'),j.parser_version,j.created_by
      from private.monitoring_cloud_jobs j cross join generate_series(1,99) i where j.id=$1`, [template.id]);
    await reject(() => create("global-over", rh), "CLOUD_QUOTA");
  });

  it.each(["revoked", "disabled"])("dispatches pending recalculation after the last source evidence is %s", async (state) => {
    await db.exec(`insert into public.colaboradores(id,matricula,nome,unidade_id) values('ca200000-0000-4000-8000-000000000001','CLOUD1','Synthetic recalculation',(select id from public.unidades where codigo='CD I'));
      insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by)
      values('cloud-test','cpf','52998224725','ca200000-0000-4000-8000-000000000001','2026-10-01','Synthetic historical binding','${admin}');
      insert into public.monitoring_jobs(employee_id,operational_date,reason) values('ca200000-0000-4000-8000-000000000001','2026-10-17','Synthetic removal invalidation');`);
    if (state === "revoked") await db.exec("update public.monitoring_bindings set revoked_at=clock_timestamp() where source_id='cloud-test'");
    else await db.exec("update public.monitoring_sources set active=false where id='cloud-test'");
    const raw = await token(); expect(raw).toMatch(/^[a-f0-9]{64}$/);
    expect(await worker("claim", { tokenHash: hash(raw!) })).toEqual({ job: null, reprocess: true });
  });

  it("installs one named schedule and sends a bounded one-use dispatch only when work exists", async () => {
    // Hosted extensions are replaced with deterministic SQL doubles; no external HTTP occurs.
    await db.exec(`create schema cron;create schema net;
      create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,schedule text,active boolean default true,command text);
      create function cron.schedule(job_name text,cron_schedule text,command_text text) returns bigint language sql as $$
       insert into cron.job(jobname,schedule,command) values(job_name,cron_schedule,command_text) on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid$$;
      create table net.test_requests(id bigint generated always as identity primary key,url text,headers jsonb,body jsonb,timeout_ms integer);
      create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$
       insert into net.test_requests(url,headers,body,timeout_ms) values(url,headers,body,timeout_milliseconds) returning id$$;`);
    const activation = (await readFile(path.resolve("supabase/cloud-monitoring-cron.sql"), "utf8"))
      .replace(/^create extension[^\n]*$/gm, "").replace(/^(?:begin|commit);$/gm, "");
    await db.exec(activation); await db.exec(activation);
    expect((await administrative("list")).automationReady).toBe(true);
    await db.exec("update cron.job set active=false where jobname='monitoring-cloud-dispatch'");
    expect((await administrative("list")).automationReady).toBe(false);
    await db.exec("update cron.job set active=true where jobname='monitoring-cloud-dispatch'");
    expect((await db.query<{ count: number }>("select count(*)::int count from cron.job")).rows[0].count).toBe(1);
    expect((await db.query<{ id: number | null }>("select private.monitoring_cloud_dispatch_tick() id")).rows[0].id).toBeNull();
    await upload(await create());
    await db.query("select private.monitoring_cloud_dispatch_tick()"); await db.query("select private.monitoring_cloud_dispatch_tick()");
    const requests = (await db.query<{ url: string; headers: Record<string, string>; body: unknown; timeout_ms: number }>("select url,headers,body,timeout_ms from net.test_requests")).rows;
    expect(requests).toHaveLength(1); expect(requests[0].url).toBe("https://administrativo-cd-rh.vercel.app/api/monitoring/cloud/run");
    expect(requests[0].timeout_ms).toBe(240000); expect(requests[0].body).toEqual({});
    expect(requests[0].headers.Authorization).toMatch(/^Bearer [a-f0-9]{64}$/);
    expect((await worker("claim", { tokenHash: hash(requests[0].headers.Authorization.slice(7)) })).job).toMatchObject({ status: "processing" });
  });
});

async function reject(operation: () => Promise<unknown>, expected: string) {
  await db.exec("savepoint expected_failure");
  try { await expect(operation()).rejects.toThrow(expected); }
  finally { await db.exec("rollback to savepoint expected_failure;release savepoint expected_failure;reset role"); }
}
