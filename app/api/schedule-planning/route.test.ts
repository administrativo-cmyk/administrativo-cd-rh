import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({getClaims:vi.fn(),single:vi.fn(),rpc:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getClaims:mocks.getClaims},from:()=>({select:()=>({eq:()=>({single:mocks.single})})}),rpc:mocks.rpc})}));
import { POST } from "./route";
const id="10000000-0000-4000-8000-000000000001", version="2026-10-18T01:00:00Z";
const request=(data:unknown,origin="http://localhost:3000")=>new Request("http://localhost:3000/api/schedule-planning",{method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify(data)});
const model={kind:"template",name:"Modelo",scope:"global",target:null,validFrom:"2026-10-01",validTo:null,reason:"Modelo de teste",payload:{name:"Diurno",start:"08:00",end:"17:00",days:[1,2,3,4,5],allowNoBreak:false,pairing:"alternating",coffeeWindows:[]}};
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("NODE_ENV","development");mocks.getClaims.mockResolvedValue({data:{claims:{sub:id}}});mocks.single.mockResolvedValue({data:{status_usuario:"APROVADO",papel_usuario:"ADMIN"}});mocks.rpc.mockResolvedValue({data:{changed:true,record:{...model,id,memberCount:0,active:true,createdAt:version,updatedAt:version}},error:null});});
afterEach(()=>vi.unstubAllEnvs());
describe("API de escalas e sugestões",()=>{
 it("bloqueia origem externa e sessão ausente antes da RPC",async()=>{expect((await POST(request({action:"list",data:{}},"https://invalid.example"))).status).toBe(403);expect(mocks.getClaims).not.toHaveBeenCalled();mocks.getClaims.mockResolvedValue({data:null});expect((await POST(request({action:"list",data:{}}))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();});
 it("recusa perfil bloqueado",async()=>{mocks.single.mockResolvedValue({data:{status_usuario:"BLOQUEADO",papel_usuario:"ADMIN"}});expect((await POST(request({action:"list",data:{}}))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();});
 it.each([{...model,id},{...model,payload:{...model.payload,days:[1,1]}},{...model,kind:"calendar",validTo:"2027-10-01",payload:{working:false}},{...model,kind:"calendar",validTo:"2026-10-01",payload:{working:true}}])("recusa CAS, dias duplicados, janela longa e escala ausente",async data=>{expect((await POST(request({action:"save",data}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it("salva pelo wrapper com sessão e sem cache",async()=>{const response=await POST(request({action:"save",data:model}));expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toBe("private, no-store");expect(mocks.rpc).toHaveBeenCalledWith("schedule_planning",{p_action:"save",p_data:model});});
 it("não anuncia sucesso quando RPC retorna payload nulo ou aprovação indevida",async()=>{mocks.rpc.mockResolvedValue({data:null,error:null});expect((await POST(request({action:"save",data:model}))).status).toBe(503);mocks.rpc.mockResolvedValue({data:{record:{id,status:"approved"}},error:null});expect((await POST(request({action:"accept_suggestion",data:{employeeId:id,policyId:id,start:"2026-10-01",end:"2026-10-30",selectedStart:"2026-10-02",expectedVersion:"v1",reason:"Aceite teste"}}))).status).toBe(503);});
 it("traduz conflito sem expor detalhes internos",async()=>{mocks.rpc.mockResolvedValue({data:null,error:{message:"PLANNING_STALE secret",code:"P0001"}});const response=await POST(request({action:"save",data:model}));expect(response.status).toBe(409);expect(await response.text()).not.toContain("secret");});
});
