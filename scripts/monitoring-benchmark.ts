import ExcelJS from "exceljs";
import { performance } from "node:perf_hooks";
import { parseAfd, parseWorkbook } from "../lib/monitoring/ingestion/parsers.ts";
import type { IngestionSource } from "../lib/monitoring/ingestion/types.ts";

// Synthetic values only. The benchmark creates no fixture file and contacts no server.
const source: IngestionSource = { id: "synthetic-benchmark", kind: "defense-access", root: ".", timeZone: "America/Sao_Paulo" };
const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("SyntheticAccess");
sheet.addRow(["Tipo de evento", "Eventos", "Hora", "Ponto de Acesso", "ID"]);
const accessRows = 40_000;
for (let index = 0; index < accessRows; index++) {
  const timestamp = new Date(Date.UTC(2026, 9, 17, 0, 0, index)).toISOString().slice(0, 19).replace("T", " ");
  sheet.addRow(["Acesso", "Desbloqueio por rosto", timestamp, "Entrada sintética", `S${String(index % 500).padStart(5, "0")}`]);
}
const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
const started = performance.now();
const access = await parseWorkbook(bytes, source);
const accessDurationMs = Math.round(performance.now() - started);
const punchRows = 12_000;
const afdBytes = Buffer.from(Array.from({ length: punchRows }, (_, index) => `${String(index + 1).padStart(9, "0")}32026-10-17T08:00:00-0300012345678909ABCD`).join("\r\n"));
const afdStarted = performance.now();
const afd = parseAfd(afdBytes, { ...source, kind: "afd" });
const afdDurationMs = Math.round(performance.now() - afdStarted);
if (access.occurrences.length !== accessRows || access.occurrences.some(row => !row.event) || afd.occurrences.length !== punchRows || afd.occurrences.some(row => !row.event)) throw new Error("Synthetic benchmark count mismatch");
console.log(JSON.stringify({ synthetic: true, access: { rows: accessRows, bytes: bytes.length, parsingMs: accessDurationMs }, afd: { rows: punchRows, bytes: afdBytes.length, parsingMs: afdDurationMs }, memoryRssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024) }, null, 2));
