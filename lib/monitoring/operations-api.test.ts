import { File as NodeFile } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), operation: vi.fn(), rpc: vi.fn() }));
vi.mock("./server", async load => ({ ...await load<typeof import("./server")>(), monitoringSession: mocks.session, workerClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("./operations-server", async load => ({ ...await load<typeof import("./operations-server")>(), monitoringOperation: mocks.operation }));
import { POST as binding } from "@/app/api/monitoring/bindings/route";
import { POST as source, GET as sources } from "@/app/api/monitoring/sources/route";
import { POST as workerSources } from "@/app/api/monitoring/ingest/sources/route";
import { POST as clockImport } from "@/app/api/monitoring/clock-register/route";
import { POST as bankImport } from "@/app/api/time-bank-admin/import/route";
import { POST as ingest } from "@/app/api/monitoring/ingest/route";
import { httpBodyLimitBytes, importFileLimitBytes, importFileLimitMessage } from "./payload-limits";
const id = "ba000000-0000-4000-8000-000000000001";
function request(data: unknown, origin = "http://localhost:3000") { return new Request("http://localhost:3000/api/monitoring", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(data) }); }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "development"); mocks.session.mockResolvedValue({ userId: id, profile: { papel_usuario: "ADMIN" } }); mocks.operation.mockResolvedValue({ ok: true }); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("operational APIs", () => {
  it("aceita arquivo no limite com folga para campos multipart e rejeita byte extra", async () => {
    vi.stubGlobal("File", NodeFile);
    const header = "A;B;C;D;E\n"; const row = Array(5).fill("x".repeat(999)).join(";") + "\n";
    let csv = header + row.repeat(Math.floor((importFileLimitBytes - header.length) / row.length));
    let remaining = importFileLimitBytes - csv.length;
    while (remaining > 1000) { csv += "x".repeat(999) + ";"; remaining -= 1000; }
    csv += "x".repeat(remaining);
    expect(Buffer.byteLength(csv)).toBe(importFileLimitBytes);
    const options = { defaults: { reason: "á".repeat(1000) }, mapping: {} };
    const multipart = (content: string) => {
      const body = `--synthetic\r\nContent-Disposition: form-data; name="action"\r\n\r\ninspect\r\n--synthetic\r\nContent-Disposition: form-data; name="options"\r\n\r\n${JSON.stringify(options)}\r\n--synthetic\r\nContent-Disposition: form-data; name="file"; filename="${"á".repeat(120)}.csv"\r\nContent-Type: text/csv\r\n\r\n${content}\r\n--synthetic--\r\n`;
      expect(Buffer.byteLength(body)).toBeLessThan(httpBodyLimitBytes);
      return new Request("http://localhost:3000/api/time-bank-admin/import", { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "multipart/form-data; boundary=synthetic" }, body });
    };
    expect((await bankImport(multipart(csv))).status).toBe(200);
    const oversized = await bankImport(multipart(csv + "x"));
    expect(oversized.status).toBe(413); expect(await oversized.json()).toMatchObject({ error: importFileLimitMessage });
    expect(mocks.operation).not.toHaveBeenCalled();
  });
  it.each([clockImport, bankImport])("cancela multipart excessivo antes de interpretar ou gravar", async handler => {
    const request = new Request("http://localhost:3000/api/import", { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "multipart/form-data; boundary=synthetic" }, body: "x".repeat(httpBodyLimitBytes + 1) });
    expect((await handler(request)).status).toBe(413); expect(mocks.operation).not.toHaveBeenCalled();
  });
  it("limita ingestão JSON pelo número real de bytes antes da RPC", async () => {
    const token = "synthetic-worker-token-01234567890123456789";
    vi.stubEnv("MONITORING_INGEST_TOKEN", token); vi.stubEnv("MONITORING_INGEST_SOURCE_IDS", "clock"); mocks.rpc.mockResolvedValue({ data: {}, error: null });
    const base = JSON.stringify({ protocolVersion: 1, heartbeat: { sourceId: "clock", state: "idle" } });
    const requestAt = (length: number) => new Request("http://localhost/api/monitoring/ingest", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: base + " ".repeat(length - Buffer.byteLength(base)) });
    expect((await ingest(requestAt(httpBodyLimitBytes))).status).toBe(200);
    expect((await ingest(requestAt(httpBodyLimitBytes + 1))).status).toBe(400);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("recusa expansão JSON da prévia antes de persistir e não corta linhas", async () => {
    vi.stubGlobal("File", NodeFile);
    const csv = "Mat;Nome;CPF\n" + Array.from({ length: 2000 }, (_, index) => `${index};${"\\".repeat(1000)};${"\\".repeat(1000)}`).join("\n");
    expect(Buffer.byteLength(csv)).toBeLessThan(importFileLimitBytes);
    const options = { defaults: { reason: "Synthetic size test", sourceId: "clock", validFrom: "2026-10-17" }, mapping: { employeeNumber: 0, name: 1, cpf: 2 } };
    const body = `--synthetic\r\nContent-Disposition: form-data; name="action"\r\n\r\npreview\r\n--synthetic\r\nContent-Disposition: form-data; name="options"\r\n\r\n${JSON.stringify(options)}\r\n--synthetic\r\nContent-Disposition: form-data; name="file"; filename="synthetic.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--synthetic--\r\n`;
    const response = await clockImport(new Request("http://localhost:3000/api/monitoring/clock-register", { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "multipart/form-data; boundary=synthetic" }, body }));
    expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ code: "PREVIA_LIMITE_EXCEDIDO" });
    expect(mocks.operation).not.toHaveBeenCalled();
  });
  it("guarda resposta final por bytes e distingue confirmação já processada", async () => {
    mocks.operation.mockResolvedValue({ rows: [{ input: "á".repeat(httpBodyLimitBytes / 2) }] });
    const preview = await bankImport(request({ action: "get", id }));
    expect(preview.status).toBe(422); expect(await preview.json()).toMatchObject({ code: "PREVIA_LIMITE_EXCEDIDO" });
    const confirmed = await bankImport(request({ action: "confirm", id, expectedUpdatedAt: "2026-10-17T00:00:00Z", lines: [2] }));
    expect(confirmed.status).toBe(422); expect(await confirmed.json()).toMatchObject({ code: "RESULTADO_IMPORTACAO_LIMITE_EXCEDIDO", error: expect.stringContaining("foram processadas") });
  });
  it.each([binding, source, clockImport, bankImport])("checks trusted origin before session or mutation", async handler => {
    expect((await handler(request({}, "https://untrusted.example"))).status).toBe(403); expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.operation).not.toHaveBeenCalled();
  });
  it.each([binding, source, clockImport, bankImport])("requires an administrative session", async handler => {
    mocks.session.mockResolvedValue({ response: Response.json({}, { status: 403 }) }); expect((await handler(request({}))).status).toBe(403); expect(mocks.session).toHaveBeenCalledWith(true); expect(mocks.operation).not.toHaveBeenCalled();
  });
  it("requires CAS and reason for binding revision and does not leak internal failures", async () => {
    expect((await binding(request({ action: "restore", data: { id, reason: "Synthetic restore" } }))).status).toBe(400);
    const data = { id, expectedUpdatedAt: "2026-10-17T00:00:00Z", reason: "Synthetic restore" };
    expect((await binding(request({ action: "restore", data }))).status).toBe(200); expect(mocks.operation).toHaveBeenCalledWith("monitoring_binding_change", "restore", data);
    mocks.operation.mockRejectedValue(Object.assign(new Error("synthetic secret"), { code: "BINDING_STALE" })); const response = await binding(request({ action: "restore", data })); expect(response.status).toBe(409); expect(await response.text()).not.toContain("synthetic secret");
  });
  it("source API refuses browser-supplied paths and returns uncached list", async () => {
    const data = { id: "clock", label: "Clock", kind: "afd", timeZone: "America/Sao_Paulo", identityNamespace: "clock", active: true, sourceIdentityConfirmed: false, reason: "Synthetic source" };
    expect((await source(request({ ...data, root: "C:/arbitrary" }))).status).toBe(400); expect(mocks.operation).not.toHaveBeenCalled();
    expect((await source(request(data))).status).toBe(200); expect((await sources()).headers.get("Cache-Control")).toContain("no-store");
  });
  it("worker metadata requires token and explicit source allowlist", async () => {
    vi.stubEnv("MONITORING_INGEST_TOKEN", "synthetic-token-".repeat(4)); vi.stubEnv("MONITORING_INGEST_SOURCE_IDS", "clock");
    const make = (ids: string[], token?: string) => new Request("http://localhost/api/monitoring/ingest/sources", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ sourceIds: ids }) });
    expect((await workerSources(make(["clock"]))).status).toBe(401);
    expect((await workerSources(make(["other"], process.env.MONITORING_INGEST_TOKEN))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: { sources: [] }, error: null }); expect((await workerSources(make(["clock"], process.env.MONITORING_INGEST_TOKEN))).status).toBe(200); expect(mocks.rpc).toHaveBeenCalledWith("monitoring_worker_sources", { p_ids: ["clock"] });
  });
  it("parses bounded multipart files and stages only mapped rows, with no writes for inspection", async () => {
    vi.stubGlobal("File", NodeFile);
    const options = { defaults: { reason: "Synthetic register", sourceId: "clock", validFrom: "2026-10-17" }, mapping: { employeeNumber: 0, name: 1, cpf: 2 } };
    const multipart = (action: string) => new Request("http://localhost:3000/api/monitoring/clock-register", { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "multipart/form-data; boundary=synthetic" }, body: `--synthetic\r\nContent-Disposition: form-data; name="action"\r\n\r\n${action}\r\n--synthetic\r\nContent-Disposition: form-data; name="options"\r\n\r\n${JSON.stringify(options)}\r\n--synthetic\r\nContent-Disposition: form-data; name="file"; filename="synthetic.csv"\r\nContent-Type: text/csv\r\n\r\nMat;Nome;CPF\n000123;Synthetic;52998224725\r\n--synthetic--\r\n` });
    expect((await clockImport(multipart("inspect"))).status).toBe(200); expect(mocks.operation).not.toHaveBeenCalled();
    expect((await clockImport(multipart("preview"))).status).toBe(200); expect(mocks.operation).toHaveBeenCalledWith("operational_import", "preview", expect.objectContaining({ kind: "clock", rows: [expect.objectContaining({ input: { employeeNumber: "000123", name: "Synthetic", cpf: "52998224725" } })] }));
  });
});
