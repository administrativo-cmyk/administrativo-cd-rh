import { readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseReferenceDate, runDryImport, type DryRunSummary, type ImportIssue, type PreviousSnapshot } from "../lib/hr-import/pipeline.ts";

export function parseArgs(argv: string[]): { source: string; reference?: string; previous?: string; referenceDate?: string } {
  const options: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") throw new Error("--apply está proibido na Etapa 5A");
    if (arg === "--dry-run") continue;
    if (!["--source", "--reference", "--previous-snapshot", "--reference-date", "--as-of"].includes(arg)) throw new Error(`Opção desconhecida: ${arg}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Valor ausente para ${arg}`);
    options[arg] = value;
  }
  if (!options["--source"]) throw new Error("Informe --source dentro de data/private/");
  if (options["--as-of"] && options["--reference-date"] && options["--as-of"] !== options["--reference-date"]) {
    throw new Error("--as-of e --reference-date divergentes");
  }
  const referenceDate = options["--reference-date"] ?? options["--as-of"];
  if (referenceDate && (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate) || !parseReferenceDate(referenceDate))) {
    throw new Error("--reference-date deve ser uma data ISO válida (YYYY-MM-DD)");
  }
  return { source: options["--source"], reference: options["--reference"], previous: options["--previous-snapshot"], referenceDate };
}

async function requirePrivateFile(path: string, privateRoot: string): Promise<string> {
  const actual = await realpath(resolve(path));
  const relativePath = relative(privateRoot, actual);
  if (relativePath.startsWith("..") || isAbsolute(relativePath) || !relativePath) {
    throw new Error("Arquivos de RH devem permanecer em data/private/");
  }
  return actual;
}

function quoteCsv(value: string | number | undefined): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function csvIssues(issues: ImportIssue[]): string {
  const rows = ["severidade,codigo,aba,linha,matricula"];
  for (const issue of issues) rows.push([
    issue.severity, issue.code, issue.sheet, issue.row, issue.matricula,
  ].map(quoteCsv).join(","));
  return `${rows.join("\n")}\n`;
}

export function summaryMarkdown(summary: DryRunSummary): string {
  const codes = Object.entries(summary.issues.byCode).sort(([a], [b]) => a.localeCompare(b));
  const list = (items: Record<string, number>) => Object.entries(items).map(([key, value]) => `| ${key} | ${value} |`).join("\n") || "| Nenhum | 0 |";
  return `# Dry-run de importação RH - Etapa 5A.1

Este relatório contém somente agregados. A base operacional é o XLSX bruto; o tratado é referência opcional. Nenhuma escrita remota foi executada. O arquivo bruto atual é uma amostra histórica parcialmente tratada e não serve para a primeira carga real.

## Fonte bruta

- Abas: ${summary.source.sheets.join(", ")}.
- Data de referência resolvida: ${summary.source.snapshotDate ?? "não informada"}; origem: ${summary.source.dateOrigin ?? "nenhuma"}. A data do golden master e timestamps do filesystem nunca são usados como data da fonte.
- Quadro: ${summary.source.records.quadro} linhas; Banco de horas: ${summary.source.records.bank}; Férias: ${summary.source.records.vacation}; Gerente | Gestor: ${summary.source.records.manager}.
- População normalizada: ${summary.population.total}; mensurados: ${summary.population.measured}; fora da mensuração: ${summary.population.outsideMeasurement}.

| Unidade | Colaboradores |
| --- | ---: |
${list(summary.population.units)}

| Situação normalizada | Colaboradores |
| --- | ---: |
${list(summary.population.situations)}

## Cruzamentos

- Gestores únicos: ${summary.managers.unique}; colaboradores com gestor: ${summary.managers.withManager}; sem gestor: ${summary.managers.withoutManager}, dos quais ${summary.managers.measuredWithoutManager} mensurados. Todos permanecem no plano com vínculo pendente e agrupamento "Sem gestor definido".
- Linhas de gestor sem Quadro: ${summary.managers.orphanRows}; conflitos de unidade Quadro × gestor: ${summary.managers.unitConflicts}.
- Quadro ∩ Banco: ${summary.bank.both}; somente Quadro: ${summary.bank.onlyQuadro}; somente Banco: ${summary.bank.onlyBank}.
- Mensurados sem extrato no lote: ${summary.bank.measuredWithoutExtract}. Esses casos **não** são saldo zero.
- Conflitos de nome Quadro × Banco: ${summary.bank.nameConflicts}; conflitos de unidade: ${summary.bank.unitConflicts}.
- Quadro ∩ Férias: ${summary.vacation.both}; somente Quadro: ${summary.vacation.onlyQuadro}; somente Férias: ${summary.vacation.onlyVacation}; conflitos de nome: ${summary.vacation.nameConflicts}.

## Banco de horas e histórico

- Linhas válidas: ${summary.bank.rows}; positivas: ${summary.bank.positive}; zero: ${summary.bank.zero}; negativas nesta amostra: ${summary.bank.negative}.
- Faixa de saldo: ${summary.bank.minMinutes ?? "indisponível"} a ${summary.bank.maxMinutes ?? "indisponível"} minutos.
- O arquivo histórico atual teve colaboradores com saldo negativo removidos manualmente antes da análise. Esta ausência é informativa, **não é blocker**. O parser aceita sinais positivos, zero e negativos.
- Modo histórico: ${summary.history.mode}. Movimentos: ${JSON.stringify(summary.history.movements)}. Na primeira carga ninguém é marcado automaticamente como novo admitido.

## Golden master opcional

${summary.golden ? `- Abas: ${summary.golden.sheets.join(", ")}.
- Snapshot do tratado: ${summary.golden.snapshotDate ?? "não identificado"}; Quadro Atual: ${summary.golden.quadroRows}; Banco de Horas: ${summary.golden.bankRows}.
- Quadro em comum: ${summary.golden.overlap}; divergências de unidade: ${summary.golden.unitDifferences}; situação: ${summary.golden.situationDifferences}; gestor: ${summary.golden.managerDifferences}; jornada: ${summary.golden.journeyDifferences}.
- No Banco tratado atual: ${summary.golden.currentPositive} positivos, ${summary.golden.currentZero} zeros e ${summary.golden.currentNegative} negativos.
- Decimal × HH:MM no tratado: ${summary.golden.hhmmCompared} comparações, ${summary.golden.hhmmDisagreements} divergências acima de 1 minuto.
- Saldo atual exatamente igual em ${summary.golden.balanceExactMatches}/${summary.golden.balanceCompared} linhas comparáveis. **Não interpretar diferenças individuais como erro**, pois a data da fonte bruta não é comprovada e a amostra foi filtrada.
` : "- Referência não fornecida. O fluxo operacional continua independente dela.\n"}
## Validação e decisão

- BLOCKERS: ${summary.issues.BLOCKER}; WARNINGS: ${summary.issues.WARNING}; INFO: ${summary.issues.INFO}.

| Código | Ocorrências |
| --- | ---: |
${codes.map(([code, number]) => `| ${code} | ${number} |`).join("\n")}

- Escritas remotas: **0**. Dry-run não instancia cliente administrativo nem executa INSERT/UPDATE/UPSERT/DELETE.
- Política: gestor ausente e sem extrato são WARNING; matrícula duplicada, unidade principal desconhecida, saldo necessário inválido, identidade ambígua e data sem fonte confiável/sem --reference-date são BLOCKER.
- Primeira carga real: requer um novo export atual, completo, sem filtros ou tratamento manual, novo dry-run e autorização explícita. Este relatório histórico não libera --apply nem a Etapa 5B.
`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const privateRoot = await realpath(join(process.cwd(), "data", "private"));
  const source = await requirePrivateFile(args.source, privateRoot);
  const reference = args.reference ? await requirePrivateFile(args.reference, privateRoot) : undefined;
  const previousPath = args.previous ? await requirePrivateFile(args.previous, privateRoot) : undefined;
  const previous = previousPath ? JSON.parse(await readFile(previousPath, "utf8")) as PreviousSnapshot : undefined;
  const result = await runDryImport(source, reference, previous, args.referenceDate);

  await writeFile(join(privateRoot, "hr-import-details.json"), JSON.stringify({ planFingerprint: result.summary.planFingerprint, ...result.private }, null, 2), "utf8");
  await writeFile(join(privateRoot, "hr-import-errors.csv"), csvIssues(result.private.issues), "utf8");
  await writeFile(join(privateRoot, "hr-import-current-snapshot.json"), JSON.stringify({ employees: result.private.employees }, null, 2), "utf8");
  await writeFile(join(process.cwd(), "docs", "HR_IMPORT_DRY_RUN.md"), summaryMarkdown(result.summary), "utf8");

  const publicSummary = { ...result.summary, planFingerprint: undefined };
  console.log(JSON.stringify(publicSummary, null, 2));
  if (result.summary.issues.BLOCKER > 0) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Falha desconhecida no dry-run");
    process.exitCode = 1;
  });
}
