import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchiveCloudStore } from "./cloud-store";
import { archiveStorageBudget, packObject } from "./format";
const project = "abcdefghijklmnopqrst";
const store = () => new ArchiveCloudStore(project, "synthetic-server-key", `https://${project}.supabase.co`);
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("private archive object store", () => {
  it("keeps the original archive project identity when its storage moves to a configured domain", () => {
    vi.stubEnv("SUPABASE_SELF_HOSTED_ORIGIN", "https://supabase-rh.example.com");
    vi.stubEnv("MONITORING_SUPABASE_PROJECT_REF", project);
    expect(() => new ArchiveCloudStore(project, "synthetic-server-key", "https://supabase-rh.example.com")).not.toThrow();
    expect(() => new ArchiveCloudStore("zyxwvutsrqponmlkjihg", "synthetic-server-key", "https://supabase-rh.example.com")).toThrow("ARCHIVE_PROJECT_MISMATCH");
  });
  it("rejects another project and insecure origins before network access", () => {
    expect(() => new ArchiveCloudStore(project, "key", "https://other.supabase.co")).toThrow("ARCHIVE_PROJECT_MISMATCH");
    expect(() => new ArchiveCloudStore(project, "key", `http://${project}.supabase.co`)).toThrow("ARCHIVE_PROJECT_MISMATCH");
  });
  it("uploads without overwrite and rereads the hash before registering an object", async () => {
    const packed = packObject("snapshot/file.gz", Buffer.from("recoverable original bytes"));
    const requests: Array<{url:string; init?:RequestInit}> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      requests.push({url:String(url),init});
      if (String(url).includes("/rpc/")) {
        const data = JSON.parse(init.body as string);
        return Response.json(data.p_action === "state" ? {storageBytes:0} : {ok:true});
      }
      if (init.method === "POST") return Response.json({ok:true});
      return new Response(new Uint8Array(packed.compressed));
    }));
    await store().put({...packed.object,kind:"snapshot",metadata:{}},packed.compressed);
    expect(requests).toHaveLength(4);
    expect(requests[1].init?.headers).toMatchObject({"x-upsert":"false"});
    expect(requests[2].url).toContain("/object/authenticated/monitoramento-historico/");
    expect(JSON.parse(requests[3].init?.body as string).p_action).toBe("objects");
  });
  it("does not register a changed remote object", async () => {
    const packed = packObject("snapshot/file.gz",Buffer.from("immutable"));
    const register = vi.fn();
    vi.stubGlobal("fetch",vi.fn(async (url:URL,init:RequestInit) => {
      if(String(url).includes("/rpc/")) { const data=JSON.parse(init.body as string);if(data.p_action==="objects")register();return Response.json({storageBytes:0}); }
      const changed=Buffer.from(packed.compressed);changed[12]^=1;
      return init.method==="POST"?Response.json({ok:true}):new Response(new Uint8Array(changed));
    }));
    await expect(store().put({...packed.object,kind:"snapshot",metadata:{}},packed.compressed)).rejects.toThrow("ARCHIVE_REMOTE_HASH_MISMATCH");
    expect(register).not.toHaveBeenCalled();
  });
  it("stops before an upload that exceeds the private storage budget", async () => {
    const packed=packObject("snapshot/file.gz",Buffer.from("private"));
    const fetcher=vi.fn(async()=>Response.json({storageBytes:archiveStorageBudget}));vi.stubGlobal("fetch",fetcher);
    await expect(store().put({...packed.object,kind:"snapshot",metadata:{}},packed.compressed)).rejects.toThrow("ARCHIVE_STORAGE_BUDGET_EXCEEDED");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
