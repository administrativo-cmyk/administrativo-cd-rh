import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import ExcelJS from "exceljs";
import { normalizeIdentifier, parseLocalTimestamp, parseOffsetTimestamp, sha256 } from "../lib/monitoring/ingestion/validation.ts";
import { cellText, classifyAccess, eventPayloadHash, parseAfd, parseWorkbook, validateWorkbookArchive } from "../lib/monitoring/ingestion/parsers.ts";
import { assertWithin, buildPhotoIndex, loadPhoto, readStableSnapshot, safePhotoReference } from "../lib/monitoring/ingestion/files.ts";
import { batchesFor, scanSources, validateConfig } from "../lib/monitoring/ingestion/worker.ts";
import { createHttpTransport } from "../lib/monitoring/ingestion/transport.ts";
import { parseMonitoringArgs } from "../scripts/monitoring-import.ts";
import type { IngestBatch, IngestionSource, IngestionTransport, WorkerConfig } from "../lib/monitoring/ingestion/types.ts";

const CPF = "12345678909";
const pisBase = "1234567890";
const pisDigit = 11 - [...pisBase].reduce((sum, digit, index) => sum + Number(digit) * [3, 2, 9, 8, 7, 6, 5, 4, 3, 2][index], 0) % 11;
const PIS = `${pisBase}${pisDigit > 9 ? 0 : pisDigit}`;
const source = (kind: IngestionSource["kind"], extra: Partial<IngestionSource> = {}): IngestionSource => ({ id: "synthetic-source", kind, root: ".", timeZone: "America/Sao_Paulo", ...extra });
const iso = (nsr = 1, time = "2026-10-17T08:00:00-0300", id = CPF) => `${String(nsr).padStart(9, "0")}3${time}0${id}ABCD`;
const legacy = (nsr = 1) => `${String(nsr).padStart(9, "0")}31710202608000${PIS}ABCD`;
const tempDirectories: string[] = [];
it("parses CPF in a legacy AFD using independent identity semantics and an immutable parser version", () => {
  const bytes = Buffer.from(legacy().replace(`0${PIS}`, `0${CPF}`));
  const parsed = parseAfd(bytes, source("afd", { afdProfile: "legacy", afdIdentityType: "cpf" }));
  expect(parsed.parserVersion).toBe("monitoring-import/1.0.0/afd-legacy-cpf");
  expect(parsed.occurrences[0].event?.identity).toEqual({ type: "cpf", value: CPF });
  expect(parsed.occurrences[0].event?.precisionSeconds).toBe(60);
});
async function temporary(): Promise<string> { const path = await mkdtemp(join(tmpdir(), "monitoring-test-")); tempDirectories.push(path); return path; }
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(tempDirectories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function accessWorkbook(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Access");
  sheet.addRow(["Tipo de evento", "Eventos", "Hora", "Ambiente", "Ponto de Acesso", "Tipo de ponto de acesso", "Pessoa", "ID", "Grupo de pessoas", "Status de Entrada/Saída"]);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
const accessRow = (id = "001", time = "2026-10-17 08:00:00", name = "Pessoa sintética", group = "GRUPO A", device = "Entrada Torniquete") => ["Acesso", "Desbloqueio por rosto", time, "CD", device, "Porta", name, id, group, "Entrada"];

describe("identificadores e instantes estritos", () => {
  it("remove somente o zero de preenchimento de 12 posições e preserva ID Defense", () => {
    expect(normalizeIdentifier(`0${CPF}`, "cpf", true)).toBe(CPF);
    expect(normalizeIdentifier(`0${PIS}`, "pis", true)).toBe(PIS);
    expect(normalizeIdentifier("0000009", "defense")).toBe("0000009");
    expect(() => normalizeIdentifier(`1${CPF}`, "cpf", true)).toThrow("INVALID_CPF_LENGTH");
    expect(() => normalizeIdentifier(`00${CPF}`, "cpf", true)).toThrow("INVALID_CPF_LENGTH");
    expect(() => normalizeIdentifier(`0${CPF}`, "cpf")).toThrow("INVALID_CPF_LENGTH");
  });
  it("valida CPF e PIS com regras separadas, sem tolerar truncamento ou pontuação", () => {
    expect(() => normalizeIdentifier("123.456.789-09", "cpf")).toThrow();
    expect(() => normalizeIdentifier("00000000000", "pis")).toThrow();
    expect(() => normalizeIdentifier(PIS.slice(0, 10) + ((Number(PIS[10]) + 1) % 10), "pis")).toThrow();
  });
  it("respeita offset explícito e fuso da fonte legado", () => {
    expect(parseLocalTimestamp("2026-10-17 08:00:01", "America/Sao_Paulo")).toBe("2026-10-17T11:00:01.000Z");
    expect(parseOffsetTimestamp("2026-10-17T08:00:00+0230")).toBe("2026-10-17T05:30:00.000Z");
    expect(() => parseOffsetTimestamp("2026-10-17T08:00:00+1460")).toThrow();
    expect(() => parseLocalTimestamp("2026-02-31 08:00:00", "UTC")).toThrow();
  });
  it("recusa horários locais inexistentes e ambíguos no horário de verão", () => {
    expect(() => parseLocalTimestamp("2026-03-08 02:30:00", "America/New_York")).toThrow("NONEXISTENT_LOCAL_TIMESTAMP");
    expect(() => parseLocalTimestamp("2026-11-01 01:30:00", "America/New_York")).toThrow("AMBIGUOUS_LOCAL_TIMESTAMP");
  });
});

describe("AFD imutável e proveniência", () => {
  it("lê legado e ISO sem quebra final, preservando hash e linhas", () => {
    for (const [bytes, kind] of [[Buffer.from(legacy()), "pis"], [Buffer.from(iso()), "cpf"]] as const) {
      const parsed = parseAfd(bytes, source("afd"));
      expect(parsed.sha256).toBe(sha256(bytes)); expect(parsed.occurrences).toHaveLength(1);
      expect(parsed.occurrences[0].event?.identity?.type).toBe(kind);
      expect(parsed.occurrences[0].event?.timestamp).toBe("2026-10-17T11:00:00.000Z");
      expect(parsed.issues.map(issue => issue.code)).toContain("AFD_HEADER_ABSENT_LAYOUT_UNCONFIRMED");
      expect(parsed.occurrences[0].event?.checksumStatus).toBe("not_verified");
    }
  });
  it("nome, bytes reordenados e CRLF não mudam identidade fonte/NSR", () => {
    const first = parseAfd(Buffer.from(`${iso(1)}\r\n${iso(2)}`), source("afd"));
    const second = parseAfd(Buffer.from(`${iso(2)}\n${iso(1)}\n`), source("afd"));
    expect(first.sha256).not.toBe(second.sha256);
    expect(first.occurrences.map(row => row.event?.key).sort()).toEqual(second.occurrences.map(row => row.event?.key).sort());
    expect(first.occurrences[0].key).not.toBe(second.occurrences[1].key);
  });
  it("NSR em equipamentos diferentes não colide; payload conflitante não sobrescreve", () => {
    const first = parseAfd(Buffer.from(iso()), source("afd")).occurrences[0].event!;
    const conflict = parseAfd(Buffer.from(iso(1, "2026-10-17T08:01:00-0300")), source("afd")).occurrences[0].event!;
    const other = parseAfd(Buffer.from(iso()), source("afd", { id: "other-clock" })).occurrences[0].event!;
    expect(first.key).toBe(conflict.key); expect(eventPayloadHash(first)).not.toBe(eventPayloadHash(conflict)); expect(first.key).not.toBe(other.key);
  });
  it("tipos 5 e 6 são preservados sem usar CPF do responsável como pessoa", () => {
    const parsed = parseAfd(Buffer.from(`${iso()}\n0000000025${"0".repeat(130)}\n0000000036${"0".repeat(30)}`), source("afd"));
    expect(parsed.totalRows).toBe(3); expect(parsed.occurrences.filter(row => row.event)).toHaveLength(1);
    expect(parsed.occurrences[1].original.record).toContain("0000000025");
  });
  it("arquivos de outro perfil são ignorados; registros malformados são rejeitados", () => {
    expect(parseAfd(Buffer.from(legacy()), source("afd", { afdProfile: "iso" })).skipped).toBe(true);
    const parsed = parseAfd(Buffer.from(`${iso()}\n${iso(2).slice(0, -1)}\n${iso(3)}`), source("afd"));
    expect(parsed.occurrences[1].issues[0].severity).toBe("error");
    expect(() => parseAfd(Buffer.from(`${iso()}\n${iso(2).slice(0, -1)}`), source("afd"))).toThrow("AFD_INCOMPLETE_LAST_RECORD");
    expect(() => parseAfd(Buffer.from([0xff, 0xff]), source("afd"))).toThrow("INVALID_FILE_ENCODING");
  });
});

describe("Defense XLSX", () => {
  it("preserva primeira pessoa, zero inicial, hyperlink local e grupos múltiplos", async () => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Cadastro");
    sheet.getRow(3).values = [{ richText: [{ text: "Nome" }, { text: "*" }] }, "ID", "Grupo de pessoas", "Imagem de rosto 1"];
    sheet.getRow(4).values = ["Pessoa sintética", "0001", "Operação, All/CD/COZINHA JK, All/CD/LIDERANÇA JK", { text: "0001-1.jpg", hyperlink: "0001-1.jpg" }];
    const hidden = workbook.addWorksheet("CountryNameSheet", { state: "hidden" }); hidden.addRow(["País"]);
    const parsed = await parseWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), source("defense-person"));
    expect(parsed.totalRows).toBe(1); expect(parsed.occurrences[0].line).toBe(4);
    expect(parsed.occurrences[0].person).toMatchObject({ externalId: "0001", photoReference: "0001-1.jpg", groups: ["COZINHA JK", "LIDERANCA JK", "OPERACAO"] });
    expect(parsed.occurrences[0].person?.groupPaths).toContain("ALL/CD/COZINHA JK");
  });
  it("lê linhas reais apesar de dimensão falsa e ignora validações de 1.048.576 linhas", async () => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Cadastro");
    sheet.getRow(3).values = ["Nome", "ID", "Grupo de pessoas", "Imagem de rosto 1"];
    sheet.getRow(4).values = ["Pessoa sintética 1", "001", "Grupo", ""];
    sheet.getRow(5).values = ["Pessoa sintética 2", "002", "Grupo", ""];
    const require = createRequire(import.meta.url);
    type Zip = { file(path: string): { async(type: "string"): Promise<string> }; file(path: string, contents: string): void; generateAsync(options: { type: "nodebuffer" }): Promise<Buffer> };
    const JSZip = require(require.resolve("jszip", { paths: [dirname(require.resolve("exceljs"))] })) as { loadAsync(bytes: Buffer): Promise<Zip> };
    const zip = await JSZip.loadAsync(Buffer.from(await workbook.xlsx.writeBuffer()));
    const xml = (await zip.file("xl/worksheets/sheet1.xml").async("string")).replace(/<dimension ref="[^"]+"\/>/, '<dimension ref="A1:D4"/>').replace("</worksheet>", '<dataValidations count="1"><dataValidation type="list" sqref="E4:E1048576"><formula1>"A,B"</formula1></dataValidation></dataValidations></worksheet>');
    zip.file("xl/worksheets/sheet1.xml", xml);
    const parsed = await parseWorkbook(await zip.generateAsync({ type: "nodebuffer" }), source("defense-person"));
    expect(parsed.occurrences).toHaveLength(2); expect(parsed.occurrences[1].line).toBe(5);
  });
  it("equivalência permanece estável com nome/grupo mutável e reordenação", async () => {
    const bytes = await accessWorkbook([accessRow(), accessRow("002")]);
    const first = await parseWorkbook(bytes, source("defense-access"));
    const second = await parseWorkbook(await accessWorkbook([accessRow("002"), accessRow("001", "2026-10-17 08:00:00", "Novo nome", "Novo grupo")]), source("defense-access"));
    expect(first.occurrences.map(row => row.event?.key).sort()).toEqual(second.occurrences.map(row => row.event?.key).sort());
    expect(eventPayloadHash(first.occurrences[0].event!)).toBe(eventPayloadHash(second.occurrences[1].event!));
    expect(first.occurrences[0].payloadHash).not.toBe(second.occurrences[1].payloadHash);
  });
  it("preserva ocorrências indistinguíveis e aplica uma equivalência canônica explícita", async () => {
    const parsed = await parseWorkbook(await accessWorkbook([accessRow(), accessRow(), accessRow()]), source("defense-access"));
    expect(new Set(parsed.occurrences.map(row => row.event?.key)).size).toBe(1);
    expect(parsed.occurrences.map(row => row.multiplicityOrdinal)).toEqual([1, 2, 3]);
    expect(new Set(parsed.occurrences.map(row => row.key)).size).toBe(3);
    expect(parsed.metadata.indistinguishableAdditionalOccurrences).toBe(2);
  });
  it("direção não é inferida pelo campo Entrada/Saída nem por nome de pessoa", async () => {
    const parsed = await parseWorkbook(await accessWorkbook([accessRow("001", "2026-10-17 08:00:00", "Homônimo", "Grupo", "Saida Torniquete"), accessRow("002", "2026-10-17 08:00:00", "Homônimo")]), source("defense-access"));
    expect(parsed.occurrences[0].event?.device).toBe("Saida Torniquete");
    expect(parsed.occurrences[0].event?.original.entryExitStatus).toBe("Entrada");
    expect(parsed.occurrences[0].event?.identity).not.toEqual(parsed.occurrences[1].event?.identity);
    expect(parsed.occurrences[0].event).not.toHaveProperty("direction");
  });
  it.each([
    ["Desbloqueio por rosto", "001", "authorized"], ["Erro de período", "001", "denied"], ["Estranho (rosto)", null, "denied"], ["Alarme anti-passback", "001", "alarm"], ["Desbloqueio por botão", null, "anonymous"], ["Abertura remota", "001", "anonymous"], ["Desbloqueio por rosto", null, "anonymous"], ["Evento novo", "001", "unknown"],
  ] as const)("classifica %s sem deslocar alguém indevidamente", (event, id, expected) => { expect(classifyAccess(event, "", id)).toBe(expected); });
  it("não executa fórmulas e recusa ZIP incompleto ou expansão excessiva", async () => {
    expect(() => cellText({ formula: 'WEBSERVICE("https://example.invalid")', result: "123" })).toThrow("FORMULA_CELL_NOT_ACCEPTED");
    const bytes = await accessWorkbook([accessRow()]);
    expect(() => validateWorkbookArchive(bytes.subarray(0, bytes.length - 5))).toThrow("XLSX_INCOMPLETE_ARCHIVE");
    expect(() => validateWorkbookArchive(bytes, 10)).toThrow("XLSX_EXPANSION_LIMIT");
  });
});

describe("arquivos, fotos e fronteira de diretório", () => {
  it("não aceita travessia, URLs ou caminhos absolutos em fotos", () => {
    for (const path of ["../x.jpg", "%2e%2e/x.jpg", "https://example.invalid/x.jpg", "C:\\x.jpg", "/x.jpg", "file:///x.jpg"]) expect(() => safePhotoReference(path)).toThrow();
    expect(safePhotoReference("subpasta/0001-1.jpg")).toBe("subpasta/0001-1.jpg");
    expect(() => assertWithin("/authorized/data", "/authorized/data-other/x.jpg")).toThrow();
  });
  it("detecta referência ambígua e bytes que não são imagem", async () => {
    const root = await temporary(); await mkdir(join(root, "a")); await mkdir(join(root, "b"));
    await writeFile(join(root, "a", "same.jpg"), "not an image"); await writeFile(join(root, "b", "same.jpg"), "not an image");
    const index = await buildPhotoIndex(root);
    await expect(loadPhoto(root, "same.jpg", index)).rejects.toThrow("PHOTO_REFERENCE_AMBIGUOUS");
    await expect(loadPhoto(root, "a/same.jpg", index)).rejects.toThrow("PHOTO_IMAGE_INVALID");
  });
  it("lê bytes imutáveis e não aceita arquivo ainda mudando", async () => {
    const root = await temporary(); const path = join(root, "afd.txt"); await writeFile(path, iso());
    const bytes = await readStableSnapshot(root, path, { stabilityMs: 0 }); expect(bytes.toString()).toBe(iso());
    // Keep the file changing across the observation window, including when the
    // first filesystem read is delayed by other test workers.
    let updating = true; let version = 1_700_000_000;
    const updater = (async () => { while (updating) { version++; await utimes(path, version, version); } })();
    try { await expect(readStableSnapshot(root, path, { stabilityMs: 80 })).rejects.toThrow("FILE_NOT_STABLE"); }
    finally { updating = false; await updater; }
    await expect(readStableSnapshot(root, path, { maxBytes: 5 })).rejects.toThrow("FILE_SIZE_LIMIT");
  });
});

describe("worker, retomada e contrato HTTP", () => {
  const config = (root: string): WorkerConfig => ({ version: 1, sources: [source("afd", { root })], stateDirectory: join(root, "state"), stabilityMs: 0, batchSize: 1 });
  it("dry-run não escreve checkpoint e arquivo renomeado/duplicado não duplica carga", async () => {
    const root = await temporary(); await writeFile(join(root, "original.txt"), iso()); await writeFile(join(root, "renamed.txt"), iso());
    const summary = (await scanSources(config(root)))[0];
    expect(summary.uniqueEvents).toBe(1); expect(summary.repeatedFiles).toBe(1); expect(summary.dryRun).toBe(true);
    await expect(readFile(join(root, "state", "state.json"))).rejects.toThrow();
  });
  it("mesmo nome com bytes novos acrescenta apenas novo NSR e sinaliza conflito", async () => {
    const root = await temporary(); await writeFile(join(root, "first.txt"), `${iso()}\n${iso(2)}`); await writeFile(join(root, "overlap.txt"), `${iso(2)}\n${iso(3)}\n${iso(1, "2026-10-17T09:00:00-0300")}`);
    const summary = (await scanSources(config(root)))[0];
    expect(summary.uniqueEvents).toBe(3); expect(summary.repeatedEvents).toBe(1); expect(summary.conflictingEvents).toBe(1);
  });
  it("não confirma arquivo parcialmente persistido; retry converge sem perda", async () => {
    const root = await temporary(); await writeFile(join(root, "file.txt"), `${iso()}\n${iso(2)}`);
    const accepted = new Set<string>(); let fail = true;
    const transport: IngestionTransport = { heartbeat: async () => undefined, persist: async batch => { if (batch.batch.index === 1 && fail) { fail = false; throw new Error("synthetic interruption"); } for (const row of batch.occurrences) accepted.add(row.event!.key); return { accepted: true, fileStatus: batch.batch.final ? "complete" : "processing" }; } };
    expect((await scanSources(config(root), { apply: true }, transport))[0].failedFiles).toBe(1);
    await expect(readFile(join(root, "state", "state.json"))).rejects.toThrow();
    expect((await scanSources(config(root), { apply: true }, transport))[0].failedFiles).toBe(0);
    expect(accepted.size).toBe(2);
    expect((await scanSources(config(root), { apply: true }, transport))[0].repeatedFiles).toBe(1);
    expect((await scanSources(config(root), { apply: true, reprocess: true }, transport))[0].repeatedFiles).toBe(0);
  });
  it("foto que chega depois do Person concluído é enviada e alterações são detectadas por hash", async () => {
    const root = await temporary();
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Person");
    sheet.getRow(3).values = ["Nome", "ID", "Grupo de pessoas", "Imagem de rosto 1"];
    sheet.getRow(4).values = ["Pessoa sintética", "0001", "CD/Grupo", "0001-1.jpg"];
    await writeFile(join(root, "person.xlsx"), Buffer.from(await workbook.xlsx.writeBuffer()));
    const settings: WorkerConfig = { ...config(root), sources: [source("defense-person", { root, photoRoot: root })] };
    const persist = vi.fn().mockResolvedValue({ accepted: true, fileStatus: "complete" }); const photo = vi.fn().mockResolvedValue(undefined); const failure = vi.fn().mockResolvedValue(undefined);
    const transport: IngestionTransport = { heartbeat: async () => undefined, persist, photo, failure };
    const first = (await scanSources(settings, { apply: true }, transport))[0];
    expect(first.photosPending).toBe(1); expect(persist).toHaveBeenCalledTimes(1); expect(photo).not.toHaveBeenCalled();
    const require = createRequire(import.meta.url);
    const sharp = require(require.resolve("sharp", { paths: [dirname(require.resolve("next/package.json"))] })) as (input: unknown) => { jpeg(): { toBuffer(): Promise<Buffer> } };
    const image = async (background: string) => sharp({ create: { width: 4, height: 4, channels: 3, background } }).jpeg().toBuffer();
    await writeFile(join(root, "0001-1.jpg"), await image("#ff0000"));
    const second = (await scanSources(settings, { apply: true }, transport))[0];
    expect(second.repeatedFiles).toBe(1); expect(second.photosValidated).toBe(1); expect(photo).toHaveBeenCalledTimes(1); expect(persist).toHaveBeenCalledTimes(1);
    await scanSources(settings, { apply: true }, transport); expect(photo).toHaveBeenCalledTimes(1);
    await writeFile(join(root, "0001-1.jpg"), await image("#00ff00"));
    await scanSources(settings, { apply: true }, transport); expect(photo).toHaveBeenCalledTimes(2);
    expect(photo.mock.calls[0][0].sha256).not.toBe(photo.mock.calls[1][0].sha256);
    const checkpoint = await readFile(join(root, "state", "state.json"), "utf8");
    expect(checkpoint).not.toContain("0001-1.jpg"); expect(checkpoint).not.toContain("Pessoa sintética");
  });
  it("heartbeat registra fonte vazia e falha de leitura gera histórico sanitizado", async () => {
    const root = await temporary(); await writeFile(join(root, "broken.txt"), "incomplete");
    const heartbeat = vi.fn().mockResolvedValue(undefined); const failure = vi.fn().mockResolvedValue(undefined);
    const transport: IngestionTransport = { heartbeat, failure, persist: async () => ({ accepted: true }) };
    const summary = (await scanSources(config(root), { apply: true }, transport))[0];
    expect(summary.failedFiles).toBe(1);
    expect(heartbeat.mock.calls[0]).toMatchObject(["synthetic-source", "scanning", undefined, { id: "synthetic-source", kind: "afd", timeZone: "America/Sao_Paulo" }]);
    expect(failure).toHaveBeenCalledWith({ sourceId: "synthetic-source", relativePath: "broken.txt", code: "AFD_PROFILE_UNRECOGNIZED" });
  });
  it("drena reprocessamento mesmo sem arquivo novo, com limite finito por varredura", async () => {
    const root = await temporary(); const reprocess = vi.fn().mockResolvedValue({ processed: 10, pending: 10, failed: 0 });
    const transport: IngestionTransport = { heartbeat: async () => undefined, persist: async () => ({ accepted: true }), reprocess };
    const summary = (await scanSources(config(root), { apply: true }, transport))[0];
    expect(reprocess).toHaveBeenCalledTimes(100); expect(summary.reprocessedJobs).toBe(1000); expect(summary.pendingReprocessJobs).toBe(10);
    expect(reprocess).toHaveBeenCalledWith({ sourceIds: ["synthetic-source"], limit: 10 });
  });
  it("lotes têm tamanho controlado e somente último é final", () => {
    const parsed = parseAfd(Buffer.from(`${iso()}\n${iso(2)}\n${iso(3)}`), source("afd"));
    const batches = batchesFor(parsed, source("afd"), "safe.txt", 2);
    expect(batches.map(batch => batch.batch.final)).toEqual([false, true]); expect(batches[1].batch.occurrenceCount).toBe(3); expect(batches[1].batch.totalBatches).toBe(2);
    expect(() => batchesFor(parsed, source("afd"), "safe.txt", 0)).toThrow();
  });
  it("não grava checkpoint quando o servidor aceitou lote mas não confirmou arquivo completo", async () => {
    const root = await temporary(); await writeFile(join(root, "file.txt"), iso());
    const transport: IngestionTransport = { heartbeat: async () => undefined, persist: async () => ({ accepted: true, fileStatus: "processing" }) };
    const summary = (await scanSources(config(root), { apply: true }, transport))[0];
    expect(summary.failedFiles).toBe(1); expect(summary.issueCounts.INGEST_FILE_NOT_CONFIRMED_COMPLETE).toBe(1);
    await expect(readFile(join(root, "state", "state.json"))).rejects.toThrow();
  });
  it("transporte exige TLS ou loopback, nunca segue redirect e valida confirmação", async () => {
    expect(() => createHttpTransport("http://remote.example/api/monitoring/ingest", "x".repeat(40))).toThrow();
    expect(() => createHttpTransport("https://example.invalid/ingest?token=secret", "x".repeat(40))).toThrow();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: true }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    const transport = createHttpTransport("http://127.0.0.1:3000/api/monitoring/ingest", "x".repeat(40));
    await transport.persist({} as IngestBatch);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: { Authorization: `Bearer ${"x".repeat(40)}` } });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ accepted: false }), { status: 200 }));
    await expect(transport.persist({} as IngestBatch)).rejects.toThrow("INGEST_BATCH_NOT_ACKNOWLEDGED");
  });
  it("CLI usa dry-run, valida intervalo e exige limites seguros", () => {
    expect(parseMonitoringArgs([]).apply).toBe(false);
    expect(parseMonitoringArgs(["--watch", "--resume", "--source", "one"]).watch).toBe(true);
    expect(() => parseMonitoringArgs(["--apply", "--dry-run"])).toThrow();
    expect(() => parseMonitoringArgs(["--from", "2026-02-31"])).toThrow();
    expect(() => validateConfig({ version: 1, stateDirectory: ".state", sources: [source("afd")], batchSize: 0 }, ".")).toThrow();
  });
});
