import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("mantém miniaturas leves, amplia somente a identidade autorizada e grava as duas versões atomicamente", async () => {
  const db = new PGlite();
  const admin = "10000000-0000-4000-8000-000000000001";
  const manager = "10000000-0000-4000-8000-000000000002";
  const employee = "30000000-0000-4000-8000-000000000001";
  const image = (text: string) => ({ mimeType: "image/jpeg", base64: Buffer.from(text).toString("base64"), sha256: createHash("sha256").update(text).digest("hex") });
  const thumbnail = { sourceId: "preview-defense", identityValue: "000123", ...image("small") };
  const preview = image("full-resolution");
  const envelope = (insertOnly = false, full = preview) => ({ photoWithPreview: { thumbnail, preview: full, insertOnly } });
  async function actor(role: "authenticated" | "service_role" | "anon", user = admin) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.exec(`set role ${role}`);
  }
  async function rpc(name: "monitoring_query" | "monitoring_ingest", first: unknown, second?: unknown) {
    const sql = name === "monitoring_ingest" ? "select public.monitoring_ingest($1::jsonb) result" : "select public.monitoring_query($1,$2::jsonb) result";
    return (await db.query<{ result: Record<string, unknown> }>(sql, second === undefined ? [JSON.stringify(first)] : [first, JSON.stringify(second)])).rows[0].result;
  }
  try {
    await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;
      create schema auth;create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
    const directory = path.resolve("supabase/migrations");
    await db.exec(`create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon,authenticated;grant select on storage.objects to anon,authenticated;
      create policy synthetic_permissive_policy on storage.objects for select to anon,authenticated using(true);`);
    for (const file of (await readdir(directory)).filter(file => file.endsWith(".sql")).sort()) await db.exec(await readFile(path.join(directory, file), "utf8"));
    await db.exec(`insert into public.gestores(id,nome) values('20000000-0000-4000-8000-000000000001','Gestor sintético');
      insert into auth.users(id,email,raw_user_meta_data) values
      ('${admin}',encode(sha256(convert_to('00000000001','UTF8')),'hex')||'@auth.administrativo-cd.invalid','{"nome_completo":"Admin sintético","cpf_normalizado":"00000000001"}'),
      ('${manager}',encode(sha256(convert_to('00000000002','UTF8')),'hex')||'@auth.administrativo-cd.invalid','{"nome_completo":"Gestor sintético","cpf_normalizado":"00000000002"}');
      update public.perfis set status_usuario='APROVADO',aprovado_em=now(),papel_usuario=case when id='${admin}' then 'ADMIN'::public.papel_usuario else 'GESTOR'::public.papel_usuario end,
       gestor_id=case when id='${manager}' then '20000000-0000-4000-8000-000000000001'::uuid else null end where id in ('${admin}','${manager}');
      insert into public.colaboradores(id,matricula,nome,unidade_id) values('${employee}','SYN-PHOTO','Pessoa sintética',(select id from public.unidades where codigo='CD I'));
      insert into public.monitoring_sources(id,kind,identity_namespace) values('preview-defense','defense-person','synthetic-preview');
      insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by)
       values('preview-defense','defense','000123','${employee}','2000-01-01','Vínculo sintético confirmado','${admin}');
      insert into public.monitoring_settings(kind,target,valid_from,payload,reason,created_by)
       values('user_link','${employee}','2000-01-01','{"userId":"${admin}"}','Vínculo sintético confirmado','${admin}');`);
    await actor("service_role");
    await expect(rpc("monitoring_ingest", { photoWithPreview: { ...envelope(true).photoWithPreview, expectedThumbnailSha256: thumbnail.sha256 } })).rejects.toThrow("PHOTO_ALREADY_EXISTS");
    expect(await rpc("monitoring_ingest", envelope(true))).toMatchObject({ status: "inserted", previewStored: true });
    expect(await rpc("monitoring_ingest", envelope(true))).toMatchObject({ status: "replayed", previewStored: true });
    await expect(rpc("monitoring_ingest", envelope(true, image("different-original")))).rejects.toThrow("PHOTO_ALREADY_EXISTS");
    await expect(rpc("monitoring_ingest", envelope(false, { ...preview, sha256: "a".repeat(64) }))).rejects.toThrow("PHOTO_PREVIEW_INVALID");
    await actor("authenticated");
    expect(await rpc("monitoring_query", "photo", { employeeId: employee })).toEqual(image("small"));
    expect(await rpc("monitoring_query", "photo", { employeeId: employee, photoVariant: "full" })).toEqual(preview);
    expect(await rpc("monitoring_query", "my_photo", { photoVariant: "full" })).toEqual(preview);
    expect((await db.query<{ photo: unknown }>("select public.monitoring_identity_photo('preview-defense','000123','full') photo")).rows[0].photo).toEqual(preview);
    await db.exec("reset role");
    const stored = { mimeType: "image/jpeg", sha256: preview.sha256, storagePath: `previews/${preview.sha256}.jpg`, byteLength: Buffer.from(preview.base64, "base64").length };
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('monitoramento-fotos',$1,$2::jsonb)", [stored.storagePath, JSON.stringify({ size: stored.byteLength })]);
    await actor("service_role");
    const maintenance = async (action: string, data: unknown = {}) => (await db.query<{ value: Record<string, unknown> }>("select public.monitoring_photo_storage($1,$2::jsonb) value", [action, JSON.stringify(data)])).rows[0].value;
    const before = await maintenance("status");
    const move = { sourceId: thumbnail.sourceId, identityValue: thumbnail.identityValue, thumbnailSha256: thumbnail.sha256, previewThumbnailSha256: thumbnail.sha256, image: stored };
    await expect(maintenance("commit", { ...move, thumbnailSha256: "b".repeat(64) })).rejects.toThrow("PHOTO_STORAGE_STALE");
    expect(await maintenance("commit", move)).toEqual({ ok: true, replayed: false });
    expect(await maintenance("commit", move)).toEqual({ ok: true, replayed: true });
    expect(await maintenance("status")).toMatchObject({ pending: 0, stored: 1, thumbnailProof: before.thumbnailProof, previewProof: before.previewProof });
    expect(await rpc("monitoring_ingest", { photoWithStoredPreview: { thumbnail, preview: stored, insertOnly: true } })).toMatchObject({ previewStorage: true, status: "replayed" });
    await expect(rpc("monitoring_ingest", { photoWithStoredPreview: { thumbnail, preview: { ...stored, byteLength: 1 }, insertOnly: true } })).rejects.toThrow("PHOTO_STORAGE_NOT_VERIFIED");
    await actor("authenticated");
    expect(await rpc("monitoring_query", "photo", { employeeId: employee, photoVariant: "full" })).toEqual(stored);
    expect(await rpc("monitoring_query", "photo", { employeeId: employee })).toEqual(image("small"));
    expect((await db.query<{ photo: unknown }>("select public.monitoring_identity_photo('preview-defense','000123','full') photo")).rows[0].photo).toEqual(stored);
    expect((await db.query("select * from storage.objects")).rows).toEqual([]);
    await expect(maintenance("page")).rejects.toThrow(/permission denied/);
    await expect(db.query("select preview_base64 from public.monitoring_photos")).rejects.toThrow(/permission denied/);
    await expect(rpc("monitoring_ingest", envelope())).rejects.toThrow();
    await actor("authenticated", manager);
    await expect(rpc("monitoring_query", "photo", { employeeId: employee, photoVariant: "full" })).rejects.toThrow();
    await expect(db.query("select public.monitoring_identity_photo('preview-defense','000123','full')")).rejects.toThrow();
    await actor("anon");
    await expect(rpc("monitoring_query", "photo", { employeeId: employee, photoVariant: "full" })).rejects.toThrow();
    await db.exec("reset role");
    const png = image("original-png");
    const original = { mimeType: "image/png", sha256: png.sha256, storagePath: `originals/${png.sha256}.png`, byteLength: Buffer.from(png.base64, "base64").length };
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('monitoramento-fotos',$1,$2::jsonb)", [original.storagePath, JSON.stringify({ size: original.byteLength })]);
    await actor("service_role");
    expect(await maintenance("capabilities")).toMatchObject({photoStorage:true,photoOriginal:true});
    await expect(rpc("monitoring_ingest", {photoWithStoredPreview:{thumbnail,preview:{...original,storagePath:`originals/${png.sha256}.jpg`}}})).rejects.toThrow("PHOTO_STORAGE_INVALID");
    expect(await rpc("monitoring_ingest", {photoWithStoredPreview:{thumbnail,preview:original}})).toMatchObject({previewStored:true,previewStorage:true});
    await actor("authenticated");
    expect(await rpc("monitoring_query", "photo", { employeeId: employee, photoVariant: "full" })).toEqual(original);
    expect(await rpc("monitoring_query", "photo", { employeeId: employee })).toEqual(image("small"));
    await actor("authenticated", manager);
    await expect(rpc("monitoring_query", "photo", { employeeId: employee, photoVariant: "full" })).rejects.toThrow();
    await actor("service_role");
    // Legacy preview uploads remain compatible after a photo has moved to Storage.
    expect(await rpc("monitoring_ingest", envelope())).toMatchObject({ previewStored: true });
    expect(await maintenance("status")).toMatchObject({ pending: 1, stored: 0 });
    await actor("authenticated");
    expect(await rpc("monitoring_query", "photo", { employeeId: employee, photoVariant: "full" })).toEqual(preview);
    await actor("service_role");
    await rpc("monitoring_ingest", { photo: { ...thumbnail, ...image("new-small-from-old-worker") } });
    await actor("authenticated");
    expect(await rpc("monitoring_query", "photo", { employeeId: employee, photoVariant: "full" })).toEqual(image("new-small-from-old-worker"));
  } finally { await db.close(); }
}, 40000);
