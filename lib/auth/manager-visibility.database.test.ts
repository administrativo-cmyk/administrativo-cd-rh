import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const user = (n: number) => `ac000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const manager = (n: number) => `ac100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const employee = (n: number) => `ac200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const day = "2026-10-10";
let db: PGlite;
async function asUser(n: number) {
 await db.exec("reset role");
 await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user(n)]);
 await db.exec("set role authenticated");
}
async function value<T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T> {
 return (await db.query<{ value: T }>(`select ${sql} value`, args)).rows[0].value;
}
async function rpc<T = Record<string, unknown>>(name: string, action: string, data = {}): Promise<T> {
 return value<T>(`public.${name}($1,$2::jsonb)`, [action, JSON.stringify(data)]);
}
type User = { id: string; updated_at: string; papel_usuario: string; visualizar_todos_gestores: boolean };
async function edit(n: number, enabled: boolean, role = "GESTOR") {
 const rows = await rpc<User[]>("administration_users", "list");
 const current = rows.find(row => row.id === user(n))!;
 const data = { id: current.id, expectedUpdatedAt: current.updated_at, name: `Pessoa sintética ${n}`, role, managerId: role === "GESTOR" ? manager(1) : null, viewAllManagers: enabled, reason: "Visibilidade conferida pelo responsável" };
 return { data, result: await rpc("administration_users", "save", data) };
}
type Roster = { employees: Array<{ id: string; canWrite?: boolean }> };
async function readCall() { return value<Roster>("public.daily_call_read($1::date,$1::date,$1::date,null)", [day]); }
beforeAll(async () => {
 db = new PGlite();
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;
  create schema auth;create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 for (const file of (await readdir(path.resolve("supabase/migrations"))).filter(name => name.endsWith(".sql")).sort()) {
  await db.exec(await readFile(path.resolve("supabase/migrations", file), "utf8"));
 }
 await db.exec(`insert into public.gestores(id,nome) values('${manager(1)}','Equipe A sintética'),('${manager(2)}','Equipe B sintética');
  insert into public.colaboradores(id,matricula,nome,unidade_id,gestor_id,admissao)
  select ('ac200000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'VIS-'||i,'Colaborador sintético '||i,
   (select id from public.unidades limit 1),case when i<3 then ('ac100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid end,'2026-01-01'
  from generate_series(1,3) i;
  insert into auth.users(id,email,raw_user_meta_data)
  select ('ac000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
   encode(sha256(convert_to('88888888'||lpad(i::text,3,'0'),'UTF8')),'hex')||'@auth.administrativo-cd.invalid',
   jsonb_build_object('nome_completo','Pessoa sintética '||i,'cpf_normalizado','88888888'||lpad(i::text,3,'0')) from generate_series(1,5) i;
  update public.perfis set status_usuario='APROVADO',papel_usuario=case right(id::text,1) when '1' then 'ADMIN'::public.papel_usuario when '2' then 'RH'::public.papel_usuario else 'GESTOR'::public.papel_usuario end,
   gestor_id=case when right(id::text,1) in ('3','4','5') then '${manager(1)}'::uuid end,aprovado_em=now() where id::text like 'ac000000-%';
  insert into public.ferias_planejamento(colaborador_id,inicio,fim,status,created_by) values('${employee(2)}','2026-11-01','2026-11-10','draft','${user(1)}');`);
}, 90000);
afterAll(async () => { await db?.close(); });

describe("GESTOR: visualização global sem ampliação de escrita", () => {
 it("mantém gestores comuns limitados à equipe e recusa autoatribuição", async () => {
  await asUser(3);
  expect((await readCall()).employees.map(row => row.id)).toEqual([employee(1)]);
  expect((await value<Roster>("public.ler_quadro_atual()")).employees.map(row => row.id)).toEqual([employee(1)]);
  expect((await value<Roster>("public.ler_banco_horas_atual($1::date)", [day])).employees.map(row => row.id)).toEqual([employee(1)]);
  await expect(rpc("monitoring_query", "detail", { employeeId: employee(2), start: day, end: day })).rejects.toThrow("MONITORING_FORBIDDEN");
  await expect(rpc("administration_users", "save", {})).rejects.toThrow("USER_EDIT_FORBIDDEN");
  await expect(db.query("update public.perfis set visualizar_todos_gestores=true where id=$1", [user(3)])).rejects.toThrow(/permission denied/);
 });
 it("ADMIN habilita com versão, justificativa e histórico; edição antiga falha", async () => {
  await asUser(1);
  const { data } = await edit(3, true);
  await expect(rpc("administration_users", "save", data)).rejects.toThrow("USER_EDIT_STALE");
  const target = (await rpc<User[]>("administration_users", "list")).find(row => row.id === user(3));
  expect(target).toMatchObject({ papel_usuario: "GESTOR", visualizar_todos_gestores: true });
  await db.exec("reset role");
  const audit = (await db.query<{ before_record: { viewAllManagers: boolean }; after_record: { viewAllManagers: boolean } }>("select before_record,after_record from private.user_edit_audit where user_id=$1 order by id desc limit 1", [user(3)])).rows[0];
  expect(audit.before_record.viewAllManagers).toBe(false);
  expect(audit.after_record.viewAllManagers).toBe(true);
 });
 it("amplia quadro, banco, chamada, filas, monitoramento e férias", async () => {
  await asUser(3);
  expect((await readCall()).employees).toEqual(expect.arrayContaining([
   expect.objectContaining({ id: employee(1), canWrite: true }),
   expect.objectContaining({ id: employee(2), canWrite: false }),
   expect.objectContaining({ id: employee(3), canWrite: false }),
  ]));
  expect((await value<Roster>("public.ler_quadro_atual()")).employees).toHaveLength(3);
  expect((await value<Roster>("public.ler_banco_horas_atual($1::date)", [day])).employees).toHaveLength(3);
  for (const end of [day, "2026-10-11"]) {
   const queue = await rpc<{ rows: Array<{ employeeId: string }> }>("daily_call_workflow", "queue", { start: day, end });
   expect(new Set(queue.rows.map(row => row.employeeId))).toEqual(new Set([employee(1),employee(2),employee(3)]));
  }
  const summary = await rpc<{ options: { managers: Array<{ id: string }> } }>("monitoring_query", "summary", { start: day, end: day, limit: 100 });
  expect(summary.options.managers.map(row => row.id)).toEqual(expect.arrayContaining([manager(1),manager(2)]));
  await expect(rpc("monitoring_query", "detail", { employeeId: employee(2), start: day, end: day })).resolves.toBeDefined();
  expect(await rpc("employee_schedule", "get", { employeeId: employee(2), date: day })).toMatchObject({ canEdit: false });
  expect(await rpc("employee_schedule", "get", { employeeId: employee(3), date: day })).toMatchObject({ canEdit: false });
  const vacation = await value<{ rows: Array<{ employeeId: string; canEdit: boolean }>; options: { employees: unknown[] } }>("public.administration('vacation','list','{}'::jsonb)");
  expect(vacation.rows).toEqual([expect.objectContaining({ employeeId: employee(2), canEdit: false })]);
  expect(vacation.options.employees).toHaveLength(3);
  const planning = await rpc<{ canManage: boolean; options: { employees: Array<{ id: string; canPropose: boolean }> } }>("schedule_planning", "list");
  expect(planning.canManage).toBe(false);
  expect(planning.options.employees).toEqual(expect.arrayContaining([
   expect.objectContaining({ id: employee(1), canPropose: true }),
   expect.objectContaining({ id: employee(2), canPropose: false }),
  ]));
 });
 it("preserva escrita própria e recusa escrita de outras equipes ou sem gestor", async () => {
  await asUser(3);
  await expect(value("public.salvar_chamada_diaria($1::uuid,$2::date,'F',null,null)", [employee(1),day])).resolves.toMatchObject({ changed: true });
  for (const n of [2,3]) {
   await expect(value("public.salvar_chamada_diaria($1::uuid,$2::date,'F',null,null)", [employee(n),day])).rejects.toThrow();
   await expect(rpc("employee_schedule", "save", { employeeId: employee(n), date: day })).rejects.toThrow("SCHEDULE_FORBIDDEN");
   await expect(rpc("daily_call_batch", "preview", { mode: "fill_blank", reason: "Conferência sintética", items: [{ employeeId: employee(n), date: day, status: "F", observation: null }] })).rejects.toThrow("BATCH_FORBIDDEN");
   expect(await rpc("daily_call_attachments", "list", { employeeId: employee(n), date: day })).toMatchObject({ rows: [] });
   await expect(rpc("daily_call_attachments", "upload", { employeeId: employee(n), date: day })).rejects.toThrow();
  }
  await expect(rpc("daily_call_workflow", "close", { date: day, managerId: manager(2), reason: "Conferência sintética" })).rejects.toThrow("Equipe fora do escopo");
  const queue = await rpc<{ rows: Array<{ employeeId: string; decisionVersion: string; updatedAt: string | null }> }>("daily_call_workflow", "queue", { start: day, end: day });
  const other = queue.rows.find(row => row.employeeId === employee(2))!;
  await expect(rpc("daily_call_workflow", "resolve", { employeeId: employee(2), date: day, status: "F", observation: null, expectedUpdatedAt: other.updatedAt, expectedDecisionVersion: other.decisionVersion, reason: "Conferência sintética" })).rejects.toThrow();
  // The trusted upload path receives an explicit actor instead of the browser JWT.
  await db.exec("reset role;set role service_role");
  await expect(value("public.daily_call_attachment_upload($1::uuid,$2::jsonb)", [user(3), JSON.stringify({ employeeId: employee(2), date: day, fileName: "sintetico.pdf", mediaType: "application/pdf", content: "JVBERi0xLjQ=", description: "Documento sintético conferido" })])).rejects.toThrow("ATTACHMENT_FORBIDDEN");
 });
 it("não concede administração, importação, correção de banco ou alteração de cadastros", async () => {
  await asUser(3);
  await expect(rpc("administration_users", "list")).rejects.toThrow("USER_EDIT_FORBIDDEN");
  await expect(value("public.administration('employee','list','{}'::jsonb)")).rejects.toThrow("ADMINISTRATION_FORBIDDEN");
  await expect(rpc("monitoring_query", "admin")).rejects.toThrow("MONITORING_ADMIN_REQUIRED");
  await expect(rpc("monitoring_query", "setting")).rejects.toThrow("MONITORING_ADMIN_REQUIRED");
  await expect(rpc("schedule_planning", "save", {})).rejects.toThrow("PLANNING_FORBIDDEN");
  await expect(rpc("attendance_history", "correct", { employeeId: employee(2), start: day, end: day })).rejects.toThrow("ATTENDANCE_CORRECTION_FORBIDDEN");
 });
 it("RH pode revogar imediatamente; papel diferente limpa opção", async () => {
  await asUser(2); await edit(3, false);
  await asUser(3); expect((await readCall()).employees).toHaveLength(1);
  await asUser(2); await edit(3, true); await edit(3, false, "LEITURA");
  const target = (await rpc<User[]>("administration_users", "list")).find(row => row.id === user(3));
  expect(target).toMatchObject({ papel_usuario: "LEITURA", visualizar_todos_gestores: false });
  await edit(3, true);
  await db.exec("reset role");
  await db.query("update public.perfis set papel_usuario='LEITURA',gestor_id=null where id=$1", [user(3)]);
  expect(await value("(select visualizar_todos_gestores from public.perfis where id=$1)", [user(3)])).toBe(false);
 });
 it("opção não libera perfil bloqueado e metadados não concedem visibilidade", async () => {
  await asUser(1); await edit(4, true);
  await value("public.bloquear_usuario($1::uuid)", [user(4)]);
  await asUser(4); await expect(readCall()).rejects.toThrow();
  await db.exec("reset role");
  await db.query("update auth.users set raw_user_meta_data=raw_user_meta_data||'{\"visualizar_todos_gestores\":true}'::jsonb where id=$1", [user(5)]);
  await asUser(5); expect((await readCall()).employees).toHaveLength(1);
 });

 it("rejeita flag malformada e preserva opção em clientes sem o campo", async () => {
  await asUser(1);
  const { data, result } = await edit(5, true);
  await expect(rpc("administration_users", "save", { ...data, expectedUpdatedAt: result.updatedAt, viewAllManagers: "true" })).rejects.toThrow("USER_EDIT_INVALID");
  await rpc("administration_users", "save", { ...data, viewAllManagers: undefined, expectedUpdatedAt: result.updatedAt });
  expect((await rpc<User[]>("administration_users", "list")).find(row => row.id === user(5))?.visualizar_todos_gestores).toBe(true);
 });
});
