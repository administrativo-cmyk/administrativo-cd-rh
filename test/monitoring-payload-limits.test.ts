import { afterEach, describe, expect, it, vi } from "vitest";
import { batchesFor } from "../lib/monitoring/ingestion/batches";
import { batchesFor as compatibilityBatchesFor } from "../lib/monitoring/ingestion/worker";
import { createHttpTransport } from "../lib/monitoring/ingestion/transport";
import { httpBodyLimitBytes } from "../lib/monitoring/payload-limits";
import type { ImportOccurrence, IngestionSource, ParsedImport } from "../lib/monitoring/ingestion/types";
const source: IngestionSource = { id: "synthetic", kind: "defense-person", root: ".", timeZone: "America/Sao_Paulo" };
const occurrence = (line: number, text = "Synthetic"): ImportOccurrence => ({ key: `synthetic-${line}`, line, payloadHash: String(line).padStart(64, "0"), original: { value: text }, issues: [] });
const parsed = (occurrences: ImportOccurrence[]): ParsedImport => ({ sourceId: source.id, parserVersion: "synthetic-v1", sha256: "a".repeat(64), byteLength: 80, totalRows: occurrences.length, occurrences, issues: [], observedRange: null, metadata: {} });
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
afterEach(() => vi.unstubAllGlobals());
describe("payloads menores que o teto da Vercel", () => {
  it("preserva lotes pequenos, ordem, identidade e serialização determinística", () => {
    expect(compatibilityBatchesFor).toBe(batchesFor);
    const input = parsed(Array.from({ length: 501 }, (_, index) => occurrence(index + 1)));
    const batches = batchesFor(input, source, "synthetic.xlsx");
    expect(batches.map(batch => batch.occurrences.length)).toEqual([500, 1]);
    expect(batches.map(batch => batch.batch)).toEqual([{ index: 0, final: false, totalRows: 501, occurrenceCount: 501, totalBatches: 2 }, { index: 1, final: true, totalRows: 501, occurrenceCount: 501, totalBatches: 2 }]);
    expect(batches.flatMap(batch => batch.occurrences)).toEqual(input.occurrences);
    expect(batchesFor(input, source, "synthetic.xlsx")).toEqual(batches);
    expect(batchesFor(parsed([]), source, "empty.xlsx")[0]).toMatchObject({ batch: { index: 0, final: true, totalBatches: 1 }, occurrences: [] });
  });
  it("mede UTF-8 e escapes JSON, divide sem cortar ou duplicar ocorrências", () => {
    const input = parsed(Array.from({ length: 120 }, (_, index) => occurrence(index + 1, 'á\\"\n'.repeat(9000))));
    const batches = batchesFor(input, source, "synthetic.xlsx");
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every(batch => bytes(batch) <= httpBodyLimitBytes)).toBe(true);
    expect(batches.every(batch => bytes(batch) < 4_500_000)).toBe(true);
    expect(batches.flatMap(batch => batch.occurrences)).toEqual(input.occurrences);
    expect(new Set(batches.flatMap(batch => batch.occurrences.map(row => row.key))).size).toBe(120);
    expect(batches.at(-1)?.batch.final).toBe(true);
    expect(batches.slice(0, -1).every(batch => !batch.batch.final)).toBe(true);
    expect(batchesFor(input, source, "synthetic.xlsx")).toEqual(batches);
  });
  it("recusa registro ou metadados indivisíveis antes de qualquer envio", () => {
    expect(() => batchesFor(parsed([occurrence(1, "x".repeat(httpBodyLimitBytes))]), source, "synthetic.xlsx")).toThrow("INGEST_OCCURRENCE_TOO_LARGE");
    const input = parsed([]); input.metadata.description = "x".repeat(httpBodyLimitBytes);
    expect(() => batchesFor(input, source, "synthetic.xlsx")).toThrow("INGEST_METADATA_TOO_LARGE");
  });
  it("transporta exatamente o limite serializado e bloqueia um byte adicional", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ accepted: true })); vi.stubGlobal("fetch", fetch);
    const transport = createHttpTransport("https://synthetic.invalid/api/monitoring/ingest", "synthetic-worker-token-01234567890123456789");
    const batch = batchesFor(parsed([occurrence(1, "")]), source, "synthetic.xlsx")[0];
    batch.occurrences[0].original.value = "x".repeat(httpBodyLimitBytes - bytes(batch));
    expect(bytes(batch)).toBe(httpBodyLimitBytes);
    await expect(transport.persist(batch)).resolves.toMatchObject({ accepted: true });
    expect(Buffer.byteLength(fetch.mock.calls[0][1].body, "utf8")).toBe(httpBodyLimitBytes);
    batch.occurrences[0].original.value += "x";
    await expect(transport.persist(batch)).rejects.toMatchObject({ code: "INGEST_PAYLOAD_TOO_LARGE" });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
