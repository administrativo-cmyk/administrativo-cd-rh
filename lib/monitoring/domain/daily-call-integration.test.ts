import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { workflowCloseResultSchema, workflowResolveResultSchema, workflowSnapshotSchema } from "@/lib/daily-call-workflow";

let db: PGlite;
let day: string;
let today: string;
let sequence = 100;
const admin = "10000000-0000-4000-8000-000000000100";
const reader = "10000000-0000-4000-8000-000000000101";
const managerUser = "10000000-0000-4000-8000-000000000102";
type Row = { employeeId: string; date: string; status: string | null; origin: string | null; state: string; decisionVersion: string; updatedAt: string | null; blockers: string[] };
type Queue = { revision: string; rows: Row[]; days: Array<Record<string, unknown>>; counts: Record<string, number> };
type Applied = { changed: boolean; status: string | null; origin: string | null; state: string; decisionVersion: string };

async function value<T>(sql: string, args: unknown[] = []): Promise<T> {
  return (await db.query<{ value: T }>(sql, args)).rows[0].value;
}
async function session<T>(role: "authenticated" | "service_role", actor: string | null, work: () => Promise<T>) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor ?? ""]);
  await db.exec(`set role ${role}`);
  try { return await work(); } finally { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub','',false)"); }
}
async function fixture(balance: number | null = 0, date = day) {
  const number = ++sequence;
  const employeeId = `30000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const managerId = `20000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const sourceId = `attendance-${number}`;
  const identity = String(number).padStart(11, "0");
  await db.query("insert into public.gestores(id,nome) values($1::uuid,$2)", [managerId, `Equipe sintética ${number}`]);
  await db.query("insert into public.colaboradores(id,matricula,nome,unidade_id,gestor_id,admissao) values($1::uuid,$2,$3,(select id from public.unidades limit 1),$4::uuid,$5::date-30)", [employeeId, `TEST-${number}`, `Pessoa sintética ${number}`, managerId, date]);
  await db.query("insert into public.monitoring_sources(id,kind,identity_namespace,configuration,last_success_at) values($1,'afd',$1,jsonb_build_object('sourceIdentityConfirmed',true,'declaredCoverage',jsonb_build_object('from',($2::date-2)::text||'T00:00:00-03:00','to',($2::date+2)::text||'T23:59:00-03:00','continuous',true)),now())", [sourceId, date]);
  await db.query("insert into public.monitoring_files(source_id,sha256,byte_length,relative_path,parser_version,status,expected_batches,metadata,completed_at) values($1,repeat('a',64),1,'synthetic.txt','synthetic','complete',1,'{}',now())", [sourceId]);
  await db.query("insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by) values($1,'cpf',$2,$3::uuid,$4::date-30,'Identidade sintética conferida',$5::uuid)", [sourceId, identity, employeeId, date, admin]);
  await db.query("insert into public.monitoring_settings(kind,target,valid_from,payload,reason,created_by) values('schedule',$1,$2::date-30,'{\"name\":\"Escala sintética\",\"start\":\"08:00\",\"end\":\"17:00\",\"days\":[0,1,2,3,4,5,6]}','Escala sintética conferida',$3::uuid)", [employeeId, date, admin]);
  if (balance !== null) await db.query("insert into public.banco_horas_medicoes(colaborador_id,data_medicao,aplica_a_partir_de,jornada_horas_dia,saldo_minutos) values($1::uuid,$2::date-10,$2::date-10,8,$3)", [employeeId, date, balance]);
  const apply = async () => {
    const inputVersion = await value<number>("select version::integer as value from private.monitoring_revision");
    return session("service_role", null, () => value<Applied>("select public.daily_call_apply_import($1::jsonb) as value", [JSON.stringify({ employeeId, date, inputVersion })]));
  };
  const queue = () => session("authenticated", admin, async () => workflowSnapshotSchema.parse(await value<Queue>("select public.daily_call_workflow('queue',$1::jsonb) as value", [JSON.stringify({ start: date, end: date, managerId })])));
  const punch = async (at = `${date}T09:00:00-03:00`) => {
    await db.query("insert into public.monitoring_events(source_id,event_key,payload_hash,event_type,identity_type,identity_value,occurred_at,classification,eligible,nsr,payload) values($1,'synthetic-punch',repeat('a',64),'punch','cpf',$2,$3::timestamptz,'authorized',true,'000000001','{}')", [sourceId, identity, at]);
  };
  const resolve = async (status: string | null, expected?: Row) => {
    const row = expected ?? (await queue()).rows[0];
    return session("authenticated", admin, async () => workflowResolveResultSchema.parse(await value("select public.daily_call_workflow('resolve',$1::jsonb) as value", [JSON.stringify({ employeeId, date, status, observation: null, expectedUpdatedAt: row.updatedAt, expectedDecisionVersion: row.decisionVersion, reason: "Decisão manual sintética" })])));
  };
  return { employeeId, managerId, sourceId, identity, date, apply, queue, punch, resolve };
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
  const directory = path.resolve("supabase/migrations");
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(path.join(directory, file), "utf8"));
  for (const [id, cpf, role] of [[admin, "00000000100", "ADMIN"], [reader, "00000000101", "LEITURA"], [managerUser, "00000000102", "GESTOR"]]) {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1::uuid,encode(sha256(convert_to($2,'UTF8')),'hex')||'@auth.administrativo-cd.invalid',jsonb_build_object('nome_completo','Conta sintética','cpf_normalizado',$2))", [id, cpf]);
    await db.query("update public.perfis set status_usuario='APROVADO',papel_usuario=$2::public.papel_usuario,aprovado_em=now() where id=$1::uuid", [id, role]);
  }
  today = await value<string>("select (now() at time zone 'America/Sao_Paulo')::date::text as value");
  day = await value<string>("select ((now() at time zone 'America/Sao_Paulo')::date-3)::text as value");
}, 60_000);
afterAll(async () => { if (db) await db.close(); });

describe("Chamada importada: migration completa em PostgreSQL local", () => {
  it.each([-60, 480, 481])("horário estimado não presume falta ou folga com saldo %i", async balance => {
    const f = await fixture(balance);
    await db.query("update public.monitoring_settings set payload=payload||'{\"estimated\":true,\"weeklyRosterConfirmed\":false}' where target=$1", [f.employeeId]);
    expect(await f.apply()).toMatchObject({ status: null, state: "blocked" });
    const evidence = await value<{ blockers: string[] }>("select private.daily_call_evidence($1::uuid,$2::date) as value", [f.employeeId, day]);
    expect(evidence.blockers).toContain("WEEKLY_ROSTER_UNCONFIRMED");
    await f.punch();
    expect(await f.apply()).toMatchObject({ status: "P", origin: "punch" });
    await f.resolve("I");
    expect(await f.apply()).toMatchObject({ status: "I", origin: "manual" });
  });
  it("horário noturno estimado atribui a saída ao dia anterior sem criar presença no dia seguinte", async () => {
    const f = await fixture();
    await db.query("update public.monitoring_settings set payload=payload||'{\"start\":\"22:00\",\"end\":\"06:00\",\"estimated\":true,\"weeklyRosterConfirmed\":false}' where target=$1", [f.employeeId]);
    const next = await value<string>("select ($1::date+1)::text as value", [day]);
    await f.punch(`${next}T02:00:00-03:00`);
    expect(await f.apply()).toMatchObject({ status: "P", origin: "punch" });
    const following = await value<{ status: string | null; punchIds: string[] }>("select private.daily_call_evidence($1::uuid,$2::date) as value", [f.employeeId, next]);
    expect(following.status).toBeNull();
    expect(following.punchIds).toEqual([]);
  });
  it("dois relógios da mesma pessoa geram uma presença e preservam limpeza manual", async () => {
    const f = await fixture();
    await f.punch();
    const pisSource = `${f.sourceId}-pis`;
    await db.query("insert into public.monitoring_sources(id,kind,identity_namespace,configuration) values($1,'afd',$1,'{\"sourceIdentityConfirmed\":true}')", [pisSource]);
    await db.query("insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by) values($1,'pis','12345678900',$2::uuid,$3::date-30,'Cadastro PIS sintético conferido',$4::uuid)", [pisSource, f.employeeId, day, admin]);
    await db.query("insert into public.monitoring_events(source_id,event_key,payload_hash,event_type,identity_type,identity_value,occurred_at,classification,eligible,nsr,payload) values($1,'synthetic-pis',repeat('b',64),'punch','pis','12345678900',$2::timestamptz,'authorized',true,'000000001','{}')", [pisSource, `${day}T09:01:00-03:00`]);
    expect(await f.apply()).toMatchObject({ status: "P", origin: "punch", changed: true });
    const evidence = await value<{ punchIds: string[] }>("select private.daily_call_evidence($1::uuid,$2::date) as value", [f.employeeId, day]);
    expect(evidence.punchIds).toHaveLength(2);
    expect(await value<number>("select count(*)::integer as value from public.chamada_diaria where colaborador_id=$1::uuid and data=$2::date", [f.employeeId, day])).toBe(1);
    expect(await f.apply()).toMatchObject({ status: "P", changed: false });
    await f.resolve(null);
    expect(await f.apply()).toMatchObject({ status: null, state: "pending_manager" });
  });

  it.each([["cpf", "12345678909"], ["pis", "12345678900"]] as const)("relógio %s preenche P somente após confirmação da fonte, sem presumir escala ou cobertura", async (kind, identifier) => {
    const f = await fixture();
    await f.punch();
    await db.query("update public.monitoring_bindings set identity_type=$2,identity_value=$3 where source_id=$1", [f.sourceId, kind, identifier]);
    await db.query("update public.monitoring_events set identity_type=$2,identity_value=$3 where source_id=$1", [f.sourceId, kind, identifier]);
    await db.query("delete from public.monitoring_settings where kind='schedule' and target=$1", [f.employeeId]);
    await db.query("update public.monitoring_sources set configuration='{\"sourceIdentityConfirmed\":false}'::jsonb where id=$1", [f.sourceId]);
    expect(await f.apply()).toMatchObject({ status: null, state: "blocked" });

    await db.query("update public.monitoring_sources set configuration='{\"sourceIdentityConfirmed\":true}'::jsonb where id=$1", [f.sourceId]);
    expect(await f.apply()).toMatchObject({ status: "P", origin: "punch", changed: true });
    expect(await f.apply()).toMatchObject({ status: "P", origin: "punch", changed: false });
    const snapshot = await session("authenticated", admin, () => value<{ employees: Array<{ id: string; attendance: Array<{ origin: string }> }> }>("select public.ler_chamada_diaria($1::date,$1::date,$1::date) as value", [day]));
    expect(snapshot.employees.find(employee => employee.id === f.employeeId)?.attendance[0]).toMatchObject({ origin: "punch" });
  });

  it.each([[-60, "I"], [0, "I"], [480, "I"], [481, null]])("saldo %i e evidência completa => %s", async (balance, status) => {
    const f = await fixture(balance as number);
    expect(await f.apply()).toMatchObject({ status, state: status ? "automatic_absence" : "pending_manager", origin: status ? "automatic_absence" : null });
    expect(await f.apply()).toMatchObject({ changed: false, status });
  });
  it.each(["source", "fragment", "identity", "balance", "schedule", "compensation", "binding"])("bloqueia falta com evidência insuficiente: %s", async (caseName) => {
    const f = await fixture(caseName === "balance" ? null : 0);
    if (caseName === "source") await db.query("update public.monitoring_sources set configuration=configuration||'{\"sourceIdentityConfirmed\":false}' where id=$1", [f.sourceId]);
    if (caseName === "fragment") await db.query("update public.monitoring_files set rejected_rows=1 where source_id=$1", [f.sourceId]);
    if (caseName === "identity") await db.query("delete from public.monitoring_bindings where employee_id=$1::uuid", [f.employeeId]);
    if (caseName === "schedule") await db.query("delete from public.monitoring_settings where target=$1", [f.employeeId]);
    if (caseName === "compensation") await db.query("insert into public.chamada_diaria(colaborador_id,data,status) values($1::uuid,$2::date-1,'G')", [f.employeeId, day]);
    if (caseName === "binding") {
      const other = await fixture();
      await db.query("insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by) values($1,'cpf',$2,$3::uuid,$4::date-1,'Conflito sintético de identidade',$5::uuid)", [f.sourceId, f.identity, other.employeeId, day, admin]);
    }
    expect(await f.apply()).toMatchObject({ status: null, state: "blocked" });
    expect((await f.queue()).rows[0].blockers.length).toBeGreaterThan(0);
  });
  it.each(["today", "future", "vacation", "before_admission", "unknown_admission", "off_day"])("não gera I em dia não elegível: %s", async (caseName) => {
    const date = caseName === "today" ? today : caseName === "future" ? "2099-01-01" : day;
    const f = await fixture(0, date);
    if (caseName === "vacation") await db.query("update public.colaboradores set situacao='FERIAS' where id=$1::uuid", [f.employeeId]);
    if (caseName === "before_admission") await db.query("update public.colaboradores set admissao=$2::date+1 where id=$1::uuid", [f.employeeId, day]);
    if (caseName === "unknown_admission") await db.query("update public.colaboradores set admissao=null where id=$1::uuid", [f.employeeId]);
    if (caseName === "off_day") await db.query("update public.monitoring_settings set payload=jsonb_set(payload,'{days}','[]') where target=$1", [f.employeeId]);
    expect(await f.apply()).toMatchObject({ status: null });
  });
  it("P válido único confirma presença e corrige I automático tardio", async () => {
    const f = await fixture();
    expect((await f.apply()).status).toBe("I");
    await f.punch();
    expect(await f.apply()).toMatchObject({ status: "P", origin: "punch", changed: true });
    const snapshot = await session("authenticated", admin, () => value<{ employees: Array<{ id: string; attendance: Array<{ origin: string }> }> }>("select public.ler_chamada_diaria($1::date,$1::date,$1::date) as value", [day]));
    expect(snapshot.employees.find((e) => e.id === f.employeeId)?.attendance[0].origin).toBe("punch");
  });
  it("I manual, férias manuais e limpeza manual vencem reimportação", async () => {
    const f = await fixture();
    await f.resolve("I"); await f.punch();
    expect(await f.apply()).toMatchObject({ status: "I", origin: "manual" });
    await f.resolve("X");
    expect(await f.apply()).toMatchObject({ status: "X", origin: "manual" });
    await f.resolve(null);
    expect(await f.apply()).toMatchObject({ status: null, state: "pending_manager" });
  });
  it("ponto rejeitado/conflitante/fonte não comprovada não confirma P", async () => {
    const f = await fixture(); await f.punch();
    await db.query("update public.monitoring_events set conflicted=true where source_id=$1", [f.sourceId]);
    await db.query("update public.monitoring_files set conflict_rows=1 where source_id=$1", [f.sourceId]);
    expect((await f.apply()).status).toBeNull();
    await db.query("update public.monitoring_events set conflicted=false where source_id=$1", [f.sourceId]);
    await db.query("update public.monitoring_sources set configuration=configuration||'{\"sourceIdentityConfirmed\":false}' where id=$1", [f.sourceId]);
    expect((await f.apply()).status).toBeNull();
  });
  it("CAS de decisão e revisão impedem resolver/fechar snapshot antigo", async () => {
    const f = await fixture(481);
    const before = await f.queue(); await f.apply();
    await expect(f.resolve("G", before.rows[0])).rejects.toMatchObject({ code: "PT409" });
    await expect(session("authenticated", admin, () => value("select public.daily_call_workflow('close',$1::jsonb) as value", [JSON.stringify({ date: day, managerId: f.managerId, expectedRevision: before.revision, reason: "Fechamento sintético conferido" })]))).rejects.toMatchObject({ code: "PT409" });
    const pending = await f.queue();
    await expect(session("authenticated", admin, () => value("select public.daily_call_workflow('close',$1::jsonb) as value", [JSON.stringify({ date: day, managerId: f.managerId, expectedRevision: pending.revision, reason: "Fechamento sintético conferido" })]))).rejects.toMatchObject({ code: "22023" });
    await f.resolve("G"); const ready = await f.queue();
    const closed = await session("authenticated", admin, () => value<{ closed: boolean; closedAt: string }>("select public.daily_call_workflow('close',$1::jsonb) as value", [JSON.stringify({ date: day, managerId: f.managerId, expectedRevision: ready.revision, reason: "Fechamento sintético conferido" })]));
    expect(workflowCloseResultSchema.parse(closed).closed).toBe(true); expect(closed.closedAt).toBeTruthy();
    expect((await f.queue()).days[0].closedAt).toBeTruthy();
    await f.resolve("I"); expect((await f.queue()).days[0].closedAt).toBeNull();
  });
  it("LEITURA não resolve, gestor não lê outra equipe, authenticated não importa", async () => {
    const f = await fixture();
    await db.query("update public.perfis set gestor_id=$1::uuid where id=$2::uuid", [f.managerId, managerUser]);
    const other = await fixture();
    const queue = await session("authenticated", managerUser, () => value<Queue>("select public.daily_call_workflow('queue',$1::jsonb) as value", [JSON.stringify({ start: day, end: day })]));
    expect(queue.rows.map((row) => row.employeeId)).toEqual([f.employeeId]);
    await expect(session("authenticated", reader, () => value("select public.daily_call_workflow('resolve','{}') as value"))).rejects.toMatchObject({ code: "42501" });
    await expect(session("authenticated", managerUser, () => value("select public.daily_call_workflow('resolve',$1::jsonb) as value", [JSON.stringify({ employeeId: other.employeeId, date: day, status: "G", reason: "Teste de escopo", expectedUpdatedAt: null, expectedDecisionVersion: "0" })]))).rejects.toMatchObject({ code: "42501" });
    await expect(session("authenticated", admin, () => value("select public.daily_call_apply_import('{}') as value"))).rejects.toMatchObject({ code: "42501" });
  });
  it("jornada noturna mantém batida após meia-noite no dia operacional", async () => {
    const f = await fixture();
    await db.query("update public.monitoring_settings set payload=payload||'{\"start\":\"22:00\",\"end\":\"06:00\"}' where target=$1", [f.employeeId]);
    const next = await value<string>("select ($1::date+1)::text as value", [day]);
    await f.punch(`${next}T02:00:00-03:00`);
    expect(await f.apply()).toMatchObject({ status: "P", origin: "punch" });
    const following = await value<{ status: string | null; punchIds: string[] }>("select private.daily_call_evidence($1::uuid,$2::date) as value", [f.employeeId, next]);
    expect(following.punchIds).toEqual([]);
  });
  it("namespace compartilhado concilia P e enfileira a fonte sem vínculo direto", async () => {
    const f = await fixture(); const peerSource = `${f.sourceId}-peer`;
    await db.query("insert into public.monitoring_sources(id,kind,identity_namespace,configuration,last_success_at) select $2,'afd',identity_namespace,configuration,last_success_at from public.monitoring_sources where id=$1", [f.sourceId, peerSource]);
    await f.punch();
    await db.query("update public.monitoring_events set source_id=$2 where source_id=$1", [f.sourceId, peerSource]);
    expect((await f.apply()).status).toBe("P");
    await db.query("delete from public.monitoring_jobs where employee_id=$1::uuid", [f.employeeId]);
    await db.query("select private.monitoring_enqueue($1::uuid,$2::date,$2::date,$3)", [f.employeeId, day, peerSource]);
    expect(await value<number>("select count(*)::integer as value from public.monitoring_jobs where employee_id=$1::uuid and operational_date=$2::date", [f.employeeId, day])).toBe(1);
  });
  it("fechamento mantém validade após alteração de outra equipe e versão global", async () => {
    const f = await fixture(); await f.resolve("F");
    const ready = await f.queue();
    await session("authenticated", admin, () => value("select public.daily_call_workflow('close',$1::jsonb) as value", [JSON.stringify({ date: day, managerId: f.managerId, expectedRevision: ready.revision, reason: "Fechamento sintético conferido" })]));
    const closedAt = (await f.queue()).days[0].closedAt;
    const other = await fixture(); await other.apply();
    await db.exec("update private.monitoring_revision set version=version+1");
    expect((await f.queue()).days[0].closedAt).toBe(closedAt);
    await db.exec("update private.monitoring_revision set version=version-1");
  });
  it("save_result atômico grava chamada; cobertura enfileira pessoa sem eventos", async () => {
    const f = await fixture();
    const count = await value<number>("select count(*)::integer as value from public.monitoring_jobs where employee_id=$1::uuid and operational_date=$2::date", [f.employeeId, day]);
    expect(count).toBe(1);
    const version = await value<number>("select version::integer as value from private.monitoring_revision where id=true");
    const result = await session("service_role", null, () => value<{ attendance: Applied }>("select public.monitoring_save_result($1::jsonb) as value", [JSON.stringify({ employeeId: f.employeeId, date: day, version, ruleVersion: "synthetic", result: {}, summary: {}, reason: "Verificação sintética atômica", actor: null })]));
    expect(result.attendance.status).toBe("I");
    expect(await value<number>("select count(*)::integer as value from public.monitoring_jobs where employee_id=$1::uuid and operational_date=$2::date", [f.employeeId, day])).toBe(0);
    await expect(session("service_role", null, () => value("select public.daily_call_apply_import($1::jsonb) as value", [JSON.stringify({ employeeId: f.employeeId, date: day, inputVersion: 0 })]))).rejects.toMatchObject({ code: "PT409" });
  });
});

describe("Revisão independente da ausência e confirmação manual", () => {
  it("arquivo ilegível sem monitoring_files bloqueia I até resolução da tentativa", async () => {
    const f = await fixture();
    await session("service_role", null, () => value("select public.monitoring_ingest($1::jsonb) as value", [JSON.stringify({ failure: { sourceId: f.sourceId, relativePath: "late-unreadable.txt", code: "AFD_INCOMPLETE_LAST_RECORD" } })]));
    await session("service_role", null, () => value("select public.monitoring_ingest($1::jsonb) as value", [JSON.stringify({ heartbeat: { sourceId: f.sourceId, state: "error", code: "AFD_INCOMPLETE_LAST_RECORD" } })]));
    expect(await f.apply()).toMatchObject({ status: null, state: "blocked" });
    expect((await f.queue()).rows[0].blockers).toContain("PUNCH_COVERAGE_UNCONFIRMED");
    await session("service_role", null, () => value("select public.monitoring_ingest($1::jsonb) as value", [JSON.stringify({ heartbeat: { sourceId: f.sourceId, state: "idle" } })]));
    expect(await f.apply()).toMatchObject({ status: null, state: "blocked" });
    await db.query("insert into public.monitoring_files(source_id,sha256,byte_length,relative_path,parser_version,status,expected_batches,metadata,completed_at) values($1,repeat('b',64),1,'late-unreadable.txt','synthetic','complete',1,'{}',now())", [f.sourceId]);
    expect(await f.apply()).toMatchObject({ status: "I", origin: "automatic_absence" });
  });

  it("confirmar mesmo I na Chamada comum impede substituição por ponto posterior", async () => {
    const f = await fixture();
    await f.apply();
    const row = (await f.queue()).rows[0];
    await session("authenticated", admin, () => value("select public.salvar_chamada_diaria($1::uuid,$2::date,'I',null,$3::timestamptz) as value", [f.employeeId, day, row.updatedAt]));
    await f.punch();
    expect(await f.apply()).toMatchObject({ status: "I", origin: "manual" });
  });

  it("falha posterior enfileira revisão de I automático já persistido", async () => {
    const f = await fixture();
    await f.apply();
    await db.query("delete from public.monitoring_jobs where employee_id=$1::uuid", [f.employeeId]);
    await session("service_role", null, () => value("select public.monitoring_ingest($1::jsonb) as value", [JSON.stringify({ failure: { sourceId: f.sourceId, relativePath: "later-unreadable.txt", code: "AFD_INCOMPLETE_LAST_RECORD" } })]));
    await session("service_role", null, () => value("select public.monitoring_ingest($1::jsonb) as value", [JSON.stringify({ heartbeat: { sourceId: f.sourceId, state: "error", code: "AFD_INCOMPLETE_LAST_RECORD" } })]));
    expect(await value<number>("select count(*)::int value from public.monitoring_jobs where employee_id=$1::uuid and operational_date=$2::date", [f.employeeId, day])).toBe(1);
  });

  it("vigência parcial na janela de virada de dia bloqueia falta automática", async () => {
    const f = await fixture();
    const previous = await value<string>("select ($1::date-1)::text value", [day]);
    await db.query("update public.monitoring_bindings set valid_from=$2::date where employee_id=$1::uuid", [f.employeeId, day]);
    await db.query("update public.monitoring_settings set payload=payload||'{\"start\":\"00:30\",\"end\":\"08:30\"}' where target=$1", [f.employeeId]);
    await f.punch(`${previous}T23:55:00-03:00`);
    expect(await f.apply()).toMatchObject({ status: null, state: "blocked" });
  });
});
