import { ImportError } from "./validation.ts";
import { httpBodyLimitBytes } from "../payload-limits.ts";
import type { IngestBatch, IngestBatchResponse, IngestionTransport, ManagedWorkerSource } from "./types.ts";

async function responseError(response: Response): Promise<ImportError> {
  let apiCode: string | undefined;
  let correlationId: string | undefined;
  try {
    // Error pages may contain payloads or credentials. Read a small bounded body,
    // retain only a machine code and UUID, and discard every other field.
    const reader = response.body?.getReader();
    if (reader && Number(response.headers.get("content-length")) <= 8192) {
      let length = 0; const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > 8192) { await reader.cancel(); break; }
        chunks.push(value);
      }
      if (length <= 8192) {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (body && typeof body === "object") {
          const value = body as Record<string, unknown>;
          if (typeof value.code === "string" && /^[A-Z0-9][A-Z0-9_]{0,63}$/.test(value.code)) apiCode = value.code;
          if (typeof value.correlationId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.correlationId)) correlationId = value.correlationId;
        }
      }
    } else if (reader) await reader.cancel();
  } catch { /* A malformed error response keeps the safe HTTP status fallback. */ }
  return new ImportError(`INGEST_HTTP_${response.status}${apiCode ? `_${apiCode}` : ""}`, { httpStatus: response.status, apiCode, correlationId });
}

export interface HttpTransportOptions {
  signal?: AbortSignal;
  /** Absolute Unix time in milliseconds; the same deadline covers all attempts. */
  deadline?: number;
  /** Opt-in only. Existing callers continue to send each request once. */
  retries?: number;
  retryDelayMs?: number;
}

export function createHttpTransport(endpoint: string, token: string, options: HttpTransportOptions = {}): IngestionTransport {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new ImportError("INVALID_INGEST_ENDPOINT"); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new ImportError("INGEST_ENDPOINT_REQUIRES_HTTPS_OR_LOOPBACK");
  if (token.length < 32 || /[\r\n]/.test(token)) throw new ImportError("INGEST_TOKEN_MISSING_OR_TOO_SHORT");
  const { signal, deadline } = options;
  const retries = options.retries ?? 0;
  const retryDelayMs = options.retryDelayMs ?? 250;
  if ((deadline !== undefined && (!Number.isSafeInteger(deadline) || deadline < 0)) || !Number.isInteger(retries) || retries < 0 || retries > 3 || !Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 60_000) throw new ImportError("INVALID_TRANSPORT_OPTIONS");
  const checkRound = (): void => {
    if (signal?.aborted) throw new ImportError("INGEST_ABORTED");
    if (deadline !== undefined && Date.now() >= deadline) throw new ImportError("INGEST_DEADLINE_EXCEEDED");
  };
  const waitToRetry = (attempt: number): Promise<void> => {
    checkRound();
    const duration = Math.min(retryDelayMs * 2 ** attempt, 60_000, deadline === undefined ? Infinity : deadline - Date.now());
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", finish); };
      const finish = () => {
        cleanup();
        try { checkRound(); resolve(); } catch (error) { reject(error); }
      };
      const timer = setTimeout(finish, Math.max(0, duration));
      signal?.addEventListener("abort", finish, { once: true });
      if (signal?.aborted) finish();
    });
  };
  const post = async (path: string, body: unknown): Promise<unknown> => {
    checkRound();
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized, "utf8") > httpBodyLimitBytes) throw new ImportError("INGEST_PAYLOAD_TOO_LARGE");
    for (let attempt = 0; ; attempt++) {
      checkRound();
      const controller = new AbortController();
      const abort = () => controller.abort();
      const timeout = setTimeout(abort, Math.min(60_000, deadline === undefined ? Infinity : Math.max(0, deadline - Date.now())));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      let failure: ImportError;
      try {
        let response: Response;
        try {
          response = await fetch(path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: serialized, redirect: "error", signal: controller.signal });
        } catch { checkRound(); throw new ImportError("INGEST_CONNECTION_FAILED"); }
        checkRound();
        if (!response.ok) throw await responseError(response);
        try { const result: unknown = await response.json(); checkRound(); return result; }
        catch { checkRound(); throw new ImportError("INGEST_RESPONSE_INVALID"); }
      } catch (error) {
        checkRound();
        if (!(error instanceof ImportError)) throw error;
        failure = error;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }
      const retryable = failure.code === "INGEST_CONNECTION_FAILED" || [408, 429, 502, 503, 504].includes(failure.httpStatus ?? 0);
      if (!retryable || attempt >= retries) throw failure;
      await waitToRetry(attempt);
    }
  };
  return {
    async sources(request) {
      const response = await post(`${url.href.replace(/\/$/, "")}/sources`, request);
      if (!response || typeof response !== "object" || !("sources" in response) || !Array.isArray(response.sources) || response.sources.length > request.sourceIds.length) throw new ImportError("SOURCE_METADATA_INVALID");
      const ids = new Set<string>();
      for (const raw of response.sources) {
        const source = raw as ManagedWorkerSource;
        if (!source || !request.sourceIds.includes(source.id) || ids.has(source.id) || !["afd", "defense-access", "defense-person"].includes(source.kind) || typeof source.active !== "boolean" || typeof source.sourceIdentityConfirmed !== "boolean" || typeof source.identityNamespace !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(source.identityNamespace) || typeof source.timeZone !== "string" || !Number.isFinite(Date.parse(source.configurationUpdatedAt))) throw new ImportError("SOURCE_METADATA_INVALID");
        try { new Intl.DateTimeFormat("en", { timeZone: source.timeZone }); } catch { throw new ImportError("SOURCE_METADATA_INVALID"); }
        const coverage = source.declaredCoverage;
        if (coverage !== null && (!coverage || typeof coverage.continuous !== "boolean" || !Number.isFinite(Date.parse(coverage.from)) || !Number.isFinite(Date.parse(coverage.to)) || Date.parse(coverage.to) <= Date.parse(coverage.from))) throw new ImportError("SOURCE_METADATA_INVALID");
        ids.add(source.id);
      }
      // Whitelist fields; no root or photoRoot returned by a server can reach filesystem access.
      return { sources: response.sources.map(({ id, kind, timeZone, identityNamespace, active, configurationUpdatedAt, sourceIdentityConfirmed, declaredCoverage }: ManagedWorkerSource) => ({ id, kind, timeZone, identityNamespace, active, configurationUpdatedAt, sourceIdentityConfirmed, declaredCoverage })) };
    },
    async persist(batch: IngestBatch): Promise<IngestBatchResponse> {
      const response = await post(url.href, batch);
      if (!response || typeof response !== "object" || !("accepted" in response) || response.accepted !== true) throw new ImportError("INGEST_BATCH_NOT_ACKNOWLEDGED");
      return response as IngestBatchResponse;
    },
    async heartbeat(sourceId, state, code, source) { await post(url.href, { protocolVersion: 1, heartbeat: { sourceId, state, ...(code ? { code } : {}), ...(source ? { source } : {}) } }); },
    async failure(failure) { await post(url.href, { protocolVersion: 1, failure }); },
    async reprocess(request) {
      const response = await post(`${url.href.replace(/\/$/, "")}/reprocess`, request);
      if (!response || typeof response !== "object") throw new ImportError("REPROCESS_RESPONSE_INVALID");
      const parsed = response as Record<string, unknown>;
      for (const key of ["processed", "pending", "failed"]) if (typeof parsed[key] !== "number" || !Number.isSafeInteger(parsed[key]) || Number(parsed[key]) < 0) throw new ImportError("REPROCESS_RESPONSE_INVALID");
      return parsed as { processed: number; pending: number; failed: number };
    },
    async photo(photo) { await post(`${url.href.replace(/\/$/, "")}/photo`, photo); },
  };
}
