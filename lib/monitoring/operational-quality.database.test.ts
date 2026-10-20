import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { calculateJourney, type JourneyCalculation, type Quality } from "./domain";
import { summarizeCalculation } from "./reprocess";

const migration = "20261020151927_monitoring_operational_quality_projection.sql";
const admin = "cf100000-0000-4000-8000-000000000001";
const manager = "cf100000-0000-4000-8000-000000000002";
const pending = "cf100000-0000-4000-8000-000000000003";
const employee = "cf200000-0000-4000-8000-000000000001";
const colleague = "cf200000-0000-4000-8000-000000000002";
const other = "cf200000-0000-4000-8000-000000000003";
const day = "2026-10-08";
let db: PGlite;
let migrationBefore: Record<string, unknown>;
let migrationAfter: Record<string, unknown>;

function calculation(): JourneyCalculation {
  const result = calculateJourney({
    personId: employee, operationalDate: day,
    observationWindow: { start: 0, end: 86_400_000 }, referenceAt: 86_400_000,
    punchEvents: [], accessEvents: [], mappings: [], coverage: [],
    evidence: { startConfirmed: false, endConfirmed: false, startCoverageConfirmed: false },
  });
  const metric = { milliseconds: 0, quality: "complete" as const, knownMs: 28_800_000, unknownMs: 0,
    coverageRatio: 1, intervals: [], eligibility: { state: "eligible" as const, policyIds: [], reasons: [] } };
  return { ...result, ruleVersion: "monitoring-1.5.0", workMs: 28_800_000, restMs: 3_600_000,
    journey: { ...result.journey, status: "complete" },
    outsideOperation: metric, cafeteria: metric,
    outsideCd: { ...metric, milliseconds: null, quality: "unavailable" },
    lateness: { ...result.lateness, quality: "complete", totalMs: 0, excessMs: 0, over15Minutes: false },
  };
}

async function fingerprint() {
  return (await db.query<Record<string, unknown>>(`select
    (select md5(coalesce(jsonb_agg(to_jsonb(r) order by id),'[]')::text) from public.monitoring_results r) results,
    (select count(*) from public.monitoring_jobs) jobs,
    (select count(*) from public.chamada_diaria) attendance,
    (select version from private.monitoring_revision) input_version,
    (select results_version from private.monitoring_revision) results_version`)).rows[0];
}

async function rpc(action: string, data: Record<string, unknown>, actor = manager, role = "authenticated") {
  await db.exec("savepoint query_rpc");
  try {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
    return (await db.query<{ value: Record<string, unknown> }>(
      "select public.monitoring_query($1,$2::jsonb) value", [action, JSON.stringify(data)])).rows[0].value;
  } catch (error) {
    await db.exec("rollback to savepoint query_rpc");
    throw error;
  } finally {
    await db.exec("reset role; release savepoint query_rpc");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for (const file of (await readdir("supabase/migrations")).filter(file => file.endsWith(".sql") && file < migration).sort()) {
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  }
  await db.exec(`insert into auth.users(id,email,raw_user_meta_data)
    select ('cf100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
      encode(sha256(convert_to('99555555'||lpad(i::text,3,'0'),'UTF8')),'hex')||'@auth.administrativo-cd.invalid',
      jsonb_build_object('nome_completo','Qualidade sintética '||i,'cpf_normalizado','99555555'||lpad(i::text,3,'0'))
      from generate_series(1,3) i;
    insert into public.gestores(nome) values('Gestor sintético da qualidade');
    update public.perfis set status_usuario='APROVADO',aprovado_em=now(),
      papel_usuario=case when id='${admin}' then 'ADMIN'::public.papel_usuario else 'GESTOR'::public.papel_usuario end,
      gestor_id=case when id='${manager}' then (select id from public.gestores where nome='Gestor sintético da qualidade') end
      where id in ('${admin}','${manager}');
    insert into public.colaboradores(id,matricula,nome,unidade_id,gestor_id,situacao,admissao)
    select ('cf200000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'QUAL-'||i,'Qualidade '||i,
      (select id from public.unidades where codigo='CD I'),
      case when i<3 then (select id from public.gestores where nome='Gestor sintético da qualidade') end,
      'ATIVO','2026-01-01' from generate_series(1,3) i;`);
  const complete = calculation();
  const unavailable = structuredClone(complete);
  unavailable.workMs = null;
  unavailable.outsideOperation = { ...unavailable.outsideOperation, milliseconds: null, quality: "unavailable" };
  unavailable.cafeteria = { ...unavailable.cafeteria, milliseconds: null, quality: "unavailable" };
  unavailable.lateness = { ...unavailable.lateness, totalMs: null, quality: "unavailable" };
  for (const [id, date, result, dirty] of [
    [employee, day, complete, false],
    [employee, "2026-10-09", unavailable, false],
    [employee, "2026-10-10", complete, true],
    [colleague, day, complete, false],
    [other, day, complete, false],
  ] as const) {
    const summary = { ...summarizeCalculation(result, ["GRUPO TESTE"], "Escala teste"),
      quality: result === unavailable ? "unavailable" : "partial", outsideCdSeconds: 123,
      bankDay: { status: "complete", balanceSeconds: -600, audit: "preserve" } };
    await db.query(`insert into public.monitoring_results(employee_id,operational_date,input_version,rule_version,result,summary,dirty,reason)
      values($1::uuid,$2::date,1,'monitoring-1.5.0',$3::jsonb,$4::jsonb,$5,'Synthetic original result')`,
    [id, date, JSON.stringify(result), JSON.stringify(summary), dirty]);
  }
  migrationBefore = await fingerprint();
  await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
  migrationAfter = await fingerprint();
}, 60_000);

afterAll(async () => { await db?.close(); });
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback; reset role"); });

describe("projeção histórica da qualidade operacional", () => {
  it("não regrava resultados, Chamada ou fila e invalida somente a versão da consulta", () => {
    expect(migrationAfter).toEqual({ ...migrationBefore, results_version: Number(migrationBefore.results_version) + 1 });
  });

  it("reproduz a qualidade TypeScript sem usar perímetro e preserva os demais campos", async () => {
    const cases: Array<{ summary: Record<string, unknown>; result: JourneyCalculation; expected: string }> = [];
    const qualities: Quality[] = ["complete", "partial", "unavailable", "excluded"];
    for (const operation of qualities) for (const cafeteria of qualities) for (const lateness of qualities) {
      for (const status of ["complete", "partial", "empty"] as const) for (const known of [true, false]) {
        const result = calculation();
        result.workMs = known ? 0 : null;
        result.journey.status = status;
        result.outsideOperation = { ...result.outsideOperation, quality: operation, milliseconds: known ? 0 : null };
        result.cafeteria = { ...result.cafeteria, quality: cafeteria, milliseconds: known ? 0 : null };
        result.lateness = { ...result.lateness, quality: lateness, totalMs: known ? 0 : null };
        cases.push({ result, summary: { quality: "partial", outsideCdSeconds: 123, bankDay: { signed: -300 }, mealsWithoutRest: 2 },
          expected: summarizeCalculation(result, [], null).quality });
      }
    }
    const rows = (await db.query<{ projected: Record<string, unknown> }>(`select
      private.monitoring_operational_summary(e->'summary',e->'result') projected
      from jsonb_array_elements($1::jsonb) e`, [JSON.stringify(cases)])).rows;
    expect(rows).toHaveLength(cases.length);
    rows.forEach((row, index) => expect(row.projected).toEqual({
      ...cases[index].summary, quality: cases[index].expected, outsideCdSeconds: null,
    }));
  });

  it("não promove envelopes incompletos nem cria resultado para ausência de dados", async () => {
    const rows = await db.query<{ missing: unknown; partial: unknown }>(`select
      private.monitoring_operational_summary(null,'{}') missing,
      private.monitoring_operational_summary('{"quality":"partial","bankDay":{"x":1}}','{}') partial`);
    expect(rows.rows[0]).toEqual({ missing: null, partial: { quality: "partial", bankDay: { x: 1 }, outsideCdSeconds: null } });
  });

  it("filtra qualidade projetada antes da paginação e agrega o escopo inteiro", async () => {
    const filters = { start: day, end: "2026-10-10", quality: "complete", group: "GRUPO TESTE", schedule: "Escala teste", limit: 1 };
    const first = await rpc("summary", filters);
    const second = await rpc("summary", { ...filters, offset: 1 });
    expect(first).toMatchObject({ total: 2, people: 2, pending: 0, totals: { workedSeconds: 57_600, assessedJourneys: 2 } });
    expect(first.rows).toMatchObject([{ employeeId: employee, quality: "complete", summary: { quality: "complete", outsideCdSeconds: null } }]);
    expect(second.rows).toMatchObject([{ employeeId: colleague, quality: "complete" }]);
    const stale = await rpc("summary", { start: day, end: "2026-10-10", quality: "stale" });
    expect(stale).toMatchObject({ total: 1, pending: 1, rows: [{ employeeId: employee, dirty: true, quality: "stale" }] });
    const unavailable = await rpc("summary", { start: day, end: "2026-10-10", quality: "unavailable" });
    expect(unavailable).toMatchObject({ total: 1, pending: 1 });
  });

  it("projeta o detalhe mantendo o resultado original versionado e o Banco", async () => {
    const before = await fingerprint();
    const detail = await rpc("detail", { employeeId: employee, start: day, end: day });
    expect(detail.results).toMatchObject([{ result: { ruleVersion: "monitoring-1.5.0", outsideCd: { quality: "unavailable" } },
      summary: { quality: "complete", outsideCdSeconds: null, bankDay: { balanceSeconds: -600, audit: "preserve" } } }]);
    expect(await fingerprint()).toEqual(before);
    const original = await db.query<{ summary: { quality: string; outsideCdSeconds: number } }>(
      "select summary from public.monitoring_results where employee_id=$1::uuid and operational_date=$2::date", [employee, day]);
    expect(original.rows[0].summary).toMatchObject({ quality: "partial", outsideCdSeconds: 123 });
  });

  it("mantém escopo do gestor, aprovação e negação de acesso direto ao helper", async () => {
    const filters = { start: day, end: day, quality: "complete" };
    expect(await rpc("summary", { ...filters, employeeId: other })).toMatchObject({ total: 0, rows: [] });
    await expect(rpc("detail", { employeeId: other, start: day, end: day })).rejects.toThrow("MONITORING_FORBIDDEN");
    expect(await rpc("summary", { ...filters, query: "Qualidade" }, admin)).toMatchObject({ total: 3 });
    await expect(rpc("summary", filters, pending)).rejects.toThrow("MONITORING_FORBIDDEN");
    await expect(rpc("summary", filters, "", "anon")).rejects.toThrow(/permission denied/);
    await db.exec("savepoint helper_acl; set role authenticated");
    await expect(db.query("select private.monitoring_operational_summary('{}','{}')")).rejects.toThrow(/permission denied/);
    await db.exec("rollback to savepoint helper_acl; reset role; release savepoint helper_acl");
  });
});
