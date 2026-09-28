import { createHash } from "node:crypto";
import { comparableText } from "./normalize.ts";
import type { DryRunResult } from "./pipeline.ts";

export const OFFICIAL_PROJECT_REF = "kqgtnucqxqqgwdyvhvdd";
export const BASELINE_DATE = "2026-09-28";
export const BASELINE_SOURCE_HASH = "D9C64510B904D89959957EC6A6CA80E454C08CC591F18A36C143E0AE16CE7D17";

export function sourceHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

export function assertOfficialProject(projects: unknown, organizations: unknown): void {
  const rows = (projects as { projects?: Array<Record<string, unknown>> })?.projects;
  const orgs = (organizations as { organizations?: Array<Record<string, unknown>> })?.organizations;
  const project = rows?.find((row) => row.ref === OFFICIAL_PROJECT_REF);
  if (!project || project.name !== "administrativo-cd-rh" || project.region !== "sa-east-1" || project.linked !== true) {
    throw new Error("Projeto oficial não confirmado ou workspace não vinculado");
  }
  const organization = orgs?.find((row) => row.id === project.organization_id);
  if (!organization || organization.name !== "Administrativo CD") {
    throw new Error("Organização Administrativo CD não confirmada");
  }
}

export function assertBaselinePlan(result: DryRunResult): void {
  const { summary, private: plan } = result;
  if (summary.issues.BLOCKER !== 0 || summary.source.snapshotDate !== BASELINE_DATE ||
      summary.history.mode !== "BASELINE" || summary.golden !== null ||
      summary.issues.WARNING !== 50 || summary.issues.INFO !== 67 ||
      summary.source.records.quadro !== 384 || summary.source.records.bank !== 356 ||
      summary.population.total !== 384 || summary.population.measured !== 367 ||
      summary.managers.unique !== 32 || summary.managers.withoutManager !== 26 ||
      summary.managers.measuredWithoutManager !== 9 || summary.bank.rows !== 356 ||
      summary.bank.positive !== 183 || summary.bank.zero !== 35 || summary.bank.negative !== 138 ||
      summary.bank.onlyQuadro !== 28 || summary.bank.measuredWithoutExtract !== 12 ||
      plan.employees.length !== 384 || plan.bank.length !== 356) {
    throw new Error("Plano da baseline diverge da homologação; apply bloqueado");
  }
  const names = new Map<string, string>();
  for (const employee of plan.employees) {
    if (!employee.gestor) continue;
    const key = comparableText(employee.gestor);
    const prior = names.get(key);
    if (prior && prior !== employee.gestor) {
      throw new Error("Nomes de gestores ambíguos; apply bloqueado");
    }
    names.set(key, employee.gestor);
  }
  if (names.size !== 32 || plan.bank.some((entry) => !plan.employees.some((employee) => employee.matricula === entry.matricula))) {
    throw new Error("Identidade de gestor ou medição inválida; apply bloqueado");
  }
}

export function baselineSql(result: DryRunResult, hash: string): string {
  assertBaselinePlan(result);
  if (hash !== BASELINE_SOURCE_HASH) throw new Error("SHA-256 divergente; apply bloqueado");
  const payload = {
    employees: result.private.employees.map(({ matricula, nome, unidade, setor, funcao, situacao, admissao, jornadaMinutos, gestor }) =>
      ({ matricula, nome, unidade, setor, funcao, situacao, admissao, jornadaMinutos, gestor })),
    bank: result.private.bank.map(({ matricula, saldoMinutos }) => ({ matricula, saldoMinutos })),
  };
  const warnings = { total: result.summary.issues.WARNING, byCode: result.summary.issues.byCode };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const encodedWarnings = Buffer.from(JSON.stringify(warnings), "utf8").toString("base64");
  return `select private.aplicar_baseline_rh(
  '${OFFICIAL_PROJECT_REF}', '${hash}', date '${BASELINE_DATE}',
  convert_from(decode('${encodedPayload}', 'base64'), 'UTF8')::jsonb,
  convert_from(decode('${encodedWarnings}', 'base64'), 'UTF8')::jsonb
) as resultado;\n`;
}
