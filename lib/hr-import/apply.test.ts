import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { assertBaselinePlan, assertOfficialProject, BASELINE_DATE, BASELINE_SOURCE_HASH, baselineSql, sourceHash } from "./apply";
import type { DryRunResult } from "./pipeline";

function fictionalPlan(): DryRunResult {
  const employees = Array.from({ length: 384 }, (_, index) => ({
    matricula: `F${String(index + 1).padStart(4, "0")}`,
    nome: `Pessoa Fictícia ${index + 1}`,
    unidade: (["CD I", "CD II", "CD FLV"] as const)[index % 3],
    setor: "Setor fictício", funcao: "Função fictícia",
    situacao: index < 367 ? "ATIVO" as const : "AFASTADO" as const,
    situacaoOriginal: index < 367 ? "Ativo" : "Afastado",
    admissao: "2020-01-01", jornadaMinutos: ([440, 720, 360, 240] as const)[index % 4],
    gestor: index >= 367 || index < 9 ? null : `Gestor Fictício ${(index % 32) + 1}`,
    gerente: null, vinculoGestor: index >= 367 || index < 9 ? "VINCULO_GESTOR_PENDENTE" as const : "RESOLVIDO" as const,
    agrupamentoGestor: index >= 367 || index < 9 ? "Sem gestor definido" : `Gestor Fictício ${(index % 32) + 1}`,
  }));
  const measuredWithExtract = employees.slice(12, 367);
  const bankEmployees = [...measuredWithExtract, employees[367]];
  const bank = bankEmployees.map((employee, index) => ({
    matricula: employee.matricula, saldoMinutos: index < 183 ? 60 : index < 218 ? 0 : -60, dias: 0,
  }));
  return {
    summary: {
      source: { sheets: [], snapshotDate: BASELINE_DATE, dateOrigin: "EXPLICIT", records: { quadro: 384, bank: 356, manager: 0, vacation: 0 } },
      population: { total: 384, measured: 367, outsideMeasurement: 17, situations: {}, units: {} },
      managers: { unique: 32, withManager: 358, withoutManager: 26, measuredWithoutManager: 9, orphanRows: 0, unitConflicts: 0 },
      bank: { rows: 356, positive: 183, zero: 35, negative: 138, minMinutes: -60, maxMinutes: 60,
        both: 356, onlyQuadro: 28, onlyBank: 0, measuredWithoutExtract: 12, nameConflicts: 0, unitConflicts: 0 },
      vacation: { rows: 0, both: 0, onlyQuadro: 0, onlyVacation: 0, nameConflicts: 0 },
      history: { mode: "BASELINE", movements: {} }, golden: null,
      issues: { BLOCKER: 0, WARNING: 50, INFO: 67, byCode: { MISSING_MANAGER: 26 } },
      planFingerprint: "fictitious", remoteWrites: 0,
    },
    private: { employees, bank, vacation: [], issues: [], movements: [] },
  };
}

const schema = `
create role anon; create role authenticated; create role service_role;
create schema auth; create schema private;
create type public.tipo_importacao as enum ('EXCEL', 'GOOGLE_SHEETS', 'OUTRO');
create type public.status_importacao as enum ('PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'CONCLUIDO_COM_ERROS', 'FALHOU');
create type public.situacao_colaborador as enum ('ATIVO', 'FERIAS', 'NOVO_ADMITIDO', 'AFASTADO', 'DESLIGADO', 'AVISO_PREVIO', 'LICENCA_MATERNIDADE', 'ACIDENTE_TRABALHO', 'OUTRO_AFASTAMENTO');
create table auth.users (id uuid primary key);
create table public.perfis (id uuid primary key, status_usuario text, papel_usuario text);
create table public.unidades (id uuid primary key default gen_random_uuid(), codigo text unique not null);
create table public.gestores (id uuid primary key default gen_random_uuid(), nome text not null);
create table public.lotes_importacao (id uuid primary key default gen_random_uuid(), tipo public.tipo_importacao not null, fonte text,
  nome_arquivo text, data_referencia date, status public.status_importacao not null default 'PENDENTE',
  registros_processados int not null default 0, registros_com_erro int not null default 0);
create table public.colaboradores (id uuid primary key default gen_random_uuid(), matricula text unique not null, nome text not null,
  unidade_id uuid not null references public.unidades(id), gestor_id uuid references public.gestores(id), setor text, funcao text,
  situacao public.situacao_colaborador not null, admissao date, jornada_horas_dia_atual numeric(6,4) not null,
  ativo_no_sistema boolean not null, ultimo_lote_importacao_id uuid references public.lotes_importacao(id));
create table public.banco_horas_medicoes (id uuid primary key default gen_random_uuid(), colaborador_id uuid not null references public.colaboradores(id),
  data_medicao date not null, aplica_a_partir_de date not null, jornada_horas_dia numeric(6,4) not null,
  saldo_minutos int not null, origem text, lote_importacao_id uuid references public.lotes_importacao(id),
  unique (colaborador_id, aplica_a_partir_de));
create table public.chamada_diaria (id uuid primary key default gen_random_uuid());
create view public.vw_colaboradores_mensurados as select id, gestor_id from public.colaboradores
  where ativo_no_sistema and situacao in ('ATIVO', 'FERIAS', 'NOVO_ADMITIDO');
insert into auth.users values ('00000000-0000-4000-8000-000000000001');
insert into public.perfis values ('00000000-0000-4000-8000-000000000001', 'APROVADO', 'ADMIN');
insert into public.unidades (codigo) values ('CD I'), ('CD II'), ('CD FLV');
`;

async function fictionalDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(schema);
  await db.exec(readFileSync("supabase/migrations/20260928192834_baseline_import_provenance.sql", "utf8"));
  return db;
}

async function counts(db: PGlite): Promise<number[]> {
  const result = await db.query<{ managers: number; employees: number; measurements: number; lots: number }>(
    `select (select count(*) from public.gestores)::int as managers,
      (select count(*) from public.colaboradores)::int as employees,
      (select count(*) from public.banco_horas_medicoes)::int as measurements,
      (select count(*) from public.lotes_importacao)::int as lots`,
  );
  const row = result.rows[0];
  return [row.managers, row.employees, row.measurements, row.lots];
}

describe("baseline apply protection and transaction", () => {
  it("requires the confirmed linked organization and official project", () => {
    const projects = { projects: [{ ref: "kqgtnucqxqqgwdyvhvdd", name: "administrativo-cd-rh", region: "sa-east-1", linked: true, organization_id: "official" }] };
    const organizations = { organizations: [{ id: "official", name: "Administrativo CD" }] };
    expect(() => assertOfficialProject(projects, organizations)).not.toThrow();
    expect(() => assertOfficialProject({ projects: [{ ...projects.projects[0], linked: false }] }, organizations)).toThrow();
    expect(() => assertOfficialProject(projects, { organizations: [{ id: "official", name: "Nexsys" }] })).toThrow();
  });

  it("blocks changed hashes, blockers, and an unsafe manager identity", () => {
    const plan = fictionalPlan();
    expect(sourceHash(Buffer.from("fixture"))).not.toBe(BASELINE_SOURCE_HASH);
    expect(() => baselineSql(plan, "wrong")).toThrow("SHA-256");
    plan.summary.issues.BLOCKER = 1;
    expect(() => assertBaselinePlan(plan)).toThrow("Plano");
    plan.summary.issues.BLOCKER = 0;
    plan.private.employees[10].gestor = "GESTOR FICTÍCIO 11";
    expect(() => assertBaselinePlan(plan)).toThrow("ambíguos");
  });

  it("loads the fictional baseline once, rejects a duplicate, and keeps counts unchanged", async () => {
    const db = await fictionalDb();
    try {
      const plan = fictionalPlan();
      const payload = { employees: plan.private.employees, bank: plan.private.bank };
      const args = ["kqgtnucqxqqgwdyvhvdd", BASELINE_SOURCE_HASH, BASELINE_DATE, JSON.stringify(payload), JSON.stringify({ total: 50 })];
      await db.query("select private.aplicar_baseline_rh($1, $2, $3::date, $4::jsonb, $5::jsonb)", args);
      expect(await counts(db)).toEqual([32, 384, 356, 1]);
      await expect(db.query("select private.aplicar_baseline_rh($1, $2, $3::date, $4::jsonb, $5::jsonb)", args)).rejects.toThrow("BASELINE_ALREADY_APPLIED");
      expect(await counts(db)).toEqual([32, 384, 356, 1]);
      const audit = await db.query<{ positive: number; zero: number; negative: number }>(
        "select count(*) filter (where saldo_minutos > 0)::int as positive, count(*) filter (where saldo_minutos = 0)::int as zero, count(*) filter (where saldo_minutos < 0)::int as negative from public.banco_horas_medicoes",
      );
      expect(audit.rows[0]).toEqual({ positive: 183, zero: 35, negative: 138 });
    } finally { await db.close(); }
  }, 60_000);

  it("rolls back the lot, managers and employees when a later measurement fails", async () => {
    const db = await fictionalDb();
    try {
      const plan = fictionalPlan();
      plan.private.bank[355].matricula = "F9999";
      const args = ["kqgtnucqxqqgwdyvhvdd", BASELINE_SOURCE_HASH, BASELINE_DATE,
        JSON.stringify({ employees: plan.private.employees, bank: plan.private.bank }), "{}"];
      await expect(db.query("select private.aplicar_baseline_rh($1, $2, $3::date, $4::jsonb, $5::jsonb)", args)).rejects.toThrow("BASELINE_BANK_WITHOUT_EMPLOYEE");
      expect(await counts(db)).toEqual([0, 0, 0, 0]);
    } finally { await db.close(); }
  }, 60_000);
});
