import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { batchPreviewSchema } from "./daily-call-operations";
const user = (n: number) => `cd000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const employee = (n: number) => `cd100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const manager = (n: number) => `cd200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite; let pdf: string;
async function rpc<T = Record<string, unknown>>(fn: string, action: string, data: unknown): Promise<T> {
 return (await db.query<{ value: T }>(`select public.${fn}($1,$2::jsonb) value`, [action, JSON.stringify(data)])).rows[0].value;
}
async function asUser(n: number) { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user(n)]); await db.exec("set role authenticated"); }
async function batch(items: Array<{ employeeId: string; date: string; status: string; observation: string | null }>, mode = "fill_blank") {
 const data = { mode, reason: "Revisão sintética conferida", items };
 const preview = batchPreviewSchema.parse(await rpc("daily_call_batch", "preview", data));
 return { data, preview, apply: () => rpc("daily_call_batch", "apply", { ...data, expectedVersion: preview.version }) };
}
const item = (n: number, date = "2026-10-10", status = "G") => ({ employeeId: employee(n), date, status, observation: "Justificativa sintética" });
async function upload(n = 1, date = "2026-10-10", suffix = "", content = pdf) {
 await db.exec("reset role; set role service_role");
 try { return (await db.query<{ value: { id: string; updatedAt: string } }>("select public.daily_call_attachment_upload($1::uuid,$2::jsonb) value", [user(1), JSON.stringify({ employeeId: employee(n), date, fileName: `evidencia${suffix}.pdf`, mediaType: "application/pdf", content, description: "Documento sintético conferido" })])).rows[0].value; }
 finally { await asUser(1); }
}
beforeAll(async () => {
 db = new PGlite();
 await db.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
 for (const file of (await readdir(path.resolve("supabase/migrations"))).filter(name => name.endsWith(".sql")).sort()) await db.exec(await readFile(path.resolve("supabase/migrations", file), "utf8"));
 await db.exec(`insert into public.gestores(id,nome) values('${manager(1)}','Equipe teste 1'),('${manager(2)}','Equipe teste 2');
  insert into public.colaboradores(id,matricula,nome,unidade_id,gestor_id,admissao) select ('cd100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'BATCH-'||i,'Pessoa sintética '||i,(select id from public.unidades limit 1),'${manager(1)}','2026-01-01' from generate_series(1,8) i;
  insert into public.banco_horas_medicoes(colaborador_id,data_medicao,aplica_a_partir_de,jornada_horas_dia,saldo_minutos) select id,'2026-10-01','2026-10-01',8,960 from public.colaboradores where matricula like 'BATCH-%';
  insert into auth.users(id,email,raw_user_meta_data) select ('cd000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,encode(sha256(convert_to('77777777'||lpad(i::text,3,'0'),'UTF8')),'hex')||'@auth.administrativo-cd.invalid',jsonb_build_object('nome_completo','Usuário sintético '||i,'cpf_normalizado','77777777'||lpad(i::text,3,'0')) from generate_series(1,4) i;
  update public.perfis set status_usuario='APROVADO',papel_usuario=case right(id::text,1) when '1' then 'ADMIN'::public.papel_usuario when '2' then 'GESTOR'::public.papel_usuario else 'LEITURA'::public.papel_usuario end,gestor_id=case right(id::text,1) when '2' then '${manager(2)}'::uuid end,aprovado_em=now() where id::text like 'cd000000-%';`);
 const document = await PDFDocument.create(); document.addPage(); pdf = Buffer.from(await document.save()).toString("base64");
 await asUser(1);
}, 90000);
afterAll(async () => { await db?.close(); });
describe("Chamada: lote atômico e evidências privadas", () => {
 it("prévia não grava; aplicação G consome uma vez e repetição desatualizada é recusada", async () => {
  const selected = await batch([item(1), item(2)]); expect(selected.preview.eligible).toBe(2);
  expect(selected.preview.rows.every(row=>row.currentStatus===null)).toBe(true);
  await db.exec("reset role");
  expect((await db.query<{count:number}>("select count(*)::integer count from public.chamada_diaria where colaborador_id in ($1,$2) and data='2026-10-10'",[employee(1),employee(2)])).rows[0].count).toBe(0);
  await asUser(1);
  expect(await selected.apply()).toMatchObject({ changed: 2, reviewed: 2 });
  await expect(selected.apply()).rejects.toThrow("BATCH_STALE");
  await (await batch([item(1)],"replace")).apply();
  await db.exec("reset role");
  const balance = await db.query<{ days: number }>("select dias_g_ciclo days from private.banco_horas_no_dia($1,'2026-10-10')", [employee(1)]); expect(balance.rows[0].days).toBe(1);
  await asUser(1);
 });
 it("preserva existentes em preencher vazios e substitui apenas no modo explícito", async () => {
  const blank = await batch([item(1, "2026-10-10", "P")]); expect(blank.preview.eligible).toBe(0);
  expect(await blank.apply()).toMatchObject({ changed: 0, skipped: 1 });
  const replace = await batch([item(1, "2026-10-10", "P")], "replace"); expect(await replace.apply()).toMatchObject({ changed: 1 });
 });
 it("uma mudança concorrente recusa o lote inteiro", async () => {
  const selected = await batch([item(3), item(4)]);
  await (await batch([item(4, "2026-10-10", "P")])).apply();
  await expect(selected.apply()).rejects.toThrow("BATCH_STALE");
  const current = await batch([item(3)]); expect(current.preview.rows[0].currentStatus).toBeNull();
 });
 it("barra outro gestor, leitura, duplicação e período inválido", async () => {
  await asUser(2); await expect(batch([item(1)])).rejects.toThrow("BATCH_FORBIDDEN");
  await asUser(3); await expect(batch([item(1)])).rejects.toThrow("BATCH_FORBIDDEN");
  await asUser(1); await expect(batch([item(1), item(1)])).rejects.toThrow("BATCH_DUPLICATE");
  await expect(batch([item(1, "2026-09-01"), item(2, "2026-10-10")])).rejects.toThrow("BATCH_PERIOD");
 });
 it("recusa prévia depois de transferência de equipe", async () => {
  const selected = await batch([item(5)]);
  await db.exec("reset role"); await db.query("update public.colaboradores set gestor_id=$1 where id=$2", [manager(2), employee(5)]); await asUser(1);
  await expect(selected.apply()).rejects.toThrow("BATCH_STALE");
 });
 it("upload exige canal validado; download e arquivo respeitam escopo e CAS", async () => {
  await expect(rpc("daily_call_attachments", "upload", {})).rejects.toThrow("ATTACHMENT_VALIDATED_UPLOAD_REQUIRED");
  const file = await upload();
  expect(await rpc("daily_call_attachments", "download", { id: file.id })).toMatchObject({ mediaType: "application/pdf" });
  await asUser(2); await expect(rpc("daily_call_attachments", "download", { id: file.id })).rejects.toThrow("ATTACHMENT_FORBIDDEN");
  await asUser(3); await expect(rpc("daily_call_attachments", "archive", { id: file.id, expectedUpdatedAt: file.updatedAt, reason: "Motivo sintético" })).rejects.toThrow("ATTACHMENT_FORBIDDEN");
  await expect(rpc("daily_call_attachments", "download", { id: file.id })).rejects.toThrow("ATTACHMENT_FORBIDDEN");
  await expect(rpc("daily_call_attachments", "list", { employeeId: employee(1), date: "2026-10-10" })).rejects.toThrow("ATTACHMENT_FORBIDDEN");
  await asUser(1); const archived = await rpc("daily_call_attachments", "archive", { id: file.id, expectedUpdatedAt: file.updatedAt, reason: "Motivo sintético" });
  await expect(rpc("daily_call_attachments", "download", { id: file.id })).rejects.toThrow("ATTACHMENT_FORBIDDEN");
  await expect(rpc("daily_call_attachments", "restore", { id: file.id, expectedUpdatedAt: file.updatedAt, reason: "Motivo sintético" })).rejects.toThrow("ATTACHMENT_STALE");
  await rpc("daily_call_attachments", "restore", { id: file.id, expectedUpdatedAt: archived.updatedAt, reason: "Motivo sintético" });
  await expect(upload()).rejects.toThrow("ATTACHMENT_DUPLICATE");
 });
 it("exige lançamento e impede acesso direto às tabelas/conteúdo", async () => {
  await expect(upload(8)).rejects.toThrow("ATTACHMENT_ATTENDANCE_REQUIRED");
  await expect(db.query("select content from private.daily_call_attachments")).rejects.toThrow();
  await expect(db.query("select public.daily_call_attachment_upload($1,'{}')", [user(1)])).rejects.toThrow();
  await expect(db.query("select private.daily_call_attachment_internal('upload','{}',$1,true)",[user(1)])).rejects.toThrow();
  await db.exec("reset role");
  const privileges=await db.query<{anon:boolean;authenticated:boolean;service:boolean;internal:boolean}>("select has_function_privilege('anon','public.daily_call_attachment_upload(uuid,jsonb)','execute') anon,has_function_privilege('authenticated','public.daily_call_attachment_upload(uuid,jsonb)','execute') authenticated,has_function_privilege('service_role','public.daily_call_attachment_upload(uuid,jsonb)','execute') service,has_function_privilege('service_role','private.daily_call_attachment_internal(text,jsonb,uuid,boolean)','execute') internal");
  expect(privileges.rows[0]).toEqual({anon:false,authenticated:false,service:true,internal:false});
  await asUser(1);
 });
 it("canal privilegiado revalida papel e equipe atuais do ator",async()=>{
  const data={employeeId:employee(1),date:"2026-10-10",fileName:"evidencia.pdf",mediaType:"application/pdf",content:pdf,description:"Prova sintética"};
  await db.exec("reset role; set role service_role");
  await expect(db.query("select public.daily_call_attachment_upload($1,$2::jsonb)",[user(2),JSON.stringify(data)])).rejects.toThrow("ATTACHMENT_FORBIDDEN");
  await expect(db.query("select public.daily_call_attachment_upload($1,$2::jsonb)",[user(3),JSON.stringify(data)])).rejects.toThrow("ATTACHMENT_FORBIDDEN");
  await asUser(1);
 });
 it("cotas incluem versões arquivadas e restauração respeita cinco ativos", async () => {
  await (await batch([item(6)])).apply();
  const files: Array<{ id: string; updatedAt: string }> = [];
  const bytes = (n: number) => Buffer.concat([Buffer.from(pdf,"base64"),Buffer.from(`\n%fixture ${n}`)]).toString("base64");
  const archive = (row: { id: string; updatedAt: string }) => rpc("daily_call_attachments","archive",{ id: row.id, expectedUpdatedAt: row.updatedAt, reason: "Versão sintética substituída" });
  for(let i=0;i<5;i++) files.push(await upload(6,"2026-10-10",String(i),bytes(i)));
  await expect(upload(6,"2026-10-10","6",bytes(6))).rejects.toThrow("ATTACHMENT_QUOTA");
  const archived=await archive(files[0]); files.push(await upload(6,"2026-10-10","5",bytes(5)));
  await expect(rpc("daily_call_attachments","restore",{id:files[0].id,expectedUpdatedAt:archived.updatedAt,reason:"Restaurar versão sintética"})).rejects.toThrow("ATTACHMENT_QUOTA");
  for(const file of files.slice(1)) await archive(file);
  for(let i=6;i<10;i++) await archive(await upload(6,"2026-10-10",String(i),bytes(i)));
  await expect(upload(6,"2026-10-10","11",bytes(11))).rejects.toThrow("ATTACHMENT_QUOTA");
 });
 it("cota de bytes também conta anexos arquivados", async () => {
  await (await batch([item(7)])).apply();
  const original=Buffer.from(pdf,"base64");
  for(let i=0;i<5;i++) {
   const bytes=Buffer.concat([original,Buffer.alloc(2097152-original.length-8,32),Buffer.from(`\n${i}%%EOF`)]);
   const file=await upload(7,"2026-10-10",String(i),bytes.toString("base64"));
   await rpc("daily_call_attachments","archive",{id:file.id,expectedUpdatedAt:file.updatedAt,reason:"Arquivar versão sintética"});
  }
  await expect(upload(7)).rejects.toThrow("ATTACHMENT_QUOTA");
 });
});

describe("Notificações filtradas e operações em lote",()=>{
 type Inbox={rows:Array<{key:string;type:string;updatedAt:string|null;readAt:string|null;body:string}>;total:number;unread:number};
 const inbox=(data:unknown={})=>rpc<Inbox>("workspace","notifications",data);
 it("alertas operacionais respeitam papel, equipe e fonte ativa",async()=>{
  await db.exec("reset role");
  await db.exec(`insert into public.monitoring_sources(id,kind,identity_namespace,label,worker_state,active,heartbeat_at,last_success_at) values('qa-alert-active','afd','qa-alert-active','Fonte sintética ativa','error',true,now(),now()-interval '10 days'),('qa-alert-inactive','afd','qa-alert-inactive','Fonte sintética inativa','error',false,now(),null);
    insert into private.daily_call_decisions(employee_id,operational_date,decision) values('${employee(8)}','2026-10-09','{"state":"pending_manager"}');`);
  await asUser(1); const imports=await inbox({type:"import",query:"sintética"});expect(imports.total).toBe(1);expect(imports.rows[0].body).toContain("não comprova falha do relógio");
  const today=(await db.query<{today:string}>("select (now() at time zone 'America/Sao_Paulo')::date::text today")).rows[0].today;
  expect((await inbox({type:"import",query:"sintética",start:today,end:today})).total).toBe(1);
  expect((await inbox({type:"daily"})).total).toBe(1);
  await asUser(2);expect((await inbox({type:"daily"})).total).toBe(0);expect((await inbox({type:"import"})).total).toBe(0);
  await asUser(3);expect((await inbox({type:"daily"})).total).toBe(0);expect((await inbox({type:"import"})).total).toBe(0);
  await asUser(1);
 });
 it("filtro de texto/período/não lidas e lote CAS são reais",async()=>{
  const notice=await rpc<{id:string}>("workspace","save_notice",{title:"Aviso QA operações",body:"Conteúdo sintético de operações",audienceRole:null,managerId:null,reason:"Comunicado sintético"});
  const filtered=await inbox({type:"notice",query:"QA operações",unreadOnly:true});expect(filtered.total).toBe(1);
  expect((await inbox({type:"notice",query:"QA operações",start:"2001-01-01",end:"2001-02-01"})).total).toBe(0);
  const data={operation:"read",items:filtered.rows.map(row=>({key:row.key,expectedUpdatedAt:row.updatedAt}))};
  await rpc("workspace","notification_state_batch",data);
  expect((await inbox({type:"notice",query:"QA operações",unreadOnly:true})).total).toBe(0);
  await expect(rpc("workspace","notification_state_batch",data)).rejects.toThrow("WORKSPACE_STALE");
  const current=(await inbox({query:"QA operações"})).rows[0];expect(current.key).toContain(notice.id);
  await expect(rpc("workspace","notification_state_batch",{operation:"archive",items:[{key:current.key,expectedUpdatedAt:current.updatedAt},{key:"notice:foreign",expectedUpdatedAt:null}]})).rejects.toThrow("WORKSPACE_NOT_FOUND");
  expect((await inbox({query:"QA operações"})).total).toBe(1);
 });
});
