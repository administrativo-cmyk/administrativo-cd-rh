import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { employeeInputSchema } from "./administration/contracts";
import { attendanceWithinEmployment } from "./employee-lifecycle";

const admin = "ea000000-0000-4000-8000-000000000001", manager = "ea000000-0000-4000-8000-000000000002", rh = "ea000000-0000-4000-8000-000000000003";
const employee = "eb000000-0000-4000-8000-000000000001", team = "ec000000-0000-4000-8000-000000000001";
let nsr = 0;
let db: PGlite, day: string, today: string, prior: string, future: string;
async function value<T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T> { return (await db.query<{ value: T }>(sql, args)).rows[0].value; }
async function guard<T>(work: () => Promise<T>) { await db.exec("savepoint action_guard"); try { const result = await work(); await db.exec("release savepoint action_guard"); return result; } catch (error) { await db.exec("rollback to savepoint action_guard;release savepoint action_guard"); throw error; } }
async function actor(id = admin) { await db.exec(`set local role authenticated;select set_config('request.jwt.claim.sub','${id}',true)`); }
async function rows(situation?: string) { return value<{ employees: Array<{ id: string; pendingTerminationDates: string[] }> }>("select public.daily_call_read($1::date,$1::date,$1::date,$2) value", [day, situation ?? null]); }
async function record() { return (await value<{ rows: Record<string, unknown>[] }>("select public.administration('employee','list','{}') value")).rows[0]; }
async function save(changes: Record<string, unknown>) {
  const old = await record();
  const data = { ...old, expectedUpdatedAt: old.updatedAt, reason: "Revisão sintética do cadastro", ...changes };
  return guard(() => value<{ record: Record<string, unknown> }>("select public.administration('employee','save',$1::jsonb) value", [JSON.stringify(data)]));
}
async function evidence(date = day) { await db.exec("reset role"); return value<{ state: string; status: string | null; punchIds?: string[]; blockers: string[] }>("select private.daily_call_evidence($1::uuid,$2::date) value", [employee, date]); }
async function punch(date = day, time = "08:00", eligible = true) {
  await db.exec("reset role");
  await db.query("insert into public.monitoring_events(source_id,event_key,payload_hash,event_type,identity_type,identity_value,occurred_at,classification,eligible,nsr,payload) values('lifecycle-test',$1,repeat('a',64),'punch','cpf','12345678909',$2::timestamptz,'authorized',$3,$4,'{}')", [`${date}-${time}`, `${date}T${time}:00-03:00`, eligible, String(++nsr).padStart(9,"0")]);
}
async function tick() { await db.exec("reset role"); return value<{ checked: number; returned: number }>("select private.employee_lifecycle_tick() value"); }
async function leave(expected = day) { await actor(); return save({ situation: "FERIAS", situationFrom: prior, expectedReturnDate: expected }); }

beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
  for (const file of (await readdir(path.resolve("supabase/migrations"))).filter(file => file.endsWith(".sql")).sort()) await db.exec(await readFile(path.join("supabase/migrations", file), "utf8"));
  for (const [id, cpf, role] of [[admin, "00000000111", "ADMIN"], [manager, "00000000112", "GESTOR"], [rh, "00000000113", "RH"]]) {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1::uuid,encode(sha256(convert_to($2,'UTF8')),'hex')||'@auth.administrativo-cd.invalid',jsonb_build_object('nome_completo','Conta sintética','cpf_normalizado',$2))", [id, cpf]);
    await db.query("update public.perfis set status_usuario='APROVADO',papel_usuario=$2::public.papel_usuario,aprovado_em=now() where id=$1::uuid", [id, role]);
  }
  const dates = await value<{ day: string; today: string; prior: string; future: string }>("select jsonb_build_object('day',((now() at time zone 'America/Sao_Paulo')::date-3)::text,'today',(now() at time zone 'America/Sao_Paulo')::date::text,'prior',((now() at time zone 'America/Sao_Paulo')::date-10)::text,'future',((now() at time zone 'America/Sao_Paulo')::date+3)::text) value");
  ({ day, today, prior, future } = dates);
}, 60000);
beforeEach(async () => {
  await db.exec("begin;reset role");
  await db.query("insert into public.gestores(id,nome) values($1::uuid,'Equipe sintética')", [team]);
  await db.query("update public.perfis set gestor_id=$1::uuid where id=$2::uuid", [team, manager]);
  await db.query("insert into public.colaboradores(id,matricula,nome,unidade_id,gestor_id,admissao) values($1::uuid,'LIFE-1','Pessoa sintética',(select id from public.unidades limit 1),$2::uuid,$3::date-30)", [employee, team, day]);
  await db.query("insert into public.monitoring_sources(id,kind,identity_namespace,configuration,last_success_at) values('lifecycle-test','afd','lifecycle-test',jsonb_build_object('sourceIdentityConfirmed',true,'declaredCoverage',jsonb_build_object('from',$1::text||'T00:00:00-03:00','to',$2::text||'T23:59:00-03:00','continuous',true)),now())", [day, today]);
  await db.exec("insert into public.monitoring_files(source_id,sha256,byte_length,relative_path,parser_version,status,expected_batches,metadata,completed_at) values('lifecycle-test',repeat('a',64),1,'synthetic.txt','synthetic','complete',1,'{}',now())");
  await db.query("insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by) values('lifecycle-test','cpf','12345678909',$1::uuid,$2::date-30,'Identidade sintética conferida',$3::uuid)", [employee, day, admin]);
  await db.query("insert into public.monitoring_settings(kind,target,valid_from,payload,reason,created_by) values('schedule',$1,$2::date-30,'{\"name\":\"Escala sintética\",\"start\":\"08:00\",\"end\":\"17:00\",\"days\":[0,1,2,3,4,5,6]}','Escala sintética conferida',$3::uuid)", [employee, day, admin]);
  await db.query("insert into public.banco_horas_medicoes(colaborador_id,data_medicao,aplica_a_partir_de,jornada_horas_dia,saldo_minutos) values($1::uuid,$2::date-10,$2::date-10,8,0)", [employee, day]);
  await actor();
});
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { if (db) await db.close(); });

describe("ciclo do colaborador em PostgreSQL isolado", () => {
  it("exige desligamento e datas do afastamento na API e no banco", async () => {
    await expect(save({ situation: "DESLIGADO" })).rejects.toThrow("EMPLOYEE_LIFECYCLE_DATES");
    await expect(save({ situation: "FERIAS" })).rejects.toThrow("EMPLOYEE_LIFECYCLE_DATES");
    const row = await record();
    expect(employeeInputSchema.safeParse({ ...Object.fromEntries(Object.entries(row).filter(([key]) => !["id", "createdAt", "updatedAt", "activeInSystem", "defaultSchedule", "statusSignal"].includes(key))), situation: "DESLIGADO", terminationDate: null, reason: "Validar datas" }).success).toBe(false);
  });
  it("mantém desligado só até o último dia pendente e permite filtro explícito", async () => {
    await save({ situation: "DESLIGADO", terminationDate: day });
    expect((await rows()).employees).toHaveLength(1);
    expect((await rows()).employees[0].pendingTerminationDates).toEqual([day]);
    await value("select public.salvar_chamada_diaria($1::uuid,$2::date,'P',null,null) value", [employee, day]);
    expect((await rows()).employees).toHaveLength(0);
    expect((await rows("DESLIGADO")).employees).toHaveLength(1);
  });
  it("impede presença/falta após desligamento, inclusive por RPC manual e lote", async () => {
    await save({ situation: "DESLIGADO", terminationDate: day });
    expect((await evidence(today)).status).toBeNull();
    await punch(today);
    expect((await evidence(today)).status).toBeNull();
    await actor();
    await expect(guard(() => value("select public.salvar_chamada_diaria($1::uuid,$2::date,'P',null,null) value", [employee, today]))).rejects.toThrow("populacao operacional");
    const batch = await value<{ eligible: number }>("select public.daily_call_batch('preview',$1::jsonb) value", [JSON.stringify({ mode: "fill_blank", reason: "Verificar desligamento", items: [{ employeeId: employee, date: today, status: "P", observation: null }] })]);
    expect(batch.eligible).toBe(0);
  });
  it("preserva falta automática anterior ao desligamento e bloqueia datas posteriores", async () => {
    await save({ situation: "DESLIGADO", terminationDate: day });
    expect(await evidence()).toMatchObject({ status: "I", state: "automatic_absence" });
    expect(attendanceWithinEmployment({ situation: "Desligado", terminationDate: day }, today)).toBe(false);
    expect(attendanceWithinEmployment({ situation: "Desligado", terminationDate: day }, day)).toBe(true);
  });
  it("não gera falta nem reativa sem ponto após o retorno previsto", async () => {
    await leave();
    expect(await evidence()).toMatchObject({ status: null, state: "not_expected" });
    expect((await tick()).returned).toBe(0);
    await actor(rh);
    const notices = await guard(() => value<Array<{ title: string }>>("select jsonb_agg(n) value from private.workspace_notifications(auth.uid(),'RH',null) n")).catch(() => null);
    // Raw helpers are private. RH obtains the same notice through the authorized workspace RPC.
    expect(notices).toBeNull();
    await db.exec("reset role");
    expect(await value<string>("select kind value from private.employee_lifecycle_signals where employee_id=$1::uuid", [employee])).toBe("return_overdue");
    expect((await db.query("select situacao from public.colaboradores where id=$1::uuid", [employee])).rows[0]).toEqual({ situacao: "FERIAS" });
  });
  it("reativa somente com ponto válido após a previsão e conserva a proteção histórica", async () => {
    await leave(); await punch();
    expect((await tick()).returned).toBe(1);
    expect((await db.query("select situacao,retorno_previsto from public.colaboradores where id=$1::uuid", [employee])).rows[0]).toEqual({ situacao: "ATIVO", retorno_previsto: null });
    expect(await value<boolean>("select private.employee_absence_protected($1::uuid,$2::date) value", [employee, prior])).toBe(true);
    expect(await value<boolean>("select private.employee_absence_protected($1::uuid,$2::date) value", [employee, day])).toBe(false);
    expect(await value<number>("select count(*)::int value from private.employee_lifecycle_audit where action='automatic_return' and actor is null")).toBe(1);
    expect((await tick()).returned).toBe(0);
  });
  it("não aceita evento inelegível como retorno e não reativa desligados", async () => {
    await leave(); await punch(day, "08:00", false);
    expect((await tick()).returned).toBe(0);
    await actor(); await save({ situation: "DESLIGADO", terminationDate: day, expectedReturnDate: null });
    await punch(today);
    expect((await tick()).returned).toBe(0);
  });
  it("sugere retorno antecipado por recorrência, sem alteração automática", async () => {
    const second = new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0,10);
    await leave(future);await punch(day);await punch(day,"17:00");await punch(second);await punch(second,"17:00");
    expect((await tick()).returned).toBe(0);
    expect(await value<string>("select kind value from private.employee_lifecycle_signals where employee_id=$1::uuid", [employee])).toBe("return_suggested");
  });
  it("atribui a saída noturna ao dia anterior e não antecipa o retorno", async () => {
    await leave(today);
    await db.exec(`reset role;update public.monitoring_settings set payload=payload||'{"start":"22:00","end":"06:20"}' where target='${employee}'`);
    await punch(today,"06:20");
    expect((await tick()).returned).toBe(0);
  });
  it("sugere conferir cadastro legado com ponto recorrente, sem presumir datas", async () => {
    await db.exec(`reset role;update public.colaboradores set situacao='AFASTADO' where id='${employee}'`);
    const second = new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0,10);
    await punch(day);await punch(day,"17:00");await punch(second);await punch(second,"17:00");
    expect((await tick()).returned).toBe(0);
    expect(await value<string>("select kind value from private.employee_lifecycle_signals where employee_id=$1::uuid", [employee])).toBe("return_suggested");
    expect((await evidence(today)).status).toBeNull();
  });
  it.each(["revoked", "conflicted", "unconfirmed"])("não confirma retorno com evidência %s", async mode => {
    await leave();await punch();
    if(mode === "revoked") await db.exec("update public.monitoring_bindings set revoked_at=now() where source_id='lifecycle-test'");
    if(mode === "conflicted") await db.exec("update public.monitoring_events set conflicted=true where source_id='lifecycle-test'");
    if(mode === "unconfirmed") await db.exec("update public.monitoring_sources set configuration=jsonb_set(configuration,'{sourceIdentityConfirmed}','false') where id='lifecycle-test'");
    expect((await tick()).returned).toBe(0);
  });
  it("fecha afastamento manual sem remover histórico e audita os documentos", async () => {
    await leave(future);
    await save({ situation: "ATIVO", situationFrom: day, expectedReturnDate: null, cpf: "12345678909" });
    expect(await evidence(prior)).toMatchObject({ status: null, state: "not_expected" });
    await actor();expect((await record()).cpf).toBe("12345678909");
    await expect(save({ cpf: "12345678900" })).rejects.toThrow("EMPLOYEE_IDENTIFIER_INVALID");
    await actor(manager);await expect(guard(() => record())).rejects.toThrow("FORBIDDEN");
    expect(await value<boolean>("select has_table_privilege('authenticated','private.employee_identifiers','select') value")).toBe(false);
    expect(await value<boolean>("select has_function_privilege('authenticated','private.administration_impl(text,text,jsonb)','execute') value")).toBe(false);
  });
  it("filtra por situação e gestor com versão e total coerentes", async () => {
    await leave();
    const result = await value<{ rows: unknown[]; total: number }>("select public.administration('employee','list',$1::jsonb) value", [JSON.stringify({ situation: "ATIVO", managerId: team })]);
    expect(result.total).toBe(0);expect(result.rows).toHaveLength(0);
    await actor(manager);expect((await rows()).employees).toHaveLength(1);
    await db.exec("reset role");await db.query("update public.perfis set gestor_id=null where id=$1::uuid", [manager]);await actor(manager);
    expect((await rows("FERIAS")).employees).toHaveLength(0);
  });
  it("registra as datas finais na auditoria existente e protege os documentos", async () => {
    await save({ situation: "DESLIGADO", terminationDate: day, cpf: "12345678909" });
    await db.exec("reset role");
    expect(await value<string>("select after_record->>'terminationDate' value from private.administration_audit where entity_id=$1::uuid order by id desc limit 1", [employee])).toBe(day);
    await actor();
    const audit = await value<{ rows: Array<{ after: { terminationDate: string; cpf: string } }> }>("select public.audit_history($1::jsonb) value", [JSON.stringify({ from: today, to: today, domain: "cadastros" })]);
    expect(audit.rows[0].after).toMatchObject({ terminationDate: day, cpf: "[identificador protegido]" });
  });
  it("cliente antigo omite documentos sem apagar os identificadores armazenados", async () => {
    const changed = await save({ cpf: "12345678909" });
    const oldClient = employeeInputSchema.parse({ id: employee, expectedUpdatedAt: changed.record.updatedAt, employeeNumber: "LIFE-1", name: "Pessoa sintética", unitId: changed.record.unitId, managerId: team, situation: "ATIVO", admissionDate: changed.record.admissionDate, workdayHours: 8, reason: "Cliente anterior atualizado" });
    expect(oldClient).not.toHaveProperty("cpf");expect(oldClient).not.toHaveProperty("pis");
    await value("select public.administration('employee','save',$1::jsonb) value", [JSON.stringify(oldClient)]);
    expect((await record()).cpf).toBe("12345678909");
  });
});
