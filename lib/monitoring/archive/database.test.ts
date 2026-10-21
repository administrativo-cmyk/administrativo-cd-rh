import { readFile, readdir } from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
let db: PGlite;
async function call(action: string, data: unknown = {}, role = "service_role",fn="monitoring_archive_worker") {
  await db.exec("savepoint archive_call;set role " + role);
  try { return (await db.query<{ value: Record<string, unknown> }>(`select public.${fn}($1,$2::jsonb) value`, [action, JSON.stringify(data)])).rows[0].value; }
  catch (error) { await db.exec("rollback to savepoint archive_call"); throw error; }
  finally { await db.exec("reset role;release savepoint archive_call"); }
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
  await db.exec(`insert into public.monitoring_sources(id,kind,identity_namespace) values('archive-test','afd','archive-test');
   insert into public.monitoring_files(id,source_id,sha256,byte_length,relative_path,parser_version,expected_batches,metadata)
    values('aa110000-0000-4000-8000-000000000001','archive-test',repeat('a',64),100,'test.txt','test',1,'{}');
   insert into public.monitoring_events(id,source_id,event_key,payload_hash,event_type,identity_type,identity_value,occurred_at,classification,eligible,nsr,payload)
    select ('aa120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'archive-test','key-'||n,repeat('a',64),'punch','cpf','12345678909',
    '2026-10-08 08:00-03'::timestamptz+n*interval '1 hour','authorized',true,lpad(n::text,9,'0'),'{}' from generate_series(2,1,-1) n;`);
});
afterEach(async () => { await db.exec("rollback;reset role"); });
describe("server-only frozen archive export", () => {
  it("archives redundant recent AFD references while retaining a canonical reference",async()=>{
    await db.exec(`insert into public.monitoring_occurrences(file_id,occurrence_key,line,payload_hash,event_id,payload)
      select 'aa110000-0000-4000-8000-000000000001',k,1,repeat('a',64),id,'{}'::jsonb from public.monitoring_events cross join(values('a'),('b')) keys(k) where event_key='key-1';
      insert into private.monitoring_archive_objects(path,sha256,bytes,expanded_sha256,expanded_bytes,kind) values('indices/recent.gz',repeat('a',64),20,repeat('a',64),20,'nsr_index');
      insert into private.monitoring_archive_indices values('archive-test',0,'indices/recent.gz',2);
      update private.monitoring_archive_control set active=true;`);
    const page=await call('retention_page');expect(page).toMatchObject({table:'public.monitoring_occurrences',rows:1});
    expect(JSON.parse(String(page.raw)).rows[0].occurrence_key).toBe('b');
    await db.exec("update public.monitoring_events set conflicted=true where event_key='key-1'");
    expect(await call('retention_page')).toMatchObject({rows:0});
  });
  it("defers only a currently fenced job to a bounded future start",async()=>{
    const employee='aa130000-0000-4000-8000-000000000001',token='aa140000-0000-4000-8000-000000000001';
    await db.query("insert into public.colaboradores(id,matricula,nome,unidade_id) values($1,'DEFER-1','Pessoa sintética',(select id from public.unidades where codigo='CD I'))",[employee]);
    await db.query("insert into public.monitoring_jobs(employee_id,operational_date,reason,lease_token,leased_until) values($1,'2026-10-21','Turno ainda não iniciado',$2,clock_timestamp()+interval '5 minutes')",[employee,token]);
    const request={employeeId:employee,date:'2026-10-21',leaseToken:token,until:new Date(Date.now()+3600000).toISOString()};
    await expect(call('defer',{...request,until:new Date(Date.now()+26*3600000).toISOString()},'service_role','monitoring_worker')).rejects.toThrow('MONITORING_DEFER_INVALID');
    expect(await call('defer',request,'service_role','monitoring_worker')).toMatchObject({ok:true});
    expect((await db.query("select lease_token,last_error,leased_until>clock_timestamp() delayed from public.monitoring_jobs")).rows[0]).toEqual({lease_token:null,last_error:'AWAITING_SHIFT_START',delayed:true});
    await expect(call('defer',request,'service_role','monitoring_worker')).rejects.toThrow('MONITORING_LEASE_LOST');
  });
  it("limits individual calculation settings to the employee while keeping shared rules",async()=>{
    const employee='aa130000-0000-4000-8000-000000000001';
    await db.query("insert into public.colaboradores(id,matricula,nome,unidade_id) values($1,'SCOPE-1','Pessoa sintética',(select id from public.unidades where codigo='CD I'))",[employee]);
    await db.query(`insert into public.monitoring_settings(kind,target,valid_from,payload,reason) values
      ('group_snapshot',$1,'2026-10-01','{"groups":["A"],"evidence":"Sintético"}','Grupo sintético'),
      ('group_snapshot','aa130000-0000-4000-8000-000000000002','2026-10-01','{"groups":["B"],"evidence":"Sintético"}','Outro colaborador'),
      ('policy','shared-group','2026-10-01','{"scope":"group","indicator":"outsideOperation","exclude":true}','Regra compartilhada')`,[employee]);
    const input=(await db.query<{v:{settings:Array<{kind:string;target:string}>}}>("select private.monitoring_input($1,'2026-10-08','2026-10-08') v",[employee])).rows[0].v;
    expect(input.settings.map(s=>s.target)).toContain(employee);expect(input.settings.map(s=>s.target)).toContain('shared-group');
    expect(input.settings.map(s=>s.target)).not.toContain('aa130000-0000-4000-8000-000000000002');
  });
  it("finishes bounded day batches atomically and safely replays a lost acknowledgment",async()=>{
    const employee='aa130000-0000-4000-8000-000000000001';
    await db.query("insert into public.colaboradores(id,matricula,nome,unidade_id) values($1,'BACKFILL-1','Pessoa sintética',(select id from public.unidades where codigo='CD I'))",[employee]);
    const jobs=(await db.query<{row:Record<string,unknown>}>(`insert into public.monitoring_jobs(employee_id,operational_date,reason,lease_token,leased_until)
      select $1::uuid,d::date,'Cálculo sintético',gen_random_uuid(),clock_timestamp()+interval '5 minutes' from generate_series('2001-01-01'::date,'2001-01-02'::date,interval '1 day') d
      returning jsonb_build_object('employeeId',employee_id,'date',operational_date,'leaseToken',lease_token,'reason',reason,'version',(select version from private.monitoring_revision),'ruleVersion','test','result','{}'::jsonb,'summary','{}'::jsonb) row`,[employee])).rows.map(r=>r.row);
    const request={id:'aa140000-0000-4000-8000-000000000001',jobs};
    await expect(call('finish_many',{...request,jobs:[jobs[0],{...jobs[1],leaseToken:'aa140000-0000-4000-8000-000000000002'}]},'service_role','monitoring_worker')).rejects.toThrow('MONITORING_LEASE_LOST');
    expect((await db.query('select * from public.monitoring_results')).rows).toHaveLength(0);
    expect(await call('finish_many',request,'service_role','monitoring_worker')).toMatchObject({finished:2});
    expect(await call('finish_many',request,'service_role','monitoring_worker')).toMatchObject({finished:2,replayed:true});
    await expect(call('finish_many',{...request,jobs:[jobs[0]]},'service_role','monitoring_worker')).rejects.toThrow('MONITORING_BATCH_CHANGED');
    await expect(call('finish_many',request,'authenticated','monitoring_worker')).rejects.toThrow(/permission denied/);
    expect((await db.query('select * from public.monitoring_jobs')).rows).toHaveLength(0);
  });
  it("preserves Defense group observations while compacting repeated raw access cells",async()=>{
    const row={original:{large:"raw access cells"},issues:[{severity:"warning",code:"INFO"},{severity:"error",code:"REJECTED"}],event:{identity:{type:"defense",value:"employee"},original:{groups:"T1,T2",name:"Pessoa sintética",other:"raw"}}};
    const compact=(await db.query<{v:typeof row}>("select private.monitoring_archive_compact_payload('defense-access',$1) v",[JSON.stringify(row)])).rows[0].v;
    expect(compact.event.identity).toEqual(row.event.identity);expect(compact.event.original).toEqual({groups:"T1,T2",name:"Pessoa sintética"});
    expect(compact.issues).toEqual([row.issues[1]]);expect(compact).not.toHaveProperty('original');
    expect((await db.query<{v:unknown}>("select private.monitoring_archive_compact_payload('defense-person',$1) v",[JSON.stringify(row)])).rows[0].v).toEqual(row);
  });
  it("removes a rolling page only after its exact cloud proof, keeps originals, and refuses a concurrently changed row",async()=>{
    await db.exec(`update public.monitoring_events set occurred_at='2001-01-01T12:00:00Z' where event_key='key-1';
      insert into public.monitoring_occurrences(file_id,occurrence_key,line,payload_hash,event_id,payload)
       select 'aa110000-0000-4000-8000-000000000001','old',1,repeat('a',64),id,'{}' from public.monitoring_events where event_key='key-1';
      insert into private.monitoring_archive_objects(path,sha256,bytes,expanded_sha256,expanded_bytes,kind) values('indices/retention.gz',repeat('a',64),20,repeat('a',64),20,'nsr_index');
      insert into private.monitoring_archive_indices(source_id,shard,path,rows) values('archive-test',0,'indices/retention.gz',2);
      update private.monitoring_archive_control set active=true;`);
    const page=await call("retention_page");expect(page).toMatchObject({table:"public.monitoring_occurrences",rows:1});
    await expect(call("retention_commit",{path:"missing.gz",raw:page.raw})).rejects.toThrow("ARCHIVE_OBJECT_NOT_STORED");
    const put=async(name:string,p:Record<string,unknown>)=>{
      await db.query(`insert into private.monitoring_archive_objects(path,sha256,bytes,expanded_sha256,expanded_bytes,kind,metadata)
        values($1,repeat('a',64),20,$2,100,'snapshot',$3)`,[name,p.sha256,JSON.stringify({type:"rolling-retention",table:p.table})]);
    };
    await put("retention/old.gz",page);
    await expect(call("retention_commit",{path:"retention/old.gz",raw:String(page.raw)+" "})).rejects.toThrow("ARCHIVE_RESTORE_MISMATCH");
    await db.exec("update public.monitoring_occurrences set conflict=true where occurrence_key='old'");
    expect(await call("retention_commit",{path:"retention/old.gz",raw:page.raw})).toMatchObject({stale:true,ok:false});
    const revised=await call("retention_page");await put("retention/revised.gz",revised);
    await db.exec(`insert into public.monitoring_occurrences(file_id,occurrence_key,line,payload_hash,event_id,payload)
      select file_id,'aaa-new',2,payload_hash,event_id,'{}'::jsonb from public.monitoring_occurrences where occurrence_key='old'`);
    expect(await call("retention_commit",{path:"retention/revised.gz",raw:revised.raw})).toMatchObject({ok:true,rows:1});
    expect(await call("retention_commit",{path:"retention/revised.gz",raw:revised.raw})).toMatchObject({replayed:true});
    expect(await call("retention_page")).toMatchObject({table:"public.monitoring_occurrences",rows:1});
    expect((await db.query("select * from public.monitoring_files")).rows).toHaveLength(1);
  });
  it("rebuilds only the verified working set, rejects changed content, and resumes without truncating restored rows", async () => {
    const run=await call("begin");
    // Storage bytes are verified separately by cloud-store tests; catalog fixtures exercise the SQL gate.
    const addObject=async(name:string,kind:string,metadata:unknown,raw="{}")=>{
      const hash=createHash("sha256").update(raw).digest("hex");
      await db.query(`insert into private.monitoring_archive_objects(path,sha256,bytes,expanded_sha256,expanded_bytes,kind,metadata)
        values($1,$2,20,$2,$3,$4,$5)`,[name,hash,Buffer.byteLength(raw),kind,JSON.stringify(metadata)]);
      return name;
    };
    await expect(call("rebuild_start",{runId:run.runId})).rejects.toThrow("ARCHIVE_REBUILD_INCOMPLETE");
    const rows=(await db.query<{row:Record<string,unknown>}>("select to_jsonb(e) row from public.monitoring_events e order by id limit 1")).rows.map(r=>r.row);
    const raw=JSON.stringify({table:"public.monitoring_events",rows});
    const part=await addObject("rebuild/test/events.gz","snapshot",{type:"working-set",runId:run.runId,table:"public.monitoring_events",rows:1},raw);
    const manifest=await addObject("rebuild/test/manifest.gz","manifest",{type:"working-set",runId:run.runId});
    await db.query("update private.monitoring_archive_snapshots set state='sealed' where id=$1",[run.runId]);
    const index=await addObject("indices/test.gz","nsr_index",{});
    await db.query("insert into private.monitoring_archive_indices(source_id,shard,path,rows) values('archive-test',0,$1,2)",[index]);
    await db.query("insert into private.monitoring_archive_files(source_id,sha256,parser_version,manifest_path,rows,punches) values('archive-test',repeat('a',64),'test',$1,2,2)",[manifest]);
    const tableCounts={"public.monitoring_events":1,"public.monitoring_occurrences":0,"public.monitoring_results":0,"public.monitoring_jobs":0};
    await expect(call("rebuild_plan",{runId:run.runId,manifestPath:manifest,tableCounts:{...tableCounts,"public.monitoring_events":2}})).rejects.toThrow("ARCHIVE_REBUILD_INCOMPLETE");
    await call("rebuild_plan",{runId:run.runId,manifestPath:manifest,tableCounts});
    await call("rebuild_start",{runId:run.runId});
    expect((await db.query("select * from public.monitoring_events")).rows).toHaveLength(0);
    expect((await db.query("select * from public.monitoring_files")).rows).toHaveLength(1);
    await expect(call("activate",{runId:run.runId})).rejects.toThrow("ARCHIVE_RESTORE_INCOMPLETE");
    await expect(call("restore",{runId:run.runId,path:part,raw:raw+" "})).rejects.toThrow("ARCHIVE_RESTORE_MISMATCH");
    expect(await call("restore",{runId:run.runId,path:part,raw})).toMatchObject({ok:true,rows:1});
    expect(await call("rebuild_start",{runId:run.runId})).toMatchObject({resumed:true});
    expect(await call("restore",{runId:run.runId,path:part,raw})).toMatchObject({replayed:true});
    expect((await db.query("select to_jsonb(e) row from public.monitoring_events e")).rows).toEqual(rows.map(row=>({row})));
    expect(await call("activate",{runId:run.runId})).toMatchObject({ok:true,active:true});
    expect(await call("state")).toMatchObject({active:true,maintenance:false});
  });
  it("denies authenticated/anonymous access and protects the bucket even with a broad pre-existing policy", async () => {
    await expect(call("state", {}, "anon")).rejects.toThrow(/permission denied/);
    await expect(call("state", {}, "authenticated")).rejects.toThrow(/permission denied/);
    await db.exec("insert into storage.objects(bucket_id,name,metadata) values('monitoramento-historico','private.gz','{}')");
    await db.exec("set role authenticated");
    expect((await db.query("select * from storage.objects where bucket_id='monitoramento-historico'")).rows).toHaveLength(0);
    await db.exec("reset role");
  });
  it("freezes monitored writes, allows ordered keyset export, and resumes the same run", async () => {
    const run = await call("begin");
    expect(await call("begin")).toMatchObject({ runId: run.runId, resumed: true });
    await db.exec("savepoint frozen_write");
    await expect(db.exec("update public.monitoring_events set conflicted=true")).rejects.toThrow("ARCHIVE_MAINTENANCE");
    await db.exec("rollback to savepoint frozen_write;release savepoint frozen_write");
    const first = await call("page", { runId: run.runId, table: "public.monitoring_events", limit: 1 });
    expect(first.rows).toHaveLength(1); expect((first.rows as {event_key:string}[])[0].event_key).toBe("key-1");
    const second = await call("page", { runId: run.runId, table: "public.monitoring_events", limit: 1, after: first.next });
    expect((second.rows as {event_key:string}[])[0].event_key).toBe("key-2");
    expect(await call("page", { runId: run.runId, table: "public.monitoring_events", after: second.next })).toMatchObject({ rows: [], next: null });
    await expect(call("page", { runId: run.runId, table: "auth.users" })).rejects.toThrow("ARCHIVE_TABLE_FORBIDDEN");
    await expect(call("page", { runId: run.runId, table: "public.monitoring_events", after: {} })).rejects.toThrow("ARCHIVE_CURSOR_INVALID");
  });
  it("rejects a seal before all captured rows are exported", async () => {
    const run = await call("begin");
    await expect(call("seal", { runId: run.runId, manifestPath: "missing.json.gz" })).rejects.toThrow("ARCHIVE_EXPORT_INCOMPLETE");
  });
  it("registers only existing immutable storage objects", async () => {
    const object = { path: "snapshots/test/file.gz", sha256: "a".repeat(64), bytes: 20, expandedSha256: "b".repeat(64), expandedBytes: 50, kind: "snapshot", metadata: {} };
    await expect(call("objects", { objects: [object] })).rejects.toThrow("ARCHIVE_OBJECT_NOT_STORED");
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('monitoramento-historico',$1,'{\"size\":20}')", [object.path]);
    expect(await call("objects", { objects: [object] })).toMatchObject({ ok: true });
    expect(await call("objects", { objects: [object] })).toMatchObject({ ok: true });
    await expect(call("objects", { objects: [{ ...object, sha256: "c".repeat(64) }] })).rejects.toThrow("ARCHIVE_OBJECT_IMMUTABLE");
  });
  it("restores the emergency queue exactly and adopts it only after the complete checksum matches", async () => {
    const employee="aa130000-0000-4000-8000-000000000001";
    await db.query("insert into public.colaboradores(id,matricula,nome,unidade_id) values($1,'ARCHIVE-1','Pessoa sintética',(select id from public.unidades where codigo='CD I'))",[employee]);
    const row=(await db.query<{row:Record<string,unknown>}>(`select jsonb_build_object('employee_id',$1::uuid,'operational_date','2026-10-08'::date,
     'reason','Fila preservada','created_at','2026-10-20T10:00:00Z'::timestamptz,'lease_token',null,'leased_until',null,'attempts',0,'last_error',null) row`,[employee])).rows[0].row;
    const run=await call("begin");
    await call("restore_queue",{runId:run.runId,rows:[row]});
    await call("restore_queue",{runId:run.runId,rows:[row]});
    await expect(call("restore_queue",{runId:run.runId,rows:[{...row,reason:"Mudança não autorizada"}]})).rejects.toThrow("ARCHIVE_RESTORE_MISMATCH");
    const hash=(await db.query<{hash:string}>("select encode(sha256(convert_to(jsonb_agg(to_jsonb(j) order by employee_id,operational_date)::text,'UTF8')),'hex') hash from public.monitoring_jobs j")).rows[0].hash;
    await expect(call("adopt_queue",{runId:run.runId,rows:1,sha256:"0".repeat(64)})).rejects.toThrow("ARCHIVE_RESTORE_MISMATCH");
    expect(await call("adopt_queue",{runId:run.runId,rows:1,sha256:hash})).toMatchObject({ok:true,rows:1,sha256:hash});
  });
});
