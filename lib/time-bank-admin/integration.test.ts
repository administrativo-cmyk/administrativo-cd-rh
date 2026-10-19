import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { bankAdminMutationResultSchema, bankAdminSnapshotSchema, bankHistorySchema, type BankMeasurement } from "./contracts";

let db: PGlite;
const actor = (n: number) => `ba000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let sequence = 0;
async function value<T>(sql: string, args: unknown[] = []) { return (await db.query<{ value: T }>(sql, args)).rows[0].value; }
async function rpc(action: string, data: unknown = {}, user = actor(1)) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try { return await value<unknown>("select public.time_bank_admin($1,$2::jsonb) value", [action, JSON.stringify(data)]); }
  finally { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub','',false)"); }
}
async function person() {
  const id = `bb000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
  await db.query("insert into public.colaboradores(id,matricula,nome,unidade_id) values($1,$2,'Pessoa sintética',(select id from public.unidades where codigo='CD I'))", [id, `BANK-${sequence}`]);
  return id;
}
const input = (employeeId: string, extra = {}) => ({ employeeId, measurementDate: "2026-10-01", effectiveFrom: "2026-10-01", workdayHours: 8, balanceMinutes: 960, source: "Conferência sintética", reason: "Conferência sintética do saldo", ...extra });
async function create(employeeId: string, extra = {}) { return bankAdminMutationResultSchema.parse(await rpc("save", input(employeeId, extra))).record; }
const versioned = (row: BankMeasurement) => ({ id: row.id, expectedUpdatedAt: row.updatedAt, reason: "Correção sintética auditada" });
const bank = (employeeId: string, date = "2026-10-17") => value<{ saldo_minutos: number; dias_g_ciclo: number; dias_pendentes_compensar: number } | null>("select (select row_to_json(b) from private.banco_horas_no_dia($1,$2::date) b) value", [employeeId, date]);
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}'); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
  for (const file of (await readdir(path.resolve("supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(path.resolve("supabase/migrations", file), "utf8"));
  for (const [index, role] of ["ADMIN", "RH", "GESTOR", "LEITURA"].entries()) {
    const cpf = `90000000${String(index + 1).padStart(3, "0")}`;
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,encode(sha256(convert_to($2,'UTF8')),'hex')||'@auth.administrativo-cd.invalid',jsonb_build_object('nome_completo','Conta sintética','cpf_normalizado',$2))", [actor(index + 1), cpf]);
    await db.query("update public.perfis set status_usuario='APROVADO',papel_usuario=$2::public.papel_usuario,aprovado_em=now() where id=$1", [actor(index + 1), role]);
  }
}, 60_000);
afterAll(async () => { if (db) await db.close(); });

describe("medições gerenciadas no PostgreSQL isolado", () => {
  it("RLS e grants impedem acesso direto; apenasADMIN/RH usamRPC", async () => {
    expect(await value<boolean>("select not has_function_privilege('anon','public.time_bank_admin(text,jsonb)','execute') value")).toBe(true);
    expect(await value<boolean>("select not has_table_privilege('authenticated','public.banco_horas_medicoes','update') value")).toBe(true);
    expect(await value<boolean>("select not has_table_privilege('authenticated','private.time_bank_measurement_audit','select') value")).toBe(true);
    expect(await value<boolean>("select relrowsecurity value from pg_class where oid='private.time_bank_measurement_audit'::regclass")).toBe(true);
    for (const user of [actor(3), actor(4)]) await expect(rpc("list", {}, user)).rejects.toThrow("BANK_ADMIN_FORBIDDEN");
    expect(bankAdminSnapshotSchema.parse(await rpc("list", {}, actor(2))).rows).toEqual([]);
  });
  it("cria/edita comCAS, histórico antes/depois e ator real", async () => {
    const employee = await person(); const first = await create(employee);
    const updated = bankAdminMutationResultSchema.parse(await rpc("save", { ...input(employee, { balanceMinutes: -60 }), ...versioned(first) })).record;
    expect(updated.balanceMinutes).toBe(-60);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(first.updatedAt).getTime());
    expect(updated.updatedAt).not.toBe(first.updatedAt);
    await expect(rpc("save", { ...input(employee), ...versioned(first) })).rejects.toThrow("BANK_ADMIN_STALE");
    const history = bankHistorySchema.parse(await rpc("history", { id: first.id }));
    expect(history.rows).toHaveLength(2);
    expect(history.rows[0]).toMatchObject({ action: "update", before: { balanceMinutes: 960 }, after: { balanceMinutes: -60 } });
    expect(await value<string>("select actor::text value from private.time_bank_measurement_audit where measurement_id=$1 order by id desc limit 1", [first.id])).toBe(actor(1));
    expect(await bank(employee)).toMatchObject({ saldo_minutos: -60 });
  });
  it("cancelar ciclo restaura baseline anterior; G é reatribuído ao ciclo correto; restaurar mantém histórico", async () => {
    const employee = await person(); await create(employee);
    const latest = await create(employee, { effectiveFrom: "2026-10-10", measurementDate: "2026-10-10", balanceMinutes: 480 });
    await db.query("insert into public.chamada_diaria(colaborador_id,data,status) values($1,'2026-10-12','G')", [employee]);
    expect(await bank(employee)).toMatchObject({ saldo_minutos: 480, dias_g_ciclo: 1, dias_pendentes_compensar: 0 });
    const cancelled = bankAdminMutationResultSchema.parse(await rpc("cancel", versioned(latest))).record;
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(await bank(employee)).toMatchObject({ saldo_minutos: 960, dias_g_ciclo: 1, dias_pendentes_compensar: 1 });
    expect(await value<number>("select count(*)::int value from public.vw_banco_horas_ciclos where colaborador_id=$1", [employee])).toBe(1);
    expect(await value<number>("select saldo_minutos value from public.vw_banco_horas_atual where colaborador_id=$1", [employee])).toBe(960);
    const restored = bankAdminMutationResultSchema.parse(await rpc("restore", versioned(cancelled))).record;
    expect(restored.cancelledAt).toBeNull();
    expect(await bank(employee)).toMatchObject({ saldo_minutos: 480, dias_pendentes_compensar: 0 });
    expect(bankHistorySchema.parse(await rpc("history", { id: latest.id })).rows.map((row) => row.action)).toEqual(["restore", "cancel", "create"]);
  });
  it("cancelar única medição torna leituras semextrato; futuros não antecipam vigência", async () => {
    const employee = await person(); const row = await create(employee);
    await rpc("cancel", versioned(row));
    expect(await bank(employee)).toBeNull();
    await create(employee, { effectiveFrom: "2027-01-01", measurementDate: "2027-01-01" });
    expect(await bank(employee)).toBeNull();
    const current = await value<{ employees: Array<{ id: string; bankBalanceMinutes: number | null }> }>("select private.ler_quadro_atual_impl() value").catch(() => null);
    expect(current).toBeNull(); // the private read still requires a real approved profile
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor(1)]);
    try {
      const snapshot = await value<{ employees: Array<{ id: string; bankBalanceMinutes: number | null }> }>("select public.ler_quadro_atual() value");
      expect(snapshot.employees.find((entry) => entry.id === employee)?.bankBalanceMinutes).toBeNull();
      const daily = await value<{ employees: Array<{ id: string; balanceMinutes: number | null }> }>("select public.ler_chamada_diaria('2026-10-17','2026-10-17','2026-10-17') value");
      expect(daily.employees.find((entry) => entry.id === employee)?.balanceMinutes).toBeNull();
    } finally { await db.query("select set_config('request.jwt.claim.sub','',false)"); }
  });
  it("conflito de baseline ativa impede restauração sem apagar versões canceladas", async () => {
    const employee = await person(); const first = await create(employee);
    await expect(create(employee)).rejects.toThrow("BANK_ADMIN_BASELINE_CONFLICT");
    const cancelled = bankAdminMutationResultSchema.parse(await rpc("cancel", versioned(first))).record;
    await create(employee, { balanceMinutes: 60 });
    await expect(rpc("restore", versioned(cancelled))).rejects.toThrow("BANK_ADMIN_BASELINE_CONFLICT");
    expect(bankAdminSnapshotSchema.parse(await rpc("list", { employeeId: employee, state: "all" })).total).toBe(2);
    expect(await bank(employee)).toMatchObject({ saldo_minutos: 60 });
  });
  it("rejeita troca de colaborador, saldo fracionado, datas infinitas e edição cancelada", async () => {
    const employee = await person(); const another = await person(); const row = await create(employee);
    await expect(rpc("save", { ...input(another), ...versioned(row) })).rejects.toThrow("BANK_ADMIN_EMPLOYEE_IMMUTABLE");
    await expect(rpc("save", input(another, { balanceMinutes: 0.5 }))).rejects.toThrow("BANK_ADMIN_INVALID");
    await expect(rpc("save", input(another, { effectiveFrom: "infinity" }))).rejects.toThrow("BANK_ADMIN_INVALID");
    const cancelled = bankAdminMutationResultSchema.parse(await rpc("cancel", versioned(row))).record;
    await expect(rpc("save", { ...input(employee), ...versioned(cancelled) })).rejects.toThrow("BANK_ADMIN_CANCELLED");
    await expect(rpc(null as unknown as string, versioned(cancelled))).rejects.toThrow("BANK_ADMIN_INVALID");
    expect(bankAdminSnapshotSchema.parse(await rpc("list", { employeeId: employee, state: "cancelled" })).total).toBe(1);
  });
  it("enfileira revisão de resultados/decisões sem alterar chamada manual e preserva CAS de entrada", async () => {
    const employee = await person(); const row = await create(employee);
    await db.query("insert into public.monitoring_results(employee_id,operational_date,input_version,rule_version,result,summary,reason) values($1,'2026-10-05',1,'synthetic','{}','{}','Synthetic')", [employee]);
    await db.query("insert into private.daily_call_decisions(employee_id,operational_date,manual_override) values($1,'2026-10-06',true)", [employee]);
    await db.query("insert into public.chamada_diaria(colaborador_id,data,status,origin) values($1,'2026-10-05','I','manual')", [employee]);
    const oldVersion = await value<number>("select version::int value from private.monitoring_revision where id=true");
    const result = bankAdminMutationResultSchema.parse(await rpc("save", { ...input(employee, { balanceMinutes: 600 }), ...versioned(row) }));
    expect(result.queued).toBe(2);
    expect(await value<boolean>("select dirty value from public.monitoring_results where employee_id=$1", [employee])).toBe(true);
    expect(await value<number>("select version::int value from private.monitoring_revision where id=true")).toBeGreaterThan(oldVersion);
    expect(await value<string>("select status::text||':'||origin value from public.chamada_diaria where colaborador_id=$1", [employee])).toBe("I:manual");
    expect(await value<boolean>("select manual_override value from private.daily_call_decisions where employee_id=$1 and operational_date='2026-10-06'", [employee])).toBe(true);
  });
  it("saldo editado de480para481 retira apenasIautomático após revisão; cancelamento retira a evidência de saldo", async () => {
    const employee = await person();
    const date = await value<string>("select ((now() at time zone 'America/Sao_Paulo')::date-3)::text value");
    const baseline = await value<string>("select ($1::date-10)::text value", [date]);
    const source = `bank-fixture-${sequence}`;
    await db.query("update public.colaboradores set admissao=$2::date-30 where id=$1", [employee, date]);
    await db.query("insert into public.monitoring_sources(id,kind,identity_namespace,configuration,last_success_at) values($1,'afd',$1,jsonb_build_object('sourceIdentityConfirmed',true,'declaredCoverage',jsonb_build_object('from',($2::date-2)::text||'T00:00:00-03:00','to',($2::date+2)::text||'T23:59:00-03:00','continuous',true)),now())", [source, date]);
    await db.query("insert into public.monitoring_files(source_id,sha256,byte_length,relative_path,parser_version,status,expected_batches,metadata,completed_at) values($1,repeat('a',64),1,'synthetic.txt','synthetic','complete',1,'{}',now())", [source]);
    await db.query("insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by) values($1,'cpf','00000000100',$2,$3::date-30,'Identidade sintética conferida',$4)", [source, employee, date, actor(1)]);
    await db.query("insert into public.monitoring_settings(kind,target,valid_from,payload,reason,created_by) values('schedule',$1,$2::date-30,'{\"name\":\"Escala sintética\",\"start\":\"08:00\",\"end\":\"17:00\",\"days\":[0,1,2,3,4,5,6]}','Escala sintética',$3)", [employee, date, actor(1)]);
    const first = await create(employee, { balanceMinutes: 480, effectiveFrom: baseline, measurementDate: baseline });
    const apply = async () => {
      const inputVersion = await value<number>("select version::int value from private.monitoring_revision where id=true");
      await db.exec("set role service_role");
      try { return await value<{ state: string; status: string | null }>("select public.daily_call_apply_import($1::jsonb) value", [JSON.stringify({ employeeId: employee, date, inputVersion })]); }
      finally { await db.exec("reset role"); }
    };
    expect(await apply()).toMatchObject({ status: "I", state: "automatic_absence" });
    const changed = bankAdminMutationResultSchema.parse(await rpc("save", { ...input(employee, { balanceMinutes: 481, effectiveFrom: baseline, measurementDate: baseline }), ...versioned(first) })).record;
    expect(await apply()).toMatchObject({ status: null, state: "pending_manager" });
    await rpc("cancel", versioned(changed));
    expect(await apply()).toMatchObject({ status: null, state: "blocked" });
    expect(await value<number>("select count(*)::int value from public.chamada_diaria where colaborador_id=$1", [employee])).toBe(0);
  });
});

describe("punch corrections and baseline-gated bank ledger", () => {
  async function history(action: string, employeeId: string, extra = {}, user = actor(1)) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.exec("set role authenticated");
    try { return await value<Record<string, unknown>>("select public.attendance_history($1,$2::jsonb) value", [action, JSON.stringify({ employeeId, start: "2026-10-01", end: "2026-10-02", ...extra })]); }
    finally { await db.exec("reset role"); }
  }
  it("adds positive and negative days from the new effective baseline, excluding pending/dirty and old periods", async () => {
    const employee = await person(); const row = await create(employee);
    const add = (date: string, delta: number, state = "ready", dirty = false) => db.query("insert into public.monitoring_results(employee_id,operational_date,input_version,rule_version,result,summary,reason,dirty) values($1,$2::date,0,'test','{}',$3::jsonb,'Synthetic calculation',$4)", [employee, date, JSON.stringify({ bankDay: { state, deltaMinutes: delta } }), dirty]);
    await add("2026-09-30", 1000); await add("2026-10-01", 60); await add("2026-10-02", -120); await add("2026-10-03", 500, "pending"); await add("2026-10-04", 500, "ready", true);
    expect((await bank(employee))?.saldo_minutos).toBe(900);
    expect((await bank(employee, "2026-10-01"))?.saldo_minutos).toBe(1020);
    await db.query("delete from private.attendance_bank_baselines where measurement_id=$1", [row.id]);
    expect((await bank(employee))?.saldo_minutos).toBe(960);
  });
  it("preserves manual G compensation without a second punch deficit", async () => {
    const employee = await person(); await create(employee);
    await db.query("insert into public.monitoring_results(employee_id,operational_date,input_version,rule_version,result,summary,reason) values($1,'2026-10-01',0,'test','{}','{\"bankDay\":{\"state\":\"ready\",\"deltaMinutes\":-480}}','Synthetic calculation')", [employee]);
    await db.query("insert into public.chamada_diaria(colaborador_id,data,status,updated_by) values($1,'2026-10-01','G',$2)", [employee, actor(1)]);
    expect(await bank(employee)).toMatchObject({ saldo_minutos: 960, dias_g_ciclo: 1, dias_pendentes_compensar: 1 });
  });
  it("only ADMIN/RH correct, saves revisions without altering originals, and rejects stale writes", async () => {
    const employee = await person();
    const correction = { date: "2026-10-02", expectedUpdatedAt: null, reason: "Conferência sintética do ponto", punches: ["08:00", "12:00", "13:00", "17:00"].map(time => ({ at: `2026-10-02T${time}:00-03:00`, evidenceId: null })) };
    await expect(history("correct", employee, correction, actor(4))).rejects.toThrow("ATTENDANCE_CORRECTION_FORBIDDEN");
    expect(await history("correct", employee, correction)).toEqual({ changed: true });
    const data = await history("history", employee);
    expect(data.canEdit).toBe(true); expect((data.input as { corrections: unknown[] }).corrections).toHaveLength(1);
    expect(data.correctionHistory).toHaveLength(1);
    expect(await value<number>("select count(*)::int value from public.monitoring_events where source_id='rh-correction'")).toBe(0);
    await expect(history("correct", employee, correction)).rejects.toThrow("ATTENDANCE_STALE");
    const version = (data.input as { corrections: Array<{ updatedAt: string }> }).corrections[0].updatedAt;
    expect(await history("correct", employee, { ...correction, expectedUpdatedAt: version, reason: "Revisão sintética pelo RH" }, actor(2))).toEqual({ changed: true });
    expect((await history("history", employee)).correctionHistory).toHaveLength(2);
    expect(await value<number>("select count(*)::int value from public.monitoring_jobs where employee_id=$1 and operational_date='2026-10-02'", [employee])).toBe(1);
  });
  it("rejects evidence from another person and out-of-order or future marks", async () => {
    const employee = await person(); const marks = ["08:00", "12:00", "13:00", "17:00"].map(time => ({ at: `2026-10-02T${time}:00-03:00`, evidenceId: null as string | null }));
    marks[2].evidenceId = "aaaaaaaa-0000-4000-8000-000000000001";
    await expect(history("correct", employee, { date: "2026-10-02", expectedUpdatedAt: null, reason: "Conferência sintética", punches: marks })).rejects.toThrow("ATTENDANCE_INVALID_EVIDENCE");
    marks[2].evidenceId = null; marks.reverse();
    await expect(history("correct", employee, { date: "2026-10-02", expectedUpdatedAt: null, reason: "Conferência sintética", punches: marks })).rejects.toThrow("ATTENDANCE_INVALID_CORRECTION");
  });
});
