import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({getClaims:vi.fn(),single:vi.fn(),rpc:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getClaims:mocks.getClaims},from:()=>({select:()=>({eq:()=>({single:mocks.single})})}),rpc:mocks.rpc})}));
import { POST } from "./route";
const request=(action:string,data:unknown={},origin="http://localhost:3000")=>new Request("http://localhost:3000/api/workspace",{method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify({action,data})});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("NODE_ENV","development");mocks.getClaims.mockResolvedValue({data:{claims:{sub:"10000000-0000-4000-8000-000000000001"}}});mocks.single.mockResolvedValue({data:{status_usuario:"APROVADO",papel_usuario:"ADMIN"}});mocks.rpc.mockResolvedValue({data:{changed:true},error:null});});
afterEach(()=>vi.unstubAllEnvs());
describe("workspace API boundary",()=>{
 it("rejects foreign origins before session lookup",async()=>{expect((await POST(request("settings",{},"https://foreign.example"))).status).toBe(403);expect(mocks.getClaims).not.toHaveBeenCalled();});
 it("requires authentication",async()=>{mocks.getClaims.mockResolvedValue({data:null});expect((await POST(request("settings"))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();});
 it.each(["PENDENTE","BLOQUEADO"])("rejects %s",async status=>{mocks.single.mockResolvedValue({data:{status_usuario:status,papel_usuario:"ADMIN"}});expect((await POST(request("settings"))).status).toBe(403);});
 it.each(["__proto__","constructor","missing"])("rejects unknown operation %s",async action=>{expect((await POST(request(action))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it("requires expected version for profile edits",async()=>{expect((await POST(request("save_profile",{name:"Pessoa teste"}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it("rejects incomplete notice targeting/version",async()=>{expect((await POST(request("save_notice",{title:"Teste",body:"Texto",audienceRole:"GESTOR",managerId:"10000000-0000-4000-8000-000000000002",reason:"Motivo teste"}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it("passes only validated personal preferences and disables caching",async()=>{const response=await POST(request("save_preferences",{defaultDashboard:"monitoramento",compactTables:true,notificationsEnabled:false,expectedUpdatedAt:null}));expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(mocks.rpc).toHaveBeenCalledWith("workspace",{p_action:"save_preferences",p_data:{defaultDashboard:"monitoramento",compactTables:true,notificationsEnabled:false,expectedUpdatedAt:null}});});
 it("maps stale versions without exposing DB internals",async()=>{mocks.rpc.mockResolvedValue({data:null,error:{code:"P0001",message:"WORKSPACE_STALE internal sensitive detail"}});const response=await POST(request("settings"));expect(response.status).toBe(409);expect(await response.text()).not.toContain("sensitive");});
});
