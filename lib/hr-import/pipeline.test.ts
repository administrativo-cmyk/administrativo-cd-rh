import { afterAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { mkdtemp, readFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareSnapshots, runDryImport, type Employee } from "./pipeline";
import { parseArgs, summaryMarkdown } from "../../scripts/import-hr-data";

const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

async function fixture(options: { missingOperationalManager?: boolean; duplicateKey?: boolean; unknownUnit?: boolean; unknownSituation?: boolean; newAdmitted?: boolean; sourceReferenceDate?: string } = {}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "hr-import-fixture-"));
  directories.push(directory);
  const workbook = new ExcelJS.Workbook();
  const manager = workbook.addWorksheet("Gerente | Gestor");
  manager.addRow(["GERENTE", "GESTOR", "MATR.", "COLABORADOR", "UNID."]);
  manager.addRow(["Gerente Exemplo", "Gestora Exemplo", "0001", "Ana Fictícia", "CD I"]);
  manager.addRow(["Gerente Exemplo", "Gestora Outra", "0002", "Bruno Fictício", "CD II"]);
  manager.addRow(["Gerente Exemplo", "Gestora Exemplo", "0003", "Carla Fictícia", "CD FLV"]);
  if (!options.missingOperationalManager) manager.addRow(["Gerente Exemplo", "Gestora Outra", "0005", "Eva Fictícia", "CD I"]);

  const vacation = workbook.addWorksheet("Férias");
  vacation.addRow(["CHAPA", "FIM AQUISITIVO", "NOME", "AVOS", "COD FILIAL", "FILIAL", "INICIO AQUISITIVO"]);
  vacation.addRow(["0002", new Date("2026-12-31T00:00:00Z"), "Bruno Fictício", 9, 23, "CENTRO DE DISTRIBUICAO II", new Date("2026-01-01T00:00:00Z")]);

  workbook.addWorksheet("Metodologia").getCell("A1").value = "Fixture fictícia";

  const bank = workbook.addWorksheet("Banco de horas");
  bank.addRow(["SALDO POSITIVO", "SITUACAO", "FUNÇÃO", "DESCRICAO", "NOME", "CHAPA", "FILIAL"]);
  bank.addRow([0.5, "A", "ARMAZENISTA", "SETOR", "Ana Fictícia", "0001", "CENTRO DE DISTRIBUICAO"]);
  bank.addRow([0, "F", "APRENDIZ ADM", "SETOR", "Bruno Fictício", "0002", "CENTRO DE DISTRIBUICAO II"]);
  bank.addRow([-0.25, "A", "APOIO PREVENCAO E PERDAS", "SETOR", "Carla Fictícia", "0003", "CD FLV"]);

  const quadro = workbook.addWorksheet("Quadro");
  if (options.sourceReferenceDate) quadro.addRow(["Data de referência", options.sourceReferenceDate]);
  quadro.addRow(["Nome", "Chapa", "Descrição da Situação", "Nome do Departamento", "Nome Funcão", "Código da Filial", "Descrição Seção", "Data de Admissão"]);
  const rows: [string, string, string, string, string, number, string, Date][] = [
    ["Ana  Fictícia", "0001", "Ativo", options.unknownUnit ? "UNIDADE NOVA" : "CENTRO DE DISTRIBUICAO", "ARMAZENISTA", 9, "ARMAZENAMENTO", new Date("2020-01-01T00:00:00Z")],
    ["Bruno Fictício", "0002", "Férias", "CENTRO DE DISTRIBUICAO II", "APRENDIZ ADM", 23, "APRENDIZADO", new Date("2021-01-01T00:00:00Z")],
    ["Carla Fictícia", "0003", "Ativo", "CD FLV", "APOIO PREVENCAO E PERDAS", 9, "PREVENCAO", new Date("2022-01-01T00:00:00Z")],
    ["Daniel Fictício", "0004", options.unknownSituation ? "Situação não cadastrada" : "Af.Previdência", "CD FLV", "ARMAZENISTA", 9, "ARMAZENAMENTO", new Date("2023-01-01T00:00:00Z")],
    ["Eva Fictícia", "0005", "Ativo", "CENTRO DE DISTRIBUICAO", "MENOR APRENDIZ ADM", 9, "APRENDIZADO", new Date("2024-01-01T00:00:00Z")],
  ];
  if (options.newAdmitted) rows.push(["Fabio Fictício", "0006", "Novo admitido", "CD FLV", "ARMAZENISTA", 9, "ARMAZENAMENTO", new Date("2026-09-13T00:00:00Z")]);
  for (const row of rows) quadro.addRow(row);
  if (options.duplicateKey) quadro.addRow(rows[0]);

  const path = join(directory, "fixture.xlsx");
  await workbook.xlsx.writeFile(path);
  return path;
}

async function goldenFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "hr-golden-fixture-"));
  directories.push(directory);
  const workbook = new ExcelJS.Workbook();
  const quadro = workbook.addWorksheet("Quadro Atual");
  quadro.getRow(8).values = ["MATRÍCULA", "NOME", "UNIDADE", "SETOR", "FUNÇÃO", "GESTOR", "GESTOR ATUAL", "SITUAÇÃO"];
  quadro.getRow(9).values = ["0001", "Ana Fictícia", "CD I", "SETOR", "ARMAZENISTA", "Gestora Exemplo", "", "ATIVO"];
  quadro.getRow(10).values = ["0003", "Carla Fictícia", "CD FLV", "SETOR", "APOIO PREVENCAO E PERDAS", "Gestora Exemplo", "", "ATIVO"];
  const bank = workbook.addWorksheet("Banco de Horas");
  bank.getCell("A1").value = "BANCO DE HORAS · MENSURAÇÃO ATUAL: 13/09/2026";
  bank.getCell("O3").value = "MENSURAÇÃO ATUAL — 13/09/2026";
  bank.getRow(4).values = ["MATRÍCULA", "NOME", "SETOR", "FUNÇÃO", "UNIDADE", "GESTOR", "SITUAÇÃO", "CATEGORIA", "ADMISSÃO", "TEMPO DE EMPRESA", "JORNADA (H/DIA)"];
  bank.getRow(6).getCell(1).value = "0001";
  bank.getRow(6).getCell(5).value = "CD I";
  bank.getRow(6).getCell(11).value = 7.3333;
  bank.getRow(6).getCell(15).value = 12;
  bank.getRow(6).getCell(16).value = "12:00";
  bank.getRow(7).getCell(1).value = "0003";
  bank.getRow(7).getCell(5).value = "CD FLV";
  bank.getRow(7).getCell(11).value = 12;
  bank.getRow(7).getCell(15).value = -6;
  bank.getRow(7).getCell(16).value = "-06:00";
  const path = join(directory, "golden-fixture.xlsx");
  await workbook.xlsx.writeFile(path);
  return path;
}

describe("importador da base bruta fictícia", () => {
  it("exige data e ref explícitos para --apply", () => {
    expect(() => parseArgs(["--apply", "--source", "data/private/fixture.xlsx"])).toThrow("--reference-date");
    expect(() => parseArgs(["--apply", "--source", "data/private/fixture.xlsx", "--reference-date", "2026-09-28"])).toThrow("--project-ref");
    expect(() => parseArgs(["--apply", "--source", "data/private/fixture.xlsx", "--reference-date", "2026-09-28", "--project-ref", "outro"])).toThrow("--project-ref");
    expect(() => parseArgs(["--dry-run", "--apply", "--source", "data/private/fixture.xlsx", "--reference-date", "2026-09-28", "--project-ref", "kqgtnucqxqqgwdyvhvdd"])).toThrow("mutuamente exclusivos");
    expect(parseArgs(["--apply", "--source", "data/private/fixture.xlsx", "--reference-date", "2026-09-28", "--project-ref", "kqgtnucqxqqgwdyvhvdd"]).apply).toBe(true);
  });

  it("lê abas/colunas fora de ordem e separa positivo, zero, negativo e sem extrato", async () => {
    const path = await fixture();
    const result = await runDryImport(path, undefined, undefined, "2026-09-13");
    expect(result.summary.source.records).toEqual({ quadro: 5, bank: 3, vacation: 1, manager: 4 });
    expect(result.summary.population).toMatchObject({ total: 5, measured: 4, outsideMeasurement: 1 });
    expect(result.summary.bank).toMatchObject({ positive: 1, zero: 1, negative: 1, both: 3, onlyQuadro: 2, measuredWithoutExtract: 1 });
    expect(result.summary.issues.BLOCKER).toBe(0);
    expect(result.summary.issues.byCode.HISTORICAL_NEGATIVES_MANUALLY_REMOVED).toBeUndefined();
    expect(result.private.bank.find((row) => row.matricula === "0001")?.saldoMinutos).toBe(720);
    expect(result.private.bank.find((row) => row.matricula === "0002")?.saldoMinutos).toBe(0);
    expect(result.private.bank.find((row) => row.matricula === "0003")?.saldoMinutos).toBe(-360);
    expect(result.private.bank.find((row) => row.matricula === "0003")?.dias).toBe(-1);
    expect(result.private.employees.find((row) => row.matricula === "0001")?.nome).toBe("Ana Fictícia");
    expect(result.private.employees.find((row) => row.matricula === "0005")?.jornadaMinutos).toBe(240);
    expect(result.summary.remoteWrites).toBe(0);
  });

  it("é determinístico e não coloca PII no relatório versionável", async () => {
    const path = await fixture();
    const a = await runDryImport(path, undefined, undefined, "2026-09-13");
    const b = await runDryImport(path, undefined, undefined, "2026-09-13");
    expect(a.summary).toEqual(b.summary);
    const publicReport = summaryMarkdown(a.summary);
    expect(publicReport).not.toContain("Ana Fictícia");
    expect(publicReport).not.toContain("0001");
    expect(publicReport).not.toContain(a.summary.planFingerprint);
    const ignore = await readFile(join(process.cwd(), ".gitignore"), "utf8");
    expect(ignore).toContain("/data/private/*");
  });

  it("bloqueia duplicidade e unidade desconhecida, mas não gestor ausente", async () => {
    const path = await fixture({ missingOperationalManager: true, duplicateKey: true, unknownUnit: true });
    const result = await runDryImport(path, undefined, undefined, "2026-09-13");
    expect(result.summary.issues.byCode.DUPLICATE_EMPLOYEE_KEY).toBe(1);
    expect(result.summary.issues.byCode.UNKNOWN_UNIT).toBe(1);
    expect(result.summary.issues.byCode.MISSING_MANAGER).toBeGreaterThanOrEqual(1);
    expect(result.summary.issues.BLOCKER).toBeGreaterThan(0);
    expect(result.private.issues.filter((item) => item.code === "MISSING_MANAGER").every((item) => item.severity === "WARNING")).toBe(true);
  });

  it("mantém mensurado sem gestor no plano e no grupo Sem gestor definido", async () => {
    const result = await runDryImport(await fixture({ missingOperationalManager: true }), undefined, undefined, "2026-09-13");
    expect(result.summary.issues.BLOCKER).toBe(0);
    expect(result.summary.managers.measuredWithoutManager).toBe(1);
    expect(result.summary.population.measured).toBe(4);
    expect(result.private.employees.find((row) => row.matricula === "0005")).toMatchObject({
      gestor: null, vinculoGestor: "VINCULO_GESTOR_PENDENTE", agrupamentoGestor: "Sem gestor definido",
    });
    expect(result.private.issues).toContainEqual(expect.objectContaining({ code: "MISSING_MANAGER", severity: "WARNING", matricula: "0005" }));
    expect(result.summary.remoteWrites).toBe(0);
  });

  it("bloqueia ausência de data sem usar timestamp do arquivo ou data do golden", async () => {
    const source = await fixture();
    await utimes(source, new Date("2026-09-13T00:00:00Z"), new Date("2026-09-13T00:00:00Z"));
    const result = await runDryImport(source, await goldenFixture());
    expect(result.summary.source).toMatchObject({ snapshotDate: null, dateOrigin: null });
    expect(result.private.issues).toContainEqual(expect.objectContaining({ code: "DATA_REFERENCIA_NAO_INFORMADA", severity: "BLOCKER" }));
  });

  it("aceita data explícita válida e prioriza metadado confiável do Quadro", async () => {
    const source = await fixture({ sourceReferenceDate: "2026-09-12" });
    const result = await runDryImport(source, undefined, undefined, "2026-09-13");
    expect(result.summary.source).toMatchObject({ snapshotDate: "2026-09-12", dateOrigin: "SOURCE" });
    expect(result.summary.issues.BLOCKER).toBe(0);
    expect(result.private.issues).toContainEqual(expect.objectContaining({ code: "EXPLICIT_REFERENCE_DATE_OVERRIDDEN", severity: "WARNING" }));
    const explicit = await runDryImport(await fixture(), undefined, undefined, "2026-09-13");
    expect(explicit.summary.source).toMatchObject({ snapshotDate: "2026-09-13", dateOrigin: "EXPLICIT" });
    expect(explicit.summary.issues.BLOCKER).toBe(0);
  });

  it("rejeita datas impossíveis e mantém sem extrato distinto de saldo zero", async () => {
    expect(() => parseArgs(["--source", "data/private/fixture.xlsx", "--reference-date", "2026-02-30"])).toThrow();
    expect(parseArgs(["--source", "data/private/fixture.xlsx", "--reference-date", "2026-09-13"]).referenceDate).toBe("2026-09-13");
    const result = await runDryImport(await fixture(), undefined, undefined, "2026-09-13");
    expect(result.private.bank.find((row) => row.matricula === "0002")?.saldoMinutos).toBe(0);
    expect(result.private.bank.find((row) => row.matricula === "0005")).toBeUndefined();
    expect(result.private.issues).toContainEqual(expect.objectContaining({ code: "NO_BANK_EXTRACT", severity: "WARNING", matricula: "0005" }));
  });

  it("não chama a primeira carga inteira de novos admitidos", async () => {
    const path = await fixture();
    const result = await runDryImport(path, undefined, undefined, "2026-09-13");
    expect(result.summary.history).toEqual({ mode: "BASELINE", movements: {} });
  });

  it("inclui novo admitido explícito sem snapshot anterior, gestor ou extrato", async () => {
    const result = await runDryImport(await fixture({ newAdmitted: true }), undefined, undefined, "2026-09-13");
    expect(result.summary.population).toMatchObject({ total: 6, measured: 5, outsideMeasurement: 1 });
    expect(result.summary.history).toEqual({ mode: "BASELINE", movements: {} });
    expect(result.summary.managers.measuredWithoutManager).toBe(1);
    expect(result.summary.bank.measuredWithoutExtract).toBe(2);
    expect(result.private.employees.find((row) => row.matricula === "0006")).toMatchObject({
      situacao: "NOVO_ADMITIDO", gestor: null, agrupamentoGestor: "Sem gestor definido",
    });
    expect(result.summary.issues.BLOCKER).toBe(0);
  });

  it("não exclui silenciosamente situação desconhecida da fonte", async () => {
    const result = await runDryImport(await fixture({ unknownSituation: true }), undefined, undefined, "2026-09-13");
    expect(result.summary.issues.byCode.UNKNOWN_SITUATION).toBe(1);
    expect(result.private.issues).toContainEqual(expect.objectContaining({ code: "UNKNOWN_SITUATION", severity: "BLOCKER" }));
    expect(result.summary.population.total).toBe(4);
    expect(result.summary.remoteWrites).toBe(0);
  });

  it("usa o golden master apenas como comparador opcional e confere decimal × HH:MM", async () => {
    const source = await fixture();
    const reference = await goldenFixture();
    const result = await runDryImport(source, reference, undefined, "2026-09-13");
    expect(result.summary.golden).toMatchObject({
      snapshotDate: "2026-09-13", quadroRows: 2, bankRows: 2, overlap: 2,
      currentPositive: 1, currentNegative: 1, hhmmCompared: 2, hhmmDisagreements: 0,
      temporalComparisonAllowed: false,
    });
  });
});

describe("comparação entre snapshots fictícios", () => {
  const employee = (matricula: string, patch: Partial<Employee> = {}): Employee => ({
    matricula, nome: `Pessoa ${matricula}`, unidade: "CD I", setor: "SETOR", funcao: "ARMAZENISTA",
    situacao: "ATIVO", situacaoOriginal: "Ativo", admissao: "2020-01-01", jornadaMinutos: 440,
    gestor: "Gestora Exemplo", gerente: "Gerente Exemplo", vinculoGestor: "RESOLVIDO", agrupamentoGestor: "Gestora Exemplo", ...patch,
  });

  it("detecta admissão, ausência e mudanças sem excluir ninguém", () => {
    const before = [employee("A"), employee("B")];
    const now = [employee("A", { gestor: "Gestora Outra", unidade: "CD II", setor: "NOVO SETOR", funcao: "CONFERENTE", situacao: "FERIAS" }), employee("C")];
    expect(compareSnapshots(now, { employees: before }).map((row) => row.kind)).toEqual([
      "FUNCAO", "GESTOR", "SETOR", "SITUACAO", "UNIDADE", "NAO_ENCONTRADO", "ADMITIDO",
    ]);
    expect(compareSnapshots(now)).toEqual([]);
  });
});
