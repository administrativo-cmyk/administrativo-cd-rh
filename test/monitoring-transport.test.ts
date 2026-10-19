import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHttpTransport, type HttpTransportOptions } from "../lib/monitoring/ingestion/transport.ts";
import { batchesFor } from "../lib/monitoring/ingestion/batches.ts";
import { scanSources } from "../lib/monitoring/ingestion/worker.ts";

const token = "synthetic-worker-token-not-a-secret-0123456789";
const reference = "10000000-0000-4000-8000-000000000001";
const transport = (options?: HttpTransportOptions) => createHttpTransport("http://127.0.0.1:3000/api/monitoring/ingest", token, options);
const failure = { sourceId: "synthetic", relativePath: "synthetic.txt", code: "SYNTHETIC_FAILURE" };
const batch = batchesFor({ sourceId: "synthetic", parserVersion: "synthetic-v1", sha256: "a".repeat(64), byteLength: 80, totalRows: 0, occurrences: [], issues: [], observedRange: null, metadata: {} }, { id: "synthetic", kind: "afd", root: ".", timeZone: "America/Sao_Paulo" }, "synthetic.txt")[0];
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

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

describe("cancelamento e orçamento da rodada HTTP", () => {
  it("cancela antes do primeiro fetch sem expor o motivo do caller", async () => {
    const controller = new AbortController(); controller.abort("SENSITIVE_CALLER_REASON");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const error = await transport({ signal: controller.signal, retries: 3 }).persist(batch).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: "INGEST_ABORTED" });
    expect(JSON.stringify(error)).not.toContain("SENSITIVE_CALLER_REASON");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("não inicia requisição com deadline vencido", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(transport({ deadline: Date.now() - 1 }).persist(batch)).rejects.toMatchObject({ code: "INGEST_DEADLINE_EXCEEDED" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("mantém uma tentativa por padrão", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("SENSITIVE_NETWORK_DETAIL")); vi.stubGlobal("fetch", fetch);
    await expect(transport().persist(batch)).rejects.toMatchObject({ code: "INGEST_CONNECTION_FAILED" });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("retry opcional reenvia exatamente o mesmo lote após resposta transitória", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 503 })).mockResolvedValueOnce(Response.json({ accepted: true, fileStatus: "complete" })); vi.stubGlobal("fetch", fetch);
    const pending = transport({ retries: 1, retryDelayMs: 20 }).persist(batch);
    await vi.advanceTimersByTimeAsync(20);
    await expect(pending).resolves.toMatchObject({ accepted: true, fileStatus: "complete" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(call => call[1].body)).toEqual([JSON.stringify(batch), JSON.stringify(batch)]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancela a espera de retry e não envia o próximo lote", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValue(Response.json({}, { status: 503 })); vi.stubGlobal("fetch", fetch);
    const assertion = expect(transport({ signal: controller.signal, retries: 3, retryDelayMs: 1000 }).persist(batch)).rejects.toMatchObject({ code: "INGEST_ABORTED" });
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    await assertion;
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("propaga cancelamento ao fetch da segunda tentativa, sem terceira", async () => {
    vi.useFakeTimers();
    const controller = new AbortController(); let secondSignal: AbortSignal | undefined;
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 503 })).mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      secondSignal = init.signal!;
      secondSignal.addEventListener("abort", () => reject(new Error("SENSITIVE_NETWORK_DETAIL")), { once: true });
    })); vi.stubGlobal("fetch", fetch);
    const assertion = expect(transport({ signal: controller.signal, retries: 3, retryDelayMs: 20 }).persist(batch)).rejects.toMatchObject({ code: "INGEST_ABORTED" });
    await vi.advanceTimersByTimeAsync(20);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(secondSignal?.aborted).toBe(false);
    controller.abort();
    await assertion;
    expect(secondSignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("deadline interrompe fetch pendente antes do timeout de 60 segundos", async () => {
    vi.useFakeTimers(); let requestSignal: AbortSignal | undefined;
    const fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      requestSignal = init.signal!;
      requestSignal.addEventListener("abort", () => reject(new Error("network aborted")), { once: true });
    })); vi.stubGlobal("fetch", fetch);
    const assertion = expect(transport({ deadline: Date.now() + 50, retries: 3 }).persist(batch)).rejects.toMatchObject({ code: "INGEST_DEADLINE_EXCEEDED" });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(requestSignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("deadline também limita backoff e não é renovado entre tentativas", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(Response.json({}, { status: 503 })); vi.stubGlobal("fetch", fetch);
    const assertion = expect(transport({ deadline: Date.now() + 50, retries: 3, retryDelayMs: 1000 }).persist(batch)).rejects.toMatchObject({ code: "INGEST_DEADLINE_EXCEEDED" });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("erros de autorização não são repetidos", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({}, { status: 403 })); vi.stubGlobal("fetch", fetch);
    await expect(transport({ retries: 3 }).persist(batch)).rejects.toMatchObject({ code: "INGEST_HTTP_403" });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
