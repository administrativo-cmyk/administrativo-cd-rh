import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { assertBaselinePlan, assertOfficialProject, BASELINE_DATE, BASELINE_SOURCE_HASH, baselineSql, OFFICIAL_PROJECT_REF, sourceHash } from "../lib/hr-import/apply.ts";
import { parseReferenceDate, runDryImport, type DryRunSummary, type ImportIssue, type PreviousSnapshot } from "../lib/hr-import/pipeline.ts";

const execFileAsync = promisify(execFile);

export function parseArgs(argv: string[]): { source: string; reference?: string; previous?: string; referenceDate?: string; apply: boolean; projectRef?: string } {
  const options: Record<string, string> = {};
  let apply = false;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") { apply = true; continue; }
    if (arg === "--dry-run") { dryRun = true; continue; }
    if (!["--source", "--reference", "--previous-snapshot", "--reference-date", "--as-of", "--project-ref"].includes(arg)) throw new Error(`Opção desconhecida: ${arg}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Valor ausente para ${arg}`);
    options[arg] = value;
  }
  if (!options["--source"]) throw new Error("Informe --source dentro de data/private/");
  if (apply && dryRun) throw new Error("--apply e --dry-run são mutuamente exclusivos");
  if (options["--as-of"] && options["--reference-date"] && options["--as-of"] !== options["--reference-date"]) {
    throw new Error("--as-of e --reference-date divergentes");
  }
  const referenceDate = options["--reference-date"] ?? options["--as-of"];
  if (referenceDate && (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate) || !parseReferenceDate(referenceDate))) {
    throw new Error("--reference-date deve ser uma data ISO válida (YYYY-MM-DD)");
  }
  if (apply && (!options["--reference-date"] || referenceDate !== BASELINE_DATE)) {
    throw new Error(`--apply exige --reference-date ${BASELINE_DATE}`);
  }
  if (apply && options["--project-ref"] !== OFFICIAL_PROJECT_REF) {
    throw new Error(`--apply exige --project-ref ${OFFICIAL_PROJECT_REF}`);
  }
  if (apply && (options["--reference"] || options["--previous-snapshot"])) {
    throw new Error("--apply aceita somente a fonte bruta da baseline, sem referência ou snapshot anterior");
  }
  return { source: options["--source"], reference: options["--reference"], previous: options["--previous-snapshot"], referenceDate, apply, projectRef: options["--project-ref"] };
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

async function supabaseCli(args: string[]): Promise<string> {
  const cli = resolve("node_modules", "supabase", "dist", "supabase.js");
  try {
    const { stdout } = await execFileAsync(process.execPath, [cli, ...args], { cwd: process.cwd(), maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const output = `${String((error as { stdout?: string }).stdout ?? "")}\n${String((error as { stderr?: string }).stderr ?? "")}`;
    if (output.includes("BASELINE_ALREADY_APPLIED")) throw new Error("BASELINE_ALREADY_APPLIED: lote já aplicado; nenhuma linha duplicada");
    if (output.includes("BASELINE_REMOTE_STATE_CHANGED")) throw new Error("BASELINE_REMOTE_STATE_CHANGED: estado remoto inesperado; nenhuma escrita confirmada");
    if (output.includes("BASELINE_POSTCONDITION_FAILED")) throw new Error("BASELINE_POSTCONDITION_FAILED: transação revertida");
    throw new Error("Falha na CLI Supabase; a transação deve ser auditada no projeto oficial antes de qualquer nova tentativa");
  }
}

function cliJson(output: string): unknown {
  const firstLine = output.split(/\r?\n/).find((line) => line.trim().startsWith("{"));
  if (!firstLine) throw new Error("Resposta da CLI sem JSON verificável");
  return JSON.parse(firstLine) as unknown;
}

async function applyBaseline(source: string, result: Awaited<ReturnType<typeof runDryImport>>): Promise<void> {
  if (basename(source) !== "Banco de dados RH.xlsx") throw new Error("Fonte oficial inválida para --apply");
  const hash = sourceHash(await readFile(source));
  if (hash !== BASELINE_SOURCE_HASH) throw new Error("SHA-256 divergente; --apply bloqueado");
  assertBaselinePlan(result);
  const projects = cliJson(await supabaseCli(["projects", "list", "--output-format", "json"]));
  const organizations = cliJson(await supabaseCli(["orgs", "list", "--output-format", "json"]));
  assertOfficialProject(projects, organizations);

  const privateRoot = await realpath(join(process.cwd(), "data", "private"));
  const sqlPath = join(privateRoot, `.baseline-apply-${randomUUID()}.sql`);
  try {
    await writeFile(sqlPath, baselineSql(result, hash), { encoding: "utf8", flag: "wx", mode: 0o600 });
    if (sourceHash(await readFile(source)) !== hash) throw new Error("Arquivo fonte mudou durante o preflight; apply bloqueado");
    const output = await supabaseCli(["db", "query", "--linked", "--project-ref", OFFICIAL_PROJECT_REF,
      "--file", sqlPath, "--output-format", "json"]);
    // CLI output contains only the database-generated aggregate result, never the source rows.
    console.log(output);
  } finally {
    await unlink(sqlPath).catch(() => undefined);
  }
}

export function summaryMarkdown(summary: DryRunSummary): string {
  const codes = Object.entries(summary.issues.byCode).sort(([a], [b]) => a.localeCompare(b));
  const list = (items: Record<string, number>) => Object.entries(items).map(([key, value]) => `| ${key} | ${value} |`).join("\n") || "| Nenhum | 0 |";
  return `# Dry-run de importação RH

Este relatório contém somente agregados. A base operacional é o XLSX bruto; o tratado é referência opcional. Nenhuma escrita remota foi executada. A completude e atualidade do export exigem confirmação de proveniência além do parsing.

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
- O parser aceita sinais positivos, zero e negativos. A ausência de negativos isoladamente não demonstra filtragem; a presença deles isoladamente não comprova completude do export.
- Modo histórico: ${summary.history.mode}. Movimentos: ${JSON.stringify(summary.history.movements)}. Na primeira carga ninguém é marcado automaticamente como novo admitido.

## Golden master opcional

${summary.golden ? `- Abas: ${summary.golden.sheets.join(", ")}.
- Snapshot do tratado: ${summary.golden.snapshotDate ?? "não identificado"}; Quadro Atual: ${summary.golden.quadroRows}; Banco de Horas: ${summary.golden.bankRows}.
- Quadro em comum: ${summary.golden.overlap}; divergências de unidade: ${summary.golden.unitDifferences}; situação: ${summary.golden.situationDifferences}; gestor: ${summary.golden.managerDifferences}; jornada: ${summary.golden.journeyDifferences}.
- No Banco tratado atual: ${summary.golden.currentPositive} positivos, ${summary.golden.currentZero} zeros e ${summary.golden.currentNegative} negativos.
- Decimal × HH:MM no tratado: ${summary.golden.hhmmCompared} comparações, ${summary.golden.hhmmDisagreements} divergências acima de 1 minuto.
- Saldo atual exatamente igual em ${summary.golden.balanceExactMatches}/${summary.golden.balanceCompared} linhas comparáveis. **Não interpretar diferenças individuais como erro** sem confirmar equivalência temporal e populacional das fontes.
` : "- Referência não fornecida. O fluxo operacional continua independente dela.\n"}
## Validação e decisão

- BLOCKERS: ${summary.issues.BLOCKER}; WARNINGS: ${summary.issues.WARNING}; INFO: ${summary.issues.INFO}.

| Código | Ocorrências |
| --- | ---: |
${codes.map(([code, number]) => `| ${code} | ${number} |`).join("\n")}

- Escritas remotas: **0**. Dry-run não instancia cliente administrativo nem executa INSERT/UPDATE/UPSERT/DELETE.
- Política: gestor ausente e sem extrato são WARNING; matrícula duplicada, unidade principal desconhecida, saldo necessário inválido, identidade ambígua e data sem fonte confiável/sem --reference-date são BLOCKER.
- O dry-run acima não executou \`--apply\`. A aplicação e a auditoria posteriores da baseline constam em \`HR_BASELINE_IMPORT.md\`.
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

  if (args.apply) {
    await applyBaseline(source, result);
    return;
  }

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
    console.error(error instanceof Error ? error.message : "Falha desconhecida na importação");
    process.exitCode = 1;
  });
}
