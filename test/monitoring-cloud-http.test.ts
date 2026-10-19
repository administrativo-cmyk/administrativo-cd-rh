import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ claims: vi.fn(), profile: vi.fn(), rpc: vi.fn(), serviceRpc: vi.fn(), sign: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: mocks.claims }, from: () => ({ select: () => ({ eq: () => ({ single: mocks.profile }) }) }), rpc: mocks.rpc }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: mocks.serviceRpc, storage: { from: () => ({ createSignedUploadUrl: mocks.sign }) } }) }));
import { GET, POST } from "@/app/api/monitoring/cloud/route";
import { POST as action } from "@/app/api/monitoring/cloud/[id]/[action]/route";
import { downloadCloudObject } from "@/lib/monitoring/cloud/storage";
import { dispatchHash, type CloudJob } from "@/lib/monitoring/cloud/server";

const id = "80000000-0000-4000-8000-000000000001";
const source = { id: "ponto", name: "Ponto", kind: "afd" as const };
const job: CloudJob = { id, sourceId: source.id, source: { id: source.id, kind: "afd", timeZone: "America/Sao_Paulo", identityNamespace: "ponto", sourceIdentityConfirmed: false, afdProfile: "legacy", encoding: "latin1" },
  fileName: "ponto.txt", objectPath: `${id}/original.txt`, bucket: "monitoramento-originais", byteLength: 3, sha256: createHash("sha256").update("abc").digest("hex"),
  parserVersion: "monitoring-import/1.0.0/afd-legacy", status: "uploading", cursor: 0, processedRows: 0, totalRows: null, totalBatches: null,
  attempts: 0, maxAttempts: 5, nextRetryAt: null, lastError: null, createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T00:00:00Z", completedAt: null };
const input = { sourceId: source.id, fileName: job.fileName, byteLength: job.byteLength, sha256: job.sha256, afdProfile: "legacy" };
const request = (data: unknown, origin = "https://app.example") => new Request("https://app.example/api/monitoring/cloud", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(data) });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("APP_ORIGIN", "https://app.example"); vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MONITORING_INGEST_SOURCE_IDS", "ponto"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co"); vi.stubEnv("MONITORING_SUPABASE_SERVICE_ROLE_KEY", "server-test-key");
  mocks.claims.mockResolvedValue({ data: { claims: { sub: id } } }); mocks.profile.mockResolvedValue({ data: { id, status_usuario: "APROVADO", papel_usuario: "ADMIN" } });
  mocks.rpc.mockImplementation((_name, args) => Promise.resolve({ data: args.p_action === "list" ? { jobs: [job], sources: [source], automationReady: true } : { job }, error: null }));
  mocks.sign.mockResolvedValue({ data: { signedUrl: "https://project.supabase.co/upload", token: "temporary-test-token", path: job.objectPath }, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("cloud uploads authorization and contract", () => {
  it("rejects anonymous, unapproved and manager access before any queue or Storage operation", async () => {
    mocks.claims.mockResolvedValue({ data: null }); expect((await GET()).status).toBe(401);
    mocks.claims.mockResolvedValue({ data: { claims: { sub: id } } });
    for (const profile of [{ status_usuario: "PENDENTE", papel_usuario: "ADMIN" }, { status_usuario: "APROVADO", papel_usuario: "GESTOR" }]) {
      mocks.profile.mockResolvedValue({ data: profile }); expect((await POST(request(input))).status).toBe(403);
    }
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("requires trusted mutation origin before consulting the user session", async () => {
    expect((await POST(request(input, "https://external.example"))).status).toBe(403); expect(mocks.claims).not.toHaveBeenCalled();
  });
  it("rejects unknown sources, path traversal, missing AFD profile and oversized files before creating a job", async () => {
    for (const change of [{ sourceId: "other" }, { fileName: "../ponto.txt" }, { afdProfile: undefined }, { byteLength: 20 * 1024 * 1024 + 1 }, { fileName: "ponto.exe" }]) {
      const result = await POST(request({ ...input, ...change })); expect([400, 403]).toContain(result.status);
    }
    expect(mocks.rpc.mock.calls.some(call => call[1].p_action === "create")).toBe(false); expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("creates an immutable signed upload for the authorized database path with server-selected parser version", async () => {
    const result = await POST(request(input)); expect(result.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("monitoring_cloud_admin", { p_action: "create", p_data: { ...input, encoding: "latin1", parserVersion: job.parserVersion } });
    expect(mocks.sign).toHaveBeenCalledWith(job.objectPath, { upsert: false });
    const body = await result.json(); expect(body.upload.token).toBe("temporary-test-token"); expect(JSON.stringify(body)).not.toContain("server-test-key");
  });
  it("history hides storage paths, SHA and frozen configuration", async () => {
    const response = await GET(); expect(response.status).toBe(200); const body = await response.json();
    expect(body.jobs[0]).toMatchObject({ id, bytes: 3, batchesDone: 0 }); expect(JSON.stringify(body)).not.toContain(job.objectPath); expect(JSON.stringify(body)).not.toContain(job.sha256);
  });
  it("recognizes completed duplicates and recovers a stored upload without overwriting it", async () => {
    mocks.rpc.mockImplementation((_name, args) => Promise.resolve({ data: args.p_action === "list" ? { jobs: [], sources: [source], automationReady: true } : { job: { ...job, status: "completed" }, duplicate: true }, error: null }));
    const done = await POST(request(input)); expect((await done.json()).alreadyUploaded).toBe(true); expect(mocks.sign).not.toHaveBeenCalled();
    mocks.rpc.mockImplementation((_name, args) => Promise.resolve({ data: args.p_action === "list" ? { jobs: [], sources: [source], automationReady: true } : args.p_action === "complete" ? { job: { ...job, status: "queued" } } : { job, duplicate: true, uploadPresent: true }, error: null }));
    const resumed = await POST(request(input)); expect(await resumed.json()).toMatchObject({ id, status: "queued", alreadyUploaded: true }); expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("requires a version for retry/cancel and can confirm an already uploaded file after reload", async () => {
    expect((await action(request({}), { params: Promise.resolve({ id, action: "cancel" }) })).status).toBe(409);
    expect((await action(request({}), { params: Promise.resolve({ id, action: "complete" }) })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("monitoring_cloud_admin", { p_action: "complete", p_data: { id, expectedUpdatedAt: job.updatedAt } });
  });
  it("does not accept new files before the server scheduler is active", async () => {
    mocks.rpc.mockResolvedValue({ data: { jobs: [], sources: [source], automationReady: false }, error: null });
    const response = await POST(request(input)); expect(response.status).toBe(409); expect((await response.json()).code).toBe("CLOUD_AUTOMATION_DISABLED");
    expect(mocks.sign).not.toHaveBeenCalled(); expect(mocks.rpc.mock.calls.some(call => call[1].p_action === "create")).toBe(false);
  });
  it("never exposes backend details in a failed request", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "XX000", message: "server-test-key confidential SQL" } });
    const response = await GET(); expect(response.status).toBe(503); expect(await response.text()).not.toContain("confidential");
  });
});
describe("cloud private object boundary", () => {
  it("requires a strict one-use dispatch token and hashes it without passing the raw token to SQL", () => {
    expect(() => dispatchHash(new Request("https://app.example"))).toThrow("CLOUD_DISPATCH_INVALID");
    expect(() => dispatchHash(new Request("https://app.example", { headers: { authorization: "Bearer service-role-not-a-dispatch" } }))).toThrow();
    const token = "a".repeat(64); expect(dispatchHash(new Request("https://app.example", { headers: { authorization: `Bearer ${token}` } }))).toBe(createHash("sha256").update(token).digest("hex"));
  });
  it("downloads only from the fixed Supabase project and disallows redirects", async () => {
    vi.stubGlobal("fetch", mocks.fetch); mocks.fetch.mockResolvedValue(new Response("abc"));
    expect((await downloadCloudObject(job, new AbortController().signal)).toString()).toBe("abc");
    const [url, options] = mocks.fetch.mock.calls[0]; expect(String(url)).toBe(`https://project.supabase.co/storage/v1/object/authenticated/monitoramento-originais/${job.objectPath}`); expect(options.redirect).toBe("error");
  });
  it("rejects paths not assigned to the job before making a network request", async () => {
    vi.stubGlobal("fetch", mocks.fetch);
    for (const objectPath of ["https://external.example/file", `${id}/../another`, "another-id/file"]) await expect(downloadCloudObject({ ...job, objectPath }, new AbortController().signal)).rejects.toThrow("CLOUD_OBJECT_INVALID");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("enforces actual streamed size even when content-length is absent", async () => {
    vi.stubGlobal("fetch", mocks.fetch); mocks.fetch.mockResolvedValue(new Response("abcd"));
    await expect(downloadCloudObject(job, new AbortController().signal)).rejects.toThrow("CLOUD_SIZE_MISMATCH");
  });
  it("stops before downloading when the invocation deadline already expired", async () => {
    vi.stubGlobal("fetch", mocks.fetch); const controller = new AbortController(); controller.abort();
    await expect(downloadCloudObject(job, controller.signal)).rejects.toThrow(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
