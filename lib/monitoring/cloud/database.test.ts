import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { IngestBatch } from "../ingestion/types";
import { processingProgressSchema } from "../processing-progress";

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
  it("reports exact queue progress without confusing missing evidence, future days and finished imports",async()=>{
    const employee='cb150000-0000-4000-8000-000000000001';
    await db.query(`insert into public.colaboradores(id,matricula,nome,unidade_id,admissao) values($1,'PROGRESS','Pessoa sintética',(select id from public.unidades limit 1),current_date-90)`,[employee]);
    await db.query(`insert into public.monitoring_results(employee_id,operational_date,input_version,rule_version,result,summary,dirty,reason)
      select $1,current_date-n,1,'synthetic','{}','{"quality":"partial"}',n=1,'Synthetic progress' from generate_series(0,2)n`,[employee]);
    await db.query(`insert into public.monitoring_jobs(employee_id,operational_date,reason) values($1,current_date-1,'Fila sintética'),($1,current_date+1,'Dia futuro')`,[employee]);
    await create("progress-file");
    const input={start:"2020-01-01",end:"2030-01-01",employeeId:employee};
    const day=(await db.query<{date:string}>("select current_date::text date")).rows[0].date;
    input.start=day.slice(0,4)+"-01-01";input.end=day.slice(0,4)+"-12-31";
    const value=processingProgressSchema.parse(await rpc("authenticated",admin,"monitoring_query","progress",input));
    expect(value).toMatchObject({total:3,completed:2,pending:1,deferred:1,limited:2,activeImports:1});
    expect(value.imports).toHaveLength(1);
    const privateView=processingProgressSchema.parse(await rpc("authenticated",reader,"monitoring_query","progress",input));
    expect(privateView.imports).toEqual([]);expect(privateView.activeImports).toBeNull();
    await expect(rpc("authenticated","","monitoring_query","progress",input)).rejects.toThrow("MONITORING_FORBIDDEN");
  });
  async function readinessFixture() {
    const employee='cb140000-0000-4000-8000-000000000001';
    await db.query(`insert into public.colaboradores(id,matricula,nome,unidade_id,admissao)
      values($1,'IMPORT-BOUNDS','Pessoa sintética',(select id from public.unidades limit 1),current_date-90)`,[employee]);
    await db.query(`insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by)
      values('cloud-test','cpf','12345678909',$1,current_date-90,'Vínculo sintético',$2)`,[employee,admin]);
    await db.exec(`insert into public.monitoring_events(source_id,event_key,payload_hash,event_type,identity_type,identity_value,occurred_at,classification,eligible,nsr,payload)
      select 'cloud-test','readiness-'||n,repeat('a',64),'punch','cpf','12345678909',
       ((now() at time zone 'America/Sao_Paulo')::date-n)::timestamp at time zone 'America/Sao_Paulo','authorized',true,lpad(n::text,9,'0'),'{}'
      from unnest(array[0,1,30]) n;
      update public.monitoring_sources set last_success_at=now()-interval '2 hours',worker_state='running',
       configuration=jsonb_build_object('sourceIdentityConfirmed',true,'declaredCoverage',jsonb_build_object('continuous',true,'from',now()-interval '45 days','to',now()+interval '2 days'))
       where id='cloud-test';`);
    await db.query(`insert into public.monitoring_results(employee_id,operational_date,input_version,rule_version,result,summary,reason)
      select $1,((now() at time zone 'America/Sao_Paulo')::date-n),1,'synthetic','{}','{}','synthetic' from unnest(array[0,1,30]) n`,[employee]);
    await db.exec('delete from public.monitoring_jobs');
    return employee;
  }
  it("bounds ordinary source successes while retaining overnight dates and clean historical results",async()=>{
    await readinessFixture();
    await db.exec("update public.monitoring_sources set last_success_at=now() where id='cloud-test'");
    const results=(await db.query<{age:number;dirty:boolean}>(`select (now() at time zone 'America/Sao_Paulo')::date-operational_date age,dirty from public.monitoring_results order by age`)).rows;
    expect(results).toEqual([{age:0,dirty:true},{age:1,dirty:true},{age:30,dirty:false}]);
    expect((await db.query<{n:number}>(`select count(*)::int n from public.monitoring_jobs where operational_date<(now() at time zone 'America/Sao_Paulo')::date-2`)).rows[0].n).toBe(0);
    expect((await db.query<{n:number}>(`select count(*)::int n from public.monitoring_jobs where operational_date=(now() at time zone 'America/Sao_Paulo')::date-1`)).rows[0].n).toBe(1);
  });
  it.each(['initial','configuration','error','recovery','regression'])("preserves broad source invalidation on %s",async(change)=>{
    await readinessFixture();
    if(change==='initial')await db.exec("update public.monitoring_sources set last_success_at=null where id='cloud-test'");
    if(change==='recovery')await db.exec("update public.monitoring_sources set worker_state='error' where id='cloud-test'");
    await db.exec('update public.monitoring_results set dirty=false;delete from public.monitoring_jobs');
    const changes={initial:"last_success_at=now()",configuration:"configuration=configuration||'{\"sourceIdentityConfirmed\":false}'",error:"worker_state='error'",recovery:"worker_state='running'",regression:"last_success_at=now()-interval '1 day'"};
    await db.exec(`update public.monitoring_sources set ${changes[change as keyof typeof changes]} where id='cloud-test'`);
    expect((await db.query<{dirty:boolean}>(`select dirty from public.monitoring_results where operational_date=(now() at time zone 'America/Sao_Paulo')::date-30`)).rows[0].dirty).toBe(true);
    expect((await db.query<{n:number}>(`select count(*)::int n from public.monitoring_jobs where operational_date=(now() at time zone 'America/Sao_Paulo')::date-30`)).rows[0].n).toBe(1);
  });
  it.each(['ended','undeclared'])("does not recreate days when advancing success leaves %s coverage unchanged",async(mode)=>{
    await readinessFixture();
    await db.exec(mode==='ended'
      ? "update public.monitoring_sources set configuration=jsonb_set(configuration,'{declaredCoverage,to}',to_jsonb(now()-interval '3 days')) where id='cloud-test'"
      : "update public.monitoring_sources set configuration=configuration-'declaredCoverage' where id='cloud-test'");
    await db.exec("update public.monitoring_results set dirty=false;delete from public.monitoring_jobs;update public.monitoring_sources set last_success_at=now() where id='cloud-test'");
    expect((await db.query('select count(*)::int n from public.monitoring_jobs')).rows[0]).toEqual({n:0});
    expect((await db.query('select count(*)::int n from public.monitoring_results where dirty')).rows[0]).toEqual({n:0});
  });

  async function incrementalFixture(kind:'afd'|'defense-access'='afd') {
    const first='cb160000-0000-4000-8000-000000000001',second='cb160000-0000-4000-8000-000000000002';
    const sourceId=kind==='afd'?'cloud-test':'incremental-access';
    const identityType=kind==='afd'?'cpf':'defense';
    if(kind!=='afd')await db.query('insert into public.monitoring_sources(id,kind,identity_namespace) values($1,$2,$1)',[sourceId,kind]);
    await db.query(`insert into public.colaboradores(id,matricula,nome,unidade_id,admissao)
      select id::uuid,matricula,'Pessoa sintética',(select id from public.unidades limit 1),current_date-90
      from(values($1,'INCREMENTAL-A'),($2,'INCREMENTAL-B'))t(id,matricula)`,[first,second]);
    await db.query(`insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by)
      values($1,$2,'12345678909',$3,current_date-90,'Vínculo sintético',$5),($1,$2,'98765432100',$4,current_date-90,'Vínculo sintético',$5)`,[sourceId,identityType,first,second,admin]);
    await db.query(`insert into public.monitoring_settings(kind,target,valid_from,payload,reason,created_by)
      select 'schedule',id::text,current_date-90,'{"name":"Escala sintética","start":"08:00","end":"17:00","days":[0,1,2,3,4,5,6]}','Escala sintética',$1
      from public.colaboradores where id in($2,$3)`,[admin,first,second]);
    await db.query(`update public.monitoring_sources set last_success_at=now()-interval '2 hours',worker_state='running',
      configuration=jsonb_build_object('sourceIdentityConfirmed',true,'declaredCoverage',jsonb_build_object('continuous',true,'from',now()-interval '40 days','to',now()-interval '10 days')) where id=$1`,[sourceId]);
    const today=(await db.query<{date:string}>('select current_date::text as date')).rows[0].date;
    const stamp=(age:number)=>new Date(Date.parse(today+'T11:00:00Z')-age*86400000).toISOString();
    const occurrence=(n:number,age:number,identity='12345678909',seconds=0,precision=60)=>({
      key:'incremental-row-'+n,line:n,payloadHash:hash(`incremental-${n}-${age}-${seconds}-${precision}`),issues:[],original:{},
      event:{key:'incremental-event-'+n,type:kind==='afd'?'punch':'access',identity:{type:identityType,value:identity},
        timestamp:new Date(Date.parse(stamp(age))+seconds*1000).toISOString(),device:sourceId,classification:'authorized',eligible:true,
        nsr:String(n).padStart(9,'0'),precisionSeconds:precision,original:{profile:precision===60?'legacy':'iso',record:'synthetic-'+n}}
    });
    const ingest=async(rows:unknown[],suffix:string)=>{
      const input={...batch(hash(suffix)),source:{...batch().source,id:sourceId,kind,identityNamespace:sourceId},
        batch:{index:0,final:true,totalRows:rows.length,occurrenceCount:rows.length,totalBatches:1},occurrences:rows};
      return (await db.query<{value:Record<string,unknown>}>('select public.monitoring_ingest($1::jsonb) value',[JSON.stringify(input)])).rows[0].value;
    };
    await ingest([occurrence(1,30),occurrence(2,25,'98765432100')],'incremental-initial');
    await db.query(`insert into public.monitoring_results(employee_id,operational_date,input_version,rule_version,result,summary,reason)
      select id,current_date-age,1,'synthetic','{}','{"quality":"valid"}','Resultado sintético preservado'
      from public.colaboradores cross join generate_series(0,40) age where id in($1,$2)`,[first,second]);
    await db.exec('delete from public.monitoring_jobs');
    const pending=async()=>(await db.query<{employee_id:string;age:number}>(`select employee_id,current_date-operational_date age from public.monitoring_jobs order by employee_id,age`)).rows;
    const clear=()=>db.exec('update public.monitoring_results set dirty=false;delete from public.monitoring_jobs');
    return {first,second,sourceId,stamp,occurrence,ingest,pending,clear};
  }
  it.each(['afd','defense-access'] as const)("recalculates only changed employee/day neighbors in mixed %s exports",async(kind)=>{
    const f=await incrementalFixture(kind);
    const old=(await db.query("select id,computed_at,summary from public.monitoring_results where operational_date=current_date-30 and employee_id=$1",[f.first])).rows[0];
    expect(await f.ingest([f.occurrence(1,30),f.occurrence(2,25,'98765432100'),f.occurrence(3,5)],'incremental-overlap')).toMatchObject({newEvents:1,conflicts:0});
    expect(await f.pending()).toEqual([4,5,6].map(age=>({employee_id:f.first,age})));
    expect((await db.query('select count(*)::int n from public.monitoring_results where dirty')).rows[0]).toEqual({n:3});
    expect((await db.query("select id,computed_at,summary from public.monitoring_results where operational_date=current_date-30 and employee_id=$1",[f.first])).rows[0]).toEqual(old);
  });
  it("leaves clean declared coverage unchanged for a duplicate-only export and an exact replay",async()=>{
    const f=await incrementalFixture();
    const rows=[f.occurrence(1,30),f.occurrence(2,25,'98765432100')];
    expect(await f.ingest(rows,'incremental-duplicates')).toMatchObject({newEvents:0,conflicts:0});
    expect(await f.ingest(rows,'incremental-duplicates')).toMatchObject({duplicate:true});
    expect(await f.pending()).toEqual([]);
    expect((await db.query('select count(*)::int n from public.monitoring_results where dirty')).rows[0]).toEqual({n:0});
  });
  it("invalidates refined timestamps and first conflicts once, preserving unrelated duplicate days",async()=>{
    const f=await incrementalFixture();
    expect(await f.ingest([f.occurrence(1,30,'12345678909',37,1),f.occurrence(2,25,'98765432100')],'incremental-refinement')).toMatchObject({newEvents:0,conflicts:0});
    expect(await f.pending()).toEqual([29,30,31].map(age=>({employee_id:f.first,age})));
    await f.clear();
    expect(await f.ingest([f.occurrence(1,30,'12345678909',120,1),f.occurrence(2,25,'98765432100')],'incremental-conflict')).toMatchObject({conflicts:1});
    // A new coverage blocker legitimately revisits the declared coverage for both people.
    expect((await f.pending()).some(row=>row.employee_id===f.second&&row.age===25)).toBe(true);
    await f.clear();
    expect(await f.ingest([f.occurrence(1,30,'12345678909',120,1)],'incremental-conflict-repeated')).toMatchObject({conflicts:1});
    expect(await f.pending()).toEqual([]);
  });
  it("initializes an uncomputed coverage day without recreating clean days",async()=>{
    const f=await incrementalFixture();
    await db.query('delete from public.monitoring_results where employee_id=$1 and operational_date=current_date-20',[f.second]);
    await f.ingest([f.occurrence(1,30)],'incremental-missing');
    expect(await f.pending()).toEqual([{employee_id:f.second,age:20}]);
  });
  it("does not restart a queued or leased dirty day when an unchanged export completes",async()=>{
    const f=await incrementalFixture();
    await db.query('update public.monitoring_results set dirty=true where employee_id=$1 and operational_date=current_date-20',[f.second]);
    await db.query(`insert into public.monitoring_jobs(employee_id,operational_date,reason,lease_token,leased_until)
      values($1,current_date-20,'Trabalho em andamento',gen_random_uuid(),now()+interval '5 minutes')`,[f.second]);
    const before=(await db.query('select * from public.monitoring_jobs')).rows;
    await f.ingest([f.occurrence(1,30)],'incremental-already-queued');
    expect((await db.query('select * from public.monitoring_jobs')).rows).toEqual(before);
  });
  it("revisits absence evidence when a completed file resolves a previous unreadable attempt",async()=>{
    const f=await incrementalFixture();
    await db.query("update public.monitoring_files set completed_at=now()-interval '2 hours' where source_id=$1",[f.sourceId]);
    await db.query("insert into public.monitoring_attempts(source_id,relative_path,code,created_at) values($1,'synthetic.txt','AFD_INCOMPLETE_LAST_RECORD',now()-interval '1 hour')",[f.sourceId]);
    await f.clear();
    await f.ingest([f.occurrence(1,30)],'incremental-recovery');
    expect((await f.pending()).some(row=>row.employee_id===f.second&&row.age===20)).toBe(true);
  });
  it("avoids redundant job writes but revokes a leased calculation on every invalidation",async()=>{
    const employee=await readinessFixture();
    await db.exec("select private.monitoring_enqueue_before_attendance(null,null,null,'cloud-test')");
    await db.exec(`create temporary table import_job_writes(n integer);insert into import_job_writes values(0);
      create function pg_temp.count_import_job_write() returns trigger language plpgsql as $$begin update import_job_writes set n=n+1;return new;end$$;
      create trigger count_import_job_write after update on public.monitoring_jobs for each row execute function pg_temp.count_import_job_write();`);
    await db.exec("select private.monitoring_enqueue_before_attendance(null,null,null,'cloud-test')");
    expect((await db.query<{n:number}>('select n from import_job_writes')).rows[0].n).toBe(0);
    await db.query(`update public.monitoring_jobs set lease_token=gen_random_uuid(),leased_until=now()+interval '5 minutes'
      where employee_id=$1 and operational_date=(now() at time zone 'America/Sao_Paulo')::date`,[employee]);
    await db.exec("update import_job_writes set n=0;select private.monitoring_enqueue_before_attendance(null,null,null,'cloud-test')");
    expect((await db.query<{n:number}>('select n from import_job_writes')).rows[0].n).toBe(1);
    expect((await db.query<{lease_token:string|null;leased_until:string|null}>(`select lease_token,leased_until from public.monitoring_jobs where employee_id=$1 and operational_date=(now() at time zone 'America/Sao_Paulo')::date`,[employee])).rows[0]).toEqual({lease_token:null,leased_until:null});
  });
  it("keeps duplicate punch probes on the unique NSR index as clock history grows",async()=>{
    await db.exec(`insert into public.monitoring_events(source_id,event_key,payload_hash,event_type,identity_type,identity_value,occurred_at,classification,eligible,nsr,payload)
      select 'cloud-test','index-'||n,repeat('a',64),'punch','cpf','12345678909',now(),'authorized',true,lpad(n::text,9,'0'),'{}'
      from generate_series(1,1500) n;analyze public.monitoring_events`);
    const definition=(await db.query<{definition:string}>("select pg_get_functiondef('private.monitoring_archive_skip_cold(jsonb,jsonb)'::regprocedure) definition")).rows[0].definition;
    const predicate=definition.match(/duplicate:=not cold and exists\(([\s\S]*?)\n \);/)?.[1];
    expect(predicate).toBeDefined();
    // Explain the helper's actual query, not a separately maintained lookalike.
    const query=predicate!.replaceAll("p_batch#>>'{source,id}'","'cloud-test'").replaceAll("p_row#>>'{event,nsr}'","'999999999'")
      .replaceAll("p_row->>'payloadHash'","repeat('a',64)").replaceAll("p_row->'event'","'{}'::jsonb")
      .replaceAll("p_row#>>'{event,precisionSeconds}'","'1'");
    const result=await db.query<{"QUERY PLAN":unknown}>(`explain(format json) ${query}`);
    expect(JSON.stringify(result.rows)).toContain('monitoring_afd_nsr');
    expect(JSON.stringify(result.rows)).not.toContain('Seq Scan');
  });
  it("keeps separate import and record timestamps for both clocks and facial readers, including after archival",async()=>{
    await db.exec(`insert into public.monitoring_sources(id,kind,identity_namespace,label) values
      ('clock-two','afd','clock-two','Segundo relógio'),('facial','defense-access','facial','Faciais'),('people','defense-person','facial','Cadastros');
      insert into public.monitoring_events(source_id,event_key,payload_hash,event_type,identity_type,identity_value,occurred_at,classification,eligible,payload,nsr) values
      ('cloud-test','point-one',repeat('a',64),'punch','cpf','12345678909','2026-10-20T13:08:00Z','authorized',true,'{}','000000001'),
      ('clock-two','point-two',repeat('b',64),'punch','cpf','12345678909','2026-10-20T13:17:00Z','authorized',true,'{}','000000002'),
      ('facial','face-one',repeat('c',64),'access','defense','1','2026-10-19T02:54:09Z','authorized',true,'{}',null);
      insert into public.monitoring_files(source_id,sha256,byte_length,relative_path,parser_version,status,expected_batches,metadata,completed_at)
      values('cloud-test',repeat('a',64),100,'point.txt','fixture','complete',1,'{}','2026-10-21T14:49:00Z');`);
    const rows=(await administrative('list')).freshness as Array<{sourceId:string;lastImportAt:string|null;lastRecordAt:string|null}>;
    expect(rows).toHaveLength(3);expect(rows.some(row=>row.sourceId==='people')).toBe(false);
    const first=rows.find(row=>row.sourceId==='cloud-test')!;
    expect(Date.parse(first.lastImportAt!)).toBe(Date.parse('2026-10-21T14:49:00Z'));
    expect(Date.parse(first.lastRecordAt!)).toBe(Date.parse('2026-10-20T13:08:00Z'));
    expect(Date.parse(rows.find(row=>row.sourceId==='clock-two')!.lastRecordAt!)).toBe(Date.parse('2026-10-20T13:17:00Z'));
    expect(Date.parse(rows.find(row=>row.sourceId==='facial')!.lastRecordAt!)).toBe(Date.parse('2026-10-19T02:54:09Z'));
    await db.exec("delete from public.monitoring_events;update public.monitoring_sources set heartbeat_at=now(),last_success_at=now();update public.monitoring_files set archived_rows=42");
    expect((await administrative('list')).freshness).toEqual(rows);
    expect((await administrative('list',{},rh)).freshness).toEqual(rows);
    await expect(administrative('list',{},gestor)).rejects.toThrow('CLOUD_FORBIDDEN');
    expect((await db.query<{allowed:boolean}>("select has_table_privilege('authenticated','private.monitoring_import_progress','SELECT') allowed")).rows[0].allowed).toBe(false);
  });
  it("does not treat queued or failed uploads as a completed import or regress on older reexports",async()=>{
    const job=await create('watermark');
    expect((await administrative('list')).freshness).toMatchObject([{lastImportAt:null,lastRecordAt:null}]);
    await db.query("update private.monitoring_cloud_jobs set status='failed',completed_at='2026-10-22T12:00:00Z' where id=$1",[job.id]);
    expect((await administrative('list')).freshness).toMatchObject([{lastImportAt:null}]);
    await db.query("update private.monitoring_cloud_jobs set status='completed',completed_at='2026-10-21T12:00:00Z' where id=$1",[job.id]);
    const last=(await administrative('list')).freshness;
    await db.query("update private.monitoring_cloud_jobs set status='processing',completed_at=null,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '5 minutes' where id=$1",[job.id]);
    expect((await administrative('list')).freshness).toEqual(last);
    await db.query("update private.monitoring_cloud_jobs set status='completed',completed_at='2026-10-20T12:00:00Z',lease_token=null,lease_expires_at=null where id=$1",[job.id]);
    expect((await administrative('list')).freshness).toEqual(last);
  });
  it("waits for queued imports before claiming automatic daily calculations",async()=>{
    const job=await upload(await create('calculation-gate'));
    await db.exec("update private.monitoring_archive_control set active=true where id");
    expect(await rpc('service_role','','monitoring_worker','claim',{sourceIds:['cloud-test'],limit:1})).toMatchObject({jobs:[],waitingForImport:true});
    await db.query("update private.monitoring_cloud_jobs set status='cancelled' where id=$1",[job.id]);
    expect(await rpc('service_role','','monitoring_worker','claim',{sourceIds:['cloud-test'],limit:1})).not.toHaveProperty('waitingForImport');
  });
  it("commits archived cold punches without rehydrating them and retains the frozen replay contract",async()=>{
    const fileHash=hash('archived-full');await upload(await create('archived-full'));const job=await claim();
    await db.query("insert into private.monitoring_archive_objects(path,sha256,bytes,expanded_sha256,expanded_bytes,kind) values('fixture/manifest.gz',$1,20,$1,30,'manifest')",[hash('archive')]);
    await db.query("insert into private.monitoring_archive_files(source_id,sha256,parser_version,manifest_path,rows,punches) values('cloud-test',$1,'monitoring-import/1.0.0','fixture/manifest.gz',2,2)",[fileHash]);
    await db.exec("update private.monitoring_archive_control set active=true where id");
    const occurrence=(n:number,timestamp:string)=>({key:hash('archive-row-'+n),line:n,payloadHash:hash('archive-payload-'+n),issues:[],original:{record:'original'},
      event:{key:hash('archive-event-'+n),type:'punch',identity:{type:'cpf',value:'12345678909'},timestamp,device:'cloud-test',classification:'authorized',eligible:true,nsr:String(n).padStart(9,'0'),precisionSeconds:60,original:{record:'original'}}});
    const value={...batch(fileHash),occurrences:[occurrence(1,'2020-01-01T11:00:00.000Z'),occurrence(2,'2026-10-08T11:00:00.000Z')],batch:{index:0,final:true,totalRows:2,occurrenceCount:2,totalBatches:1}};
    expect(await persist(job,value,plan(1,2))).toMatchObject({result:{fileStatus:'complete'}});
    expect((await db.query("select processed_rows,accepted_rows,archived_rows,new_events from public.monitoring_files where sha256=$1",[fileHash])).rows[0]).toEqual({processed_rows:2,accepted_rows:2,archived_rows:1,new_events:1});
    expect((await db.query("select count(*)::int n from public.monitoring_events where source_id='cloud-test'")).rows[0]).toEqual({n:1});
    expect((await db.query<{payload:unknown}>("select payload from public.monitoring_occurrences")).rows[0].payload).toEqual({event:true,issues:[],originalPreserved:true});
    expect(await persist(job,value,plan(1,2))).toMatchObject({replayed:true});
    await worker('finish',{id:job.id,leaseToken:job.leaseToken});
    const repeatedHash=hash('archived-reexport');await upload(await create('archived-reexport'));const repeatedJob=await claim();
    await db.query("insert into private.monitoring_archive_files(source_id,sha256,parser_version,manifest_path,rows,punches) values('cloud-test',$1,'monitoring-import/1.0.0','fixture/manifest.gz',2,2)",[repeatedHash]);
    await persist(repeatedJob,{...value,file:{...value.file,sha256:repeatedHash}},plan(1,2));
    expect((await db.query("select processed_rows,accepted_rows,archived_rows,new_events,repeated_events from public.monitoring_files where sha256=$1",[repeatedHash])).rows[0]).toEqual({processed_rows:2,accepted_rows:2,archived_rows:2,new_events:0,repeated_events:1});
    expect((await db.query("select count(*)::int n from public.monitoring_occurrences")).rows[0]).toEqual({n:1});
    await expect(db.query("select public.monitoring_ingest($1::jsonb)",[JSON.stringify({...value,file:{...value.file,sha256:hash('direct-cold')},occurrences:[value.occurrences[0]]})])).rejects.toThrow("ARCHIVE_CLOUD_REQUIRED");
  });
  it("freezes Latin-1 for an ISO AFD independently of the document route", async () => {
    await db.exec("insert into private.monitoring_cloud_routes values('afd','iso','cloud-test','cpf')");
    await upload(await create("latin1", admin, { autoDetect: true }));
    const job = await claim();
    const routed = (await worker("route", { id: job.id, leaseToken: job.leaseToken, kind: "afd", afdProfile: "iso", afdIdentityType: "cpf", encoding: "latin1" })).job;
    expect(routed).toMatchObject({ cursor: 0, source: { afdProfile: "iso", encoding: "latin1", afdIdentityType: "cpf" } });
  });

  it("keeps incremental counters exact across resumed batches, overlapping exports and same-NSR conflicts", async () => {
    const occurrence = (n: number, minute = 0) => ({ key: hash('occurrence-'+n), line: n, payloadHash: hash('payload-'+n+'-'+minute), issues: [], original: {},
      event: { key: hash('event-'+n), type: "punch", identity: { type: "cpf", value: "12345678909" }, timestamp: `2026-10-08T11:${String(minute).padStart(2,'0')}:00.000Z`, device: "cloud-test", classification: "authorized", eligible: true, nsr: String(n).padStart(9,'0'), precisionSeconds: 60, original: { profile: "legacy", record: 'record-'+n+'-'+minute } } });
    const ingest = async (rows: unknown[], fileHash: string, index: number, totalRows: number, totalBatches: number) => {
      const value = { ...batch(fileHash,index,totalBatches), occurrences: rows, batch: { index, final: index === totalBatches-1, totalRows, occurrenceCount: totalRows, totalBatches } };
      return (await db.query<{ value: Record<string,unknown> }>("select public.monitoring_ingest($1::jsonb) value", [JSON.stringify(value)])).rows[0].value;
    };
    const firstHash=hash('full-history');
    await ingest([occurrence(1), {key:hash('bad-row'),line:2,payloadHash:hash('bad'),original:{},issues:[{code:'INVALID_CPF_CHECK_DIGIT',severity:'error'}]}],firstHash,0,4,2);
    await ingest([occurrence(2), occurrence(3)],firstHash,1,4,2);
    const before = (await db.query("select processed_rows,accepted_rows,new_events,repeated_events,conflict_rows,rejected_rows,status from public.monitoring_files where sha256=$1",[firstHash])).rows[0];
    expect(before).toEqual({ processed_rows:4,accepted_rows:3,new_events:3,repeated_events:0,conflict_rows:0,rejected_rows:1,status:'complete' });
    expect(await ingest([occurrence(2), occurrence(3)],firstHash,1,4,2)).toMatchObject({duplicate:true});
    expect((await db.query("select processed_rows,accepted_rows,new_events,repeated_events,conflict_rows,rejected_rows,status from public.monitoring_files where sha256=$1",[firstHash])).rows[0]).toEqual(before);
    await ingest([occurrence(1),occurrence(2),occurrence(4)],hash('overlap'),0,3,1);
    expect((await db.query("select processed_rows,new_events,repeated_events,conflict_rows from public.monitoring_files where sha256=$1",[hash('overlap')])).rows[0]).toEqual({processed_rows:3,new_events:1,repeated_events:2,conflict_rows:0});
    await ingest([occurrence(1,1)],hash('conflict'),0,1,1);
    expect((await db.query("select processed_rows,new_events,repeated_events,conflict_rows,status from public.monitoring_files where sha256=$1",[hash('conflict')])).rows[0]).toEqual({processed_rows:1,new_events:0,repeated_events:0,conflict_rows:1,status:'conflict'});
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_events where source_id='cloud-test'")).rows[0].n).toBe(4);
    expect((await db.query("select conflicted,eligible from public.monitoring_events where nsr='000000001'")).rows[0]).toEqual({conflicted:true,eligible:false});
  });

  it("reinspects a completed partial import once, retaining its original and immutable old file", async () => {
    await upload(await create());const job=await claim();await persist(job);let done=(await worker("finish",{id:job.id,leaseToken:job.leaseToken})).job as Job;
    await db.exec("update public.monitoring_files set rejected_rows=4");
    expect(((await administrative("get",{id:job.id})).job as {rejectedRows:number}).rejectedRows).toBe(4);
    await expect(administrative("reinspect",{id:job.id,expectedUpdatedAt:done.updatedAt},reader)).rejects.toThrow("CLOUD_FORBIDDEN");
    const reviewed=(await administrative("reinspect",{id:job.id,expectedUpdatedAt:done.updatedAt})).job as Job&{autoDetect:boolean;reviewVersion:number};
    expect(reviewed).toMatchObject({status:"queued",cursor:0,autoDetect:true,reviewVersion:1});expect(reviewed.objectPath).toBe(done.objectPath);
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_files")).rows[0].n).toBe(1);
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_audit where action='cloud_reinspect'")).rows[0].n).toBe(1);
    done=reviewed;await expect(administrative("reinspect",{id:job.id,expectedUpdatedAt:done.updatedAt})).rejects.toThrow("CLOUD_RETRY_UNAVAILABLE");
  });
  it.each(['cpf','pis'] as const)("discovers a saved %s when its first ordinary AFD batch arrives and preserves replay idempotency",async kind=>{
    const person='cb190000-0000-4000-8000-000000000001';
    const document=kind==='cpf'?'12345678909':'12345678900';
    await db.exec(`update public.monitoring_sources set configuration='{"sourceIdentityConfirmed":true}' where id='cloud-test';
      insert into public.colaboradores(id,matricula,nome,unidade_id,admissao) values('${person}','AUTO-LATER','Pessoa sintética',(select id from public.unidades limit 1),'2026-09-01');`);
    await db.query(`insert into private.employee_identifiers(employee_id,${kind}) values($1,$2)`,[person,document]);
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_bindings")).rows[0].n).toBe(0);
    const occurrence={key:hash('new-doc-row'),line:1,payloadHash:hash('new-doc-event'),issues:[],original:{record:'synthetic'},event:{key:hash('new-doc-event'),type:'punch',identity:{type:kind,value:document},timestamp:'2026-10-02T11:00:00Z',device:'cloud-test',classification:'authorized',eligible:true,nsr:'000000001',precisionSeconds:60,original:{record:'synthetic'}}};
    const input={...batch(hash('new-doc-file')),source:{...batch().source,sourceIdentityConfirmed:true},occurrences:[occurrence],batch:{index:0,final:true,totalRows:1,occurrenceCount:1,totalBatches:1}};
    await db.exec("set local role service_role;select set_config('request.jwt.claim.sub','',true)");
    const ingest=()=>db.query('select public.monitoring_ingest($1::jsonb)',[JSON.stringify(input)]);
    await ingest(); await ingest(); await db.exec('reset role');
    expect((await db.query("select employee_id,origin,created_by,valid_from::text from public.monitoring_bindings")).rows).toEqual([{employee_id:person,origin:'employee_document',created_by:null,valid_from:'2026-09-01'}]);
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_audit where action='employee_document_binding'")).rows[0].n).toBe(1);
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_jobs where employee_id=$1 and operational_date='2026-10-02'",[person])).rows[0].n).toBe(1);
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_events")).rows[0].n).toBe(1);
  });
  it("links only exact canonical HR documents for alternate registrations, with an explicit system origin",async()=>{
    await db.exec(`update public.monitoring_sources set configuration='{"sourceIdentityConfirmed":true}' where id='cloud-test';
      insert into private.monitoring_cloud_routes values('afd','legacy','cloud-test','pis');
      insert into public.colaboradores(id,matricula,nome,unidade_id,admissao) values('cb100000-0000-4000-8000-000000000001','AUTO-1','Pessoa sintética',(select id from public.unidades where codigo='CD I'),'2026-09-01');
      insert into private.employee_identifiers(employee_id,cpf) values('cb100000-0000-4000-8000-000000000001','12345678909');`);
    await upload(await create("mixed-documents",admin,{autoDetect:true}));const job=await claim();
    const routed=(await worker("route",{id:job.id,leaseToken:job.leaseToken,kind:"afd",afdProfile:"legacy",afdIdentityType:"pis",afdAllowAlternate:true,identifiers:[{type:"cpf",value:"12345678909",observedOn:"2026-10-02"}]})).job as Job&{parserVersion:string};
    expect(routed.parserVersion).toBe("monitoring-import/1.0.0/afd-legacy-alternate");
    const link=(await db.query<{origin:string;created_by:string|null}>("select origin,created_by from public.monitoring_bindings where employee_id='cb100000-0000-4000-8000-000000000001'")).rows[0];
    expect(link).toEqual({origin:"cloud_document",created_by:null});
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_audit where action='cloud_document_binding' and actor is null")).rows[0].n).toBe(1);
  });
  it("never recreates a revoked manual binding or attributes an unknown document",async()=>{
    await db.exec(`update public.monitoring_sources set configuration='{"sourceIdentityConfirmed":true}' where id='cloud-test';
      insert into private.monitoring_cloud_routes values('afd','legacy','cloud-test','pis');
      insert into public.colaboradores(id,matricula,nome,unidade_id,admissao) values('cb100000-0000-4000-8000-000000000001','AUTO-1','Pessoa sintética',(select id from public.unidades where codigo='CD I'),'2026-09-01');
      insert into private.employee_identifiers(employee_id,cpf) values('cb100000-0000-4000-8000-000000000001','12345678909');
      insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by,revoked_at)
      values('cloud-test','cpf','12345678909','cb100000-0000-4000-8000-000000000001','2026-09-01','Vínculo sintético revogado','${admin}',now());`);
    await upload(await create("revoked-document",admin,{autoDetect:true}));const job=await claim();
    await worker("route",{id:job.id,leaseToken:job.leaseToken,kind:"afd",afdProfile:"legacy",afdIdentityType:"pis",afdAllowAlternate:true,identifiers:[{type:"cpf",value:"12345678909",observedOn:"2026-10-02"},{type:"cpf",value:"52998224725",observedOn:"2026-10-02"}]});
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_bindings")).rows[0].n).toBe(1);
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_bindings where revoked_at is not null and origin='manual'")).rows[0].n).toBe(1);
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_audit where action='cloud_document_binding'")).rows[0].n).toBe(0);
  });
  it("routes legacy CPF independently from the PIS clock and freezes the CPF parser version", async () => {
    await db.exec("insert into public.monitoring_sources(id,kind,identity_namespace) values('cloud-cpf','afd','cloud-cpf');insert into private.monitoring_cloud_routes values('afd','legacy','cloud-test','pis'),('afd','legacy','cloud-cpf','cpf')");
    await upload(await create("legacy-cpf", admin, { autoDetect: true })); const job = await claim();
    const routed = (await worker("route", { id: job.id, leaseToken: job.leaseToken, kind: "afd", afdProfile: "legacy", afdIdentityType: "cpf" })).job as Job & { sourceId:string; parserVersion:string; source:{afdIdentityType:string;afdProfile:string} };
    expect(routed.sourceId).toBe("cloud-cpf"); expect(routed.parserVersion).toBe("monitoring-import/1.0.0/afd-legacy-cpf");
    expect(routed.source).toMatchObject({afdIdentityType:"cpf",afdProfile:"legacy"}); expect(routed.leaseToken).toBe(job.leaseToken);
  });
  it("preserves one canonical punch across CPF legacy/ISO exports, retains originals and keeps genuine conflicts", async () => {
    async function ingest(format: "legacy" | "iso", suffix: string, timestamp: string) {
      const value = batch(hash(suffix)); value.file.parserVersion = `synthetic-${format}-${suffix}`;
      value.batch.totalRows = 1; value.batch.occurrenceCount = 1;
      value.occurrences = [{ key: `row-${suffix}`, line: 1, payloadHash: hash(`payload-${suffix}`), original: { record: format }, issues: [], event: {
        key: "same-clock-nsr", type: "punch", identity: { type: "cpf", value: "12345678909" }, timestamp,
        device: "cloud-test", classification: "authorized", eligible: true, nsr: "000000001", rawTimestamp: timestamp, rawIdentifier: "012345678909", precisionSeconds: format === "legacy" ? 60 : 1,
        original: { profile: format, record: `${format}-${suffix}` },
      } }];
      return (await db.query<{value:Record<string,unknown>}>("select public.monitoring_ingest($1::jsonb) value",[JSON.stringify(value)])).rows[0].value;
    }
    await ingest("legacy", "legacy-first", "2026-10-02T11:00:00Z");
    expect(await ingest("iso", "iso-refined", "2026-10-02T11:00:37Z")).toMatchObject({ conflicts: 0 });
    expect(await ingest("legacy", "legacy-reexport", "2026-10-02T11:00:00Z")).toMatchObject({ conflicts: 0 });
    const records = (await db.query<{count:number;conflicts:number}>("select count(*)::int count,count(*) filter(where conflicted)::int conflicts from public.monitoring_events")).rows[0];
    expect(records).toEqual({count:1,conflicts:0});
    expect((await db.query<{at:string}>("select occurred_at::text at from public.monitoring_events")).rows[0].at).toContain("08:00:37");
    expect((await db.query<{count:number}>("select count(*)::int count from public.monitoring_occurrences")).rows[0].count).toBe(3);
    expect(await ingest("iso", "real-conflict", "2026-10-02T11:02:00Z")).toMatchObject({ conflicts: 1 });
    expect((await db.query<{conflicted:boolean}>("select conflicted from public.monitoring_events")).rows[0].conflicted).toBe(true);
  });
  it.each(["cpf", "pis"] as const)("discards verified duplicate %s rows before storage, including lower-precision re-exports", async (identityType) => {
    await db.exec("update private.monitoring_archive_control set active=true where id");
    await db.query("insert into private.monitoring_archive_objects(path,sha256,bytes,expanded_sha256,expanded_bytes,kind) values('duplicate/manifest.gz',$1,20,$1,30,'manifest')",[hash('manifest')]);
    async function send(suffix:string,format:"legacy"|"iso",nsr:string,timestamp:string,raw:string) {
      await upload(await create(suffix));const job=await claim();
      const value=batch(hash(suffix));value.batch.totalRows=1;value.batch.occurrenceCount=1;
      value.occurrences=[{key:hash(suffix),line:1,payloadHash:hash(raw),original:{record:raw},issues:[],event:{
        key:hash('clock-'+nsr),type:'punch',identity:{type:identityType,value:identityType==='cpf'?'12345678909':'12044539877'},
        timestamp,device:'cloud-test',classification:'authorized',eligible:true,nsr,rawTimestamp:timestamp,rawIdentifier:'original',
        precisionSeconds:format==='legacy'?60:1,original:{profile:format,record:raw},
      }}];
      await db.query("insert into private.monitoring_archive_files(source_id,sha256,parser_version,manifest_path,rows,punches) values('cloud-test',$1,'monitoring-import/1.0.0','duplicate/manifest.gz',1,1)",[hash(suffix)]);
      const saved=await persist(job,value,plan(1,1));
      expect(await persist(job,value,plan(1,1))).toMatchObject({replayed:true});
      await worker('finish',{id:job.id,leaseToken:job.leaseToken});
      return saved;
    }
    await send('precise','iso','000000001','2026-10-08T11:00:37Z','precise-original');
    await send('same-renamed','iso','000000001','2026-10-08T11:00:37Z','precise-original');
    await send('legacy-overlap','legacy','000000001','2026-10-08T11:00:00Z','legacy-original');
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_events")).rows[0].n).toBe(1);
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_occurrences")).rows[0].n).toBe(1);
    expect((await db.query("select processed_rows,new_events,repeated_events,archived_rows,conflict_rows,status from public.monitoring_files where sha256=$1",[hash('legacy-overlap')])).rows[0])
      .toEqual({processed_rows:1,new_events:0,repeated_events:1,archived_rows:1,conflict_rows:0,status:'complete'});
    const stored=(await db.query<{payload:Record<string,unknown>;logical:Record<string,unknown>}>("select payload,private.monitoring_event_payload(e) logical from public.monitoring_events e")).rows[0];
    expect(stored.payload).toHaveProperty('_monitoringColumns');
    expect(stored.logical).toMatchObject({timestamp:'2026-10-08T11:00:37Z',identity:{type:identityType},original:{record:'precise-original'}});
    await send('new-punch','iso','000000002','2026-10-08T15:00:00Z','new-original');
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_events")).rows[0].n).toBe(2);
    expect(await send('changed-punch','iso','000000001','2026-10-08T11:02:00Z','changed-original')).toMatchObject({result:{conflicts:1}});
    expect((await db.query("select conflicted,eligible from public.monitoring_events where nsr='000000001'")).rows[0]).toEqual({conflicted:true,eligible:false});
    expect((await db.query<{n:number}>("select count(*)::int n from storage.objects where bucket_id='monitoramento-originais'")).rows[0].n).toBe(5);
  });
  it("classifies stored originals under a fenced lease before any ingest", async () => {
    await db.exec("insert into private.monitoring_cloud_routes values('afd','legacy','cloud-test','pis')");
    const draft = await create("automatic", admin, { autoDetect: true });
    expect((draft as Job & { autoDetect: boolean }).autoDetect).toBe(true);
    await upload(draft); const job = await claim();
    await expect(persist(job, batch(hash("automatic")))).rejects.toThrow("CLOUD_DETECTION_REQUIRED");
    await expect(worker("route", { id: job.id, leaseToken: "00000000-0000-4000-8000-000000000000", kind: "afd", afdProfile: "legacy", afdIdentityType: "pis" })).rejects.toThrow("CLOUD_LEASE_LOST");
    const routed = (await worker("route", { id: job.id, leaseToken: job.leaseToken, kind: "afd", afdProfile: "legacy", afdIdentityType: "pis" })).job as Job & { autoDetect: boolean; parserVersion: string };
    expect(routed.autoDetect).toBe(false); expect(routed.parserVersion).toBe("monitoring-import/1.0.0/afd-legacy");
    expect(routed.cursor).toBe(0);
  });
  it("rejects an ambiguous route without changing the frozen job", async () => {
    await db.exec("insert into public.monitoring_sources(id,kind,identity_namespace) values('second-clock','afd','second-clock');insert into private.monitoring_cloud_routes values('afd','legacy','cloud-test','pis'),('afd','legacy','second-clock','pis')");
    await upload(await create("ambiguous", admin, { autoDetect: true })); const job = await claim();
    await expect(worker("route", { id: job.id, leaseToken: job.leaseToken, kind: "afd", afdProfile: "legacy", afdIdentityType: "pis" })).rejects.toThrow("CLOUD_ROUTE_AMBIGUOUS");
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
      } else {
        expect(await token()).toBeNull();
        await reject(() => administrative("retry", { id: failed.id, expectedUpdatedAt: failed.updatedAt }, gestor), "CLOUD_FORBIDDEN");
        expect((await administrative("retry", { id: failed.id, expectedUpdatedAt: failed.updatedAt })).job).toMatchObject({ status: "queued", attempts: 0, cursor: 0 });
      }
    }
  });

  it("expires the fifth crashed attempt into a terminal failure", async () => {
    await upload(await create()); const job = await claim();
    await db.query("update private.monitoring_cloud_jobs set attempts=5,lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [job.id]);
    expect(await token()).toBeNull();
    expect((await administrative("get", { id: job.id })).job).toMatchObject({ status: "failed", lastError: "CLOUD_ATTEMPTS_EXHAUSTED" });
    const failed = (await administrative("get", { id: job.id })).job as Job;
    await reject(() => administrative("retry", { id: failed.id, expectedUpdatedAt: failed.updatedAt }), "CLOUD_RETRY_UNAVAILABLE");
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

  it("defers lifecycle checks during a fenced import and resumes after its lease expires", async () => {
    await upload(await create());
    const job=await claim();
    expect((await db.query<{result:unknown}>("select private.employee_lifecycle_tick() result")).rows[0].result).toMatchObject({busy:true,checked:0,returned:0});
    expect((await administrative("get",{id:job.id})).job).toMatchObject({status:"processing",cursor:0,attempts:job.attempts});
    await db.query("update private.monitoring_cloud_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[job.id]);
    expect((await db.query<{result:unknown}>("select private.employee_lifecycle_tick() result")).rows[0].result).toMatchObject({busy:false});
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
