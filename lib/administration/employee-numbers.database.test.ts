import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdministrationEmployee } from "./contracts";
import { employeeInputSchema } from "./contracts";
import type { ImportPreview } from "@/lib/monitoring/operations-contracts";

const admin = "fa100000-0000-4000-8000-000000000001";
const reader = "fa100000-0000-4000-8000-000000000002";
const employee = "fa200000-0000-4000-8000-000000000001";
let db: PGlite;
async function value<T>(sql: string, args: unknown[] = []): Promise<T> {
  return (await db.query<{ value: T }>(sql, args)).rows[0].value;
}
async function actor(id = admin) {
  await db.exec(`set local role authenticated;select set_config('request.jwt.claim.sub','${id}',true)`);
}
async function guarded<T>(work: () => Promise<T>) {
  await db.exec("savepoint action_guard");
  try { const result = await work(); await db.exec("release savepoint action_guard"); return result; }
  catch (error) { await db.exec("rollback to savepoint action_guard;release savepoint action_guard"); throw error; }
}
async function record() {
  return (await value<{ rows: AdministrationEmployee[] }>("select public.administration('employee','list','{}') value")).rows.find(row => row.id === employee)!;
}
async function save(changes: Record<string, unknown>) {
  const old = await record();
  // Older clients may omit aliases altogether.
  const rest = { ...old };
  delete rest.additionalEmployeeNumbers;
  return guarded(() => value<{ record: AdministrationEmployee }>("select public.administration('employee','save',$1::jsonb) value", [JSON.stringify({ ...rest, expectedUpdatedAt: old.updatedAt, reason: "Conferência sintética de matrículas", ...changes })]));
}
async function preview(number: string, name = "Pessoa Ágata Sintética", cpf = "52998224725", source = "numbers-old") {
  return value<ImportPreview>("select public.operational_import('preview',$1::jsonb) value", [JSON.stringify({ kind: "clock", metadata: { sha256: "a".repeat(64), fileName: `${source}-${number}.csv` }, defaults: { reason: "Cadastro sintético conferido", sourceId: source, validFrom: "2026-01-01", validTo: null }, rows: [{ line: 2, input: { employeeNumber: number, name, cpf }, errors: [] }] })]);
}
async function confirm(batch: ImportPreview) {
  return value<ImportPreview>("select public.operational_import('confirm',$1::jsonb) value", [JSON.stringify({ id: batch.id, expectedUpdatedAt: batch.updatedAt, lines: [2] })]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
  for (const file of (await readdir(path.resolve("supabase/migrations"))).filter(file => file.endsWith(".sql")).sort()) await db.exec(await readFile(path.join("supabase/migrations", file), "utf8"));
  for (const [id, cpf, role] of [[admin, "00000000111", "ADMIN"], [reader, "00000000112", "LEITURA"]]) {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1::uuid,encode(sha256(convert_to($2,'UTF8')),'hex')||'@auth.administrativo-cd.invalid',jsonb_build_object('nome_completo','Conta sintética','cpf_normalizado',$2))", [id, cpf]);
    await db.query("update public.perfis set status_usuario='APROVADO',papel_usuario=$2::public.papel_usuario,aprovado_em=now() where id=$1::uuid", [id, role]);
  }
}, 60000);
beforeEach(async () => {
  await db.exec("begin;reset role");
  await db.query("insert into public.colaboradores(id,matricula,nome,unidade_id,admissao) values($1,'52797','Pessoa Ágata Sintética',(select id from public.unidades limit 1),'2026-01-01')", [employee]);
  await db.exec("insert into public.monitoring_sources(id,kind,identity_namespace) values('numbers-old','afd','numbers-old'),('numbers-new','afd','numbers-new')");
  await actor();
});
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });

describe("matrículas adicionais no PostgreSQL isolado", () => {
  it("separa jornadas adiadas de falhas e volta a contar a jornada quando o turno inicia", async () => {
    await db.exec(`reset role;
      insert into public.monitoring_jobs(employee_id,operational_date,reason,last_error,leased_until)
      select id,day::date,'Teste de progresso',code,until_at
      from public.colaboradores cross join (values
        ('2026-10-20','AWAITING_SHIFT_START',now()+interval '1 hour'),
        ('2026-10-21','AWAITING_SHIFT_START',now()-interval '1 hour'),
        ('2026-10-22','CLOUD_REPROCESS_FAILED',now()+interval '1 minute')
      ) entries(day,code,until_at)
      where matricula='52797';
    `);
    await actor();
    const progress = await value("select public.monitoring_query('progress',$1::jsonb) value", [
      JSON.stringify({ start: "2026-10-20", end: "2026-10-22", employeeId: employee }),
    ]);
    expect(progress).toMatchObject({ deferred: 1, pending: 2, total: 2, failed: 1 });
  });

  it("pré-cadastra documentos recentes de importação concluída e oculta os já cadastrados", async () => {
    const list = () => value("select public.administration('employee','clock-preregistrations','{\"offset\":0}') value");
    await db.exec(`reset role;
      insert into public.monitoring_files(id,source_id,sha256,byte_length,relative_path,parser_version,expected_batches,metadata)
        values('fa300000-0000-4000-8000-000000000001','numbers-old',repeat('a',64),1,'synthetic.afd','test',1,'{}');
      insert into public.monitoring_events(source_id,event_key,payload_hash,event_type,identity_type,identity_value,occurred_at,classification,eligible,nsr,payload)
        select 'numbers-old',n,repeat('a',64),'punch','cpf',document,now()-age,'authorized',true,lpad(n,9,'0'),'{}'
        from (values ('1','52998224725',interval '1 day'),('2','52998224725',interval '2 days'),
                     ('3','12345678909',interval '21 days')) data(n,document,age);
      insert into public.monitoring_occurrences(file_id,occurrence_key,line,payload_hash,event_id,payload)
        select 'fa300000-0000-4000-8000-000000000001',event_key,1,repeat('a',64),id,'{}' from public.monitoring_events;
    `);
    await actor();
    expect(await list()).toEqual({ total: 0, rows: [] });
    await db.exec("reset role;update public.monitoring_files set status='complete',completed_at=now()");
    await actor();
    const pending = { kind: "cpf", document: "52998224725", sourceId: "numbers-old" };
    expect(await list()).toMatchObject({ total: 1, rows: [{ ...pending, employeeNumber: null, name: null }] });

    await db.exec(`reset role;
      insert into private.clock_preregistration_users(source_id,identity_type,identity_value,employee_number,normalized_name,file_sha256,source_row)
      values('numbers-old','cpf','52998224725','004321','pessoa agata nova',repeat('c',64),2);
    `);
    await actor();
    expect(await list()).toMatchObject({ total: 1, rows: [{ ...pending, employeeNumber: "004321", name: null }] });
    const imported = await preview("004321", "Pessoa Agata Nova");
    expect(imported.rows[0].errors).toEqual(["MATRICULA_NAO_ENCONTRADA"]);
    expect(await list()).toMatchObject({ total: 1, rows: [{ ...pending, employeeNumber: "004321", name: null }] });

    await db.exec(`reset role;
      insert into public.monitoring_sources(id,kind,identity_namespace) values('numbers-facial','defense-person','facial');
      insert into public.monitoring_files(id,source_id,sha256,byte_length,relative_path,parser_version,expected_batches,metadata,status,completed_at)
        values('fa300000-0000-4000-8000-000000000002','numbers-facial',repeat('b',64),1,'facial.xlsx','test',1,'{}','complete',now());
      insert into public.monitoring_people(source_id,external_id,name,groups,file_id) values
        ('numbers-facial','4321','Pessoa sem os zeros','[]','fa300000-0000-4000-8000-000000000002'),
        ('numbers-facial','004321','Outra pessoa','[]','fa300000-0000-4000-8000-000000000002');
    `);
    await actor();
    expect(await list()).toMatchObject({ total: 1, rows: [{ ...pending, employeeNumber: "004321", name: null }] });
    await db.exec("reset role; update public.monitoring_people set name='Pessoa Ágata Nova' where external_id='004321'");
    await actor();
    expect(await list()).toMatchObject({ total: 1, rows: [{ ...pending, employeeNumber: "004321", name: "Pessoa Ágata Nova" }] });
    await preview("004322", "Pessoa Agata Nova", pending.document, "numbers-new");
    expect(await list()).toMatchObject({ total: 1, rows: [{ ...pending, employeeNumber: "004321", name: "Pessoa Ágata Nova" }] });
    await preview("004323", "Pessoa Agata Nova");
    expect(await list()).toMatchObject({ total: 1, rows: [{ ...pending, employeeNumber: null, name: null }] });
    await actor(reader);
    await expect(guarded(list)).rejects.toThrow("ADMINISTRATION_FORBIDDEN");
    await actor();
    await save({ cpf: "52998224725" });
    expect(await list()).toEqual({ total: 0, rows: [] });
  });

  it("gênero permanece vazio sem fonte e aceita edição, omissão legada e limpeza explícita", async () => {
    expect((await record()).gender).toBeNull();
    expect((await save({ gender: "feminino" })).record.gender).toBe("feminino");
    expect((await save({ gender: undefined })).record.gender).toBe("feminino");
    expect((await save({ gender: "masculino" })).record.gender).toBe("masculino");
    expect((await save({ gender: null })).record.gender).toBeNull();
    await db.exec("reset role");
    const audit = await value<number>("select count(*)::int value from private.employee_lifecycle_audit where employee_id=$1::uuid and after_record->'gender'='null'::jsonb", [employee]);
    expect(audit).toBe(1);
  });

  it("rejeita gênero inválido no RPC e preserva a permissão administrativa", async () => {
    await expect(save({ gender: "suposto pelo nome" })).rejects.toThrow("EMPLOYEE_GENDER_INVALID");
    expect((await record()).gender).toBeNull();
    await actor(reader);
    await expect(save({ gender: "feminino" })).rejects.toThrow("FORBIDDEN");
  });
  it("persiste, busca e audita a matrícula antiga; omissão preserva, lista vazia remove", async () => {
    const saved = await save({ additionalEmployeeNumbers: ["46293", "000123"] });
    expect(saved.record.additionalEmployeeNumbers).toEqual(["000123", "46293"]);
    const found = await value<{ total: number }>("select public.administration('employee','list','{\"query\":\"46293\"}') value");
    expect(found.total).toBe(1);
    await save({ observation: "Cliente anterior sem campo de matrículas" });
    expect((await record()).additionalEmployeeNumbers).toEqual(["000123", "46293"]);
    await db.exec("reset role");
    expect(await value<string[]>("select after_record->'additionalEmployeeNumbers' value from private.administration_audit order by id desc limit 1")).toEqual(["000123", "46293"]);
    await actor();
    expect((await save({ additionalEmployeeNumbers: [] })).record.additionalEmployeeNumbers).toEqual([]);
  });
  it("preserva a principal anterior ao trocar de matrícula", async () => {
    expect((await save({ employeeNumber: "60000", additionalEmployeeNumbers: [] })).record.additionalEmployeeNumbers).toEqual(["52797"]);
    expect((await preview("52797")).rows[0].state).toBe("ready");
  });
  it("recusa matrícula de outra pessoa, payload inválido e edição sem permissão", async () => {
    await db.exec("reset role");
    await db.exec("insert into public.colaboradores(matricula,nome,unidade_id) select '99999','Outra pessoa',id from public.unidades limit 1");
    await actor();
    await expect(save({ additionalEmployeeNumbers: ["99999"] })).rejects.toThrow("EMPLOYEE_NUMBER_CONFLICT");
    await expect(save({ additionalEmployeeNumbers: null })).rejects.toThrow("EMPLOYEE_NUMBERS_INVALID");
    await expect(save({ employeeNumber: "60000", additionalEmployeeNumbers: "46293" })).rejects.toThrow("EMPLOYEE_NUMBERS_INVALID");
    await save({ additionalEmployeeNumbers: ["46293"] });
    await db.exec("reset role");
    await expect(guarded(() => db.exec("insert into public.colaboradores(matricula,nome,unidade_id) select '46293','Outra pessoa',id from public.unidades limit 1"))).rejects.toThrow("EMPLOYEE_NUMBER_CONFLICT");
    await actor(reader);
    await expect(guarded(() => value("select public.administration('employee','save',$1::jsonb) value", [JSON.stringify({ id: employee, additionalEmployeeNumbers: ["123"], reason: "Teste sem permissão" })]))).rejects.toThrow("ADMINISTRATION_FORBIDDEN");
    await expect(guarded(() => db.exec("select * from private.employee_numbers"))).rejects.toThrow("permission denied");
  });
  it("alerta por nome completo, mostra homônimos e nunca vincula só pelo nome", async () => {
    let batch = await preview("46293", "  pessoa   agata sintetica ");
    expect(batch.rows[0]).toMatchObject({ employeeId: null, state: "blocked", nameCandidates: [{ id: employee, employeeNumber: "52797" }] });
    expect(batch.rows[0].errors).toContain("MATRICULA_DIVERGENTE_MESMO_NOME");
    expect((await preview("46293", "Pessoa Ágata")).rows[0].nameCandidates).toEqual([]);
    await db.exec("reset role");
    await db.exec("insert into public.colaboradores(matricula,nome,unidade_id) select '99999','Pessoa Agata Sintetica',id from public.unidades limit 1");
    await actor();
    batch = await preview("46293");
    expect(batch.rows[0].nameCandidates).toHaveLength(2);
    expect((await confirm(batch)).rows[0].state).toBe("blocked");
    await save({ additionalEmployeeNumbers: ["46293"] });
    expect((await preview("46293")).rows[0]).toMatchObject({ employeeId: employee, state: "ready", nameCandidates: [] });
    // Even a known number must not bind a different name.
    expect((await preview("46293", "Outra pessoa")).rows[0].errors).toContain("NOME_DIVERGENTE");
  });
  it("reconcilia números antigo e atual e recupera batidas das duas identidades", async () => {
    await save({ additionalEmployeeNumbers: ["46293"] });
    const old = await confirm(await preview("46293"));
    const current = await confirm(await preview("52797", "Pessoa Ágata Sintética", "11144477735", "numbers-new"));
    expect(old.rows[0].state).toBe("applied");
    expect(current.rows[0].state).toBe("applied");
    expect((await confirm(old)).rows[0].state).toBe("applied");
    await db.exec("reset role");
    await db.exec("insert into public.monitoring_events(source_id,event_key,payload_hash,event_type,identity_type,identity_value,occurred_at,classification,eligible,nsr,payload) values('numbers-old','old',repeat('a',64),'punch','cpf','52998224725','2026-10-22T08:00:00-03:00','authorized',true,'000000001','{}'),('numbers-new','new',repeat('b',64),'punch','cpf','11144477735','2026-10-22T17:00:00-03:00','authorized',true,'000000002','{}')");
    const input = await value<{ events: Array<{ sourceId: string }> }>("select private.monitoring_input($1::uuid,'2026-10-22','2026-10-22') value", [employee]);
    expect(input.events.map(event => event.sourceId).sort()).toEqual(["numbers-new", "numbers-old"]);
    await actor();
    const call = await value<{ employees: Array<{ id: string; additionalEmployeeNumbers: string[] }> }>("select public.daily_call_read('2026-10-22','2026-10-22','2026-10-22') value");
    expect(call.employees.find(row => row.id === employee)?.additionalEmployeeNumbers).toEqual(["46293"]);
  });
  it("valida listas na API e preserva compatibilidade por omissão", async () => {
    const row = await record();
    const input = Object.fromEntries(Object.entries(row).filter(([key]) => !["id", "createdAt", "updatedAt", "activeInSystem", "defaultSchedule", "statusSignal"].includes(key)));
    expect(employeeInputSchema.safeParse({ ...input, reason: "Teste sintético" }).success).toBe(true);
    expect(employeeInputSchema.safeParse({ ...input, reason: "Teste sintético", additionalEmployeeNumbers: [" "] }).success).toBe(false);
    expect(employeeInputSchema.safeParse({ ...input, reason: "Teste sintético", additionalEmployeeNumbers: Array(21).fill("123") }).success).toBe(false);
  });
});
