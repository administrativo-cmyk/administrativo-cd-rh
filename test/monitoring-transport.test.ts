import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHttpTransport } from "../lib/monitoring/ingestion/transport.ts";
import { scanSources } from "../lib/monitoring/ingestion/worker.ts";

const token = "synthetic-worker-token-not-a-secret-0123456789";
const reference = "10000000-0000-4000-8000-000000000001";
const transport = () => createHttpTransport("http://127.0.0.1:3000/api/monitoring/ingest", token);
const failure = { sourceId: "synthetic", relativePath: "synthetic.txt", code: "SYNTHETIC_FAILURE" };
afterEach(() => vi.unstubAllGlobals());

describe("diagnóstico HTTP sem conteúdo pessoal", () => {
  it.each(["42703", "PGRST202", "SOURCE_CONTRACT_CONFLICT"])("preserva código %s e referência UUID", async (code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code, correlationId: reference, error: "SENSITIVE_SYNTHETIC_NAME", payload: { token } }, { status: 503 })));
    const error = await transport().failure!(failure).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: `INGEST_HTTP_503_${code}`, httpStatus: 503, apiCode: code, correlationId: reference });
    expect(JSON.stringify(error)).not.toContain("SENSITIVE_SYNTHETIC_NAME");
    expect(JSON.stringify(error)).not.toContain(token);
    expect((error as Error).message).toBe(`INGEST_HTTP_503_${code}`);
  });
  it.each([
    { code: "employee=private-name", correlationId: "private-name" },
    { code: "P0001\nSECRET", correlationId: "https://private.invalid/token" },
    { code: "A".repeat(65), correlationId: [] },
  ])("descarta campos fora do formato permitido", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body, { status: 503 })));
    await expect(transport().failure!(failure)).rejects.toMatchObject({ code: "INGEST_HTTP_503", httpStatus: 503, apiCode: undefined, correlationId: undefined });
  });
  it.each(["<html>private backend error</html>", JSON.stringify({ code: "P0001", error: "x".repeat(9000) })])("mantém fallback para erro inválido ou grande", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 502 })));
    await expect(transport().failure!(failure)).rejects.toMatchObject({ code: "INGEST_HTTP_502", httpStatus: 502, apiCode: undefined });
  });
  it("leva códigos e referências da carga e do reporte ao resumo CLI", async () => {
    const directory = await mkdtemp(join(tmpdir(), "monitoring-http-test-"));
    try {
      await writeFile(join(directory, "synthetic.txt"), "00000000132026-10-17T08:00:00-0300012345678909ABCD\n");
      vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (_url.endsWith("/sources")) return Response.json({ sources: [{ id: "synthetic", kind: "afd", timeZone: "America/Sao_Paulo", identityNamespace: "synthetic", active: true, configurationUpdatedAt: "2026-10-17T00:00:00Z", sourceIdentityConfirmed: false, declaredCoverage: null }] });
        if (body.heartbeat) return Response.json({ ok: true });
        if (body.sourceIds) return Response.json({ processed: 0, pending: 0, failed: 0 });
        return Response.json({ code: body.failure ? "42501" : "42703", correlationId: reference, error: "SENSITIVE_SYNTHETIC_NAME", token }, { status: 503 });
      }));
      const [summary] = await scanSources({ version: 1, stateDirectory: join(directory, "state"), stabilityMs: 100, sources: [{ id: "synthetic", kind: "afd", root: directory, timeZone: "America/Sao_Paulo", afdProfile: "iso" }] }, { apply: true }, transport());
      expect(summary.issueCounts).toMatchObject({ INGEST_HTTP_503_42703: 1, INGEST_HTTP_503_42501: 1, FAILURE_REPORT_NOT_DELIVERED: 1 });
      expect(summary.apiErrors).toEqual([
        { code: "INGEST_HTTP_503_42703", httpStatus: 503, apiCode: "42703", correlationId: reference },
        { code: "INGEST_HTTP_503_42501", httpStatus: 503, apiCode: "42501", correlationId: reference },
      ]);
      expect(JSON.stringify(summary)).not.toContain("SENSITIVE_SYNTHETIC_NAME");
      expect(JSON.stringify(summary)).not.toContain(token);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
