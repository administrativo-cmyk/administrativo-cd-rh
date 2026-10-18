import { beforeEach, describe, expect, it, vi } from "vitest";
const mock=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn(),upload:vi.fn(),validate:vi.fn(),origin:vi.fn()}));
vi.mock("@/lib/daily-call-operations-server",()=>({dailyCallSession:mock.session,uploadValidatedAttachment:mock.upload,operationHeaders:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"},operationFailure:(error:unknown)=>Response.json({error:"Operação indisponível"},{status:(error as {code?:string})?.code==="42501"?403:409})}));
vi.mock("@/lib/security/mutation-origin",()=>({isTrustedMutationOrigin:mock.origin}));
vi.mock("@/lib/daily-call-attachment-validation",()=>({validateAttachment:mock.validate,InvalidAttachmentError:class extends Error{}}));
import { POST as batch } from "./batch/route";
import { GET as attachments, POST as upload } from "./attachments/route";
import { InvalidAttachmentError } from "@/lib/daily-call-attachment-validation";
const id="aaaaaaaa-0000-4000-8000-000000000001";
const request=(data:unknown)=>new Request("http://localhost:3000/api/daily-call/batch",{method:"POST",headers:{"Content-Type":"application/json","Origin":"http://localhost:3000"},body:JSON.stringify(data)});
beforeEach(()=>{vi.clearAllMocks();mock.origin.mockReturnValue(true);mock.session.mockResolvedValue({client:{rpc:mock.rpc},actor:id});mock.rpc.mockResolvedValue({data:{rows:[]},error:null});mock.validate.mockResolvedValue(undefined);mock.upload.mockResolvedValue({data:{id},error:null});});
describe("API lote e anexos",()=>{
 it("recusa origem, sessão e lote sem prévia sem executar RPC",async()=>{
  mock.origin.mockReturnValue(false);expect((await batch(request({}))).status).toBe(403);expect(mock.session).not.toHaveBeenCalled();
  mock.origin.mockReturnValue(true);mock.session.mockResolvedValueOnce({response:new Response(null,{status:401})});expect((await batch(request({}))).status).toBe(401);
  expect((await batch(request({action:"apply",data:{mode:"fill_blank",reason:"Conferido",items:[{employeeId:id,date:"2026-10-10",status:"P",observation:null}]}}))).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();
 });
 it("upload valida escopo e bytes antes do canal privilegiado; actor vem da sessão",async()=>{
  const data={employeeId:id,date:"2026-10-10",fileName:"prova.pdf",mediaType:"application/pdf",content:"dGVzdA==",description:"Conferido"};
  expect((await upload(request({...data,actor:"forged"}))).status).toBe(400);expect(mock.upload).not.toHaveBeenCalled();
  mock.rpc.mockResolvedValueOnce({error:{code:"42501"}});expect((await upload(request(data))).status).toBe(403);expect(mock.validate).not.toHaveBeenCalled();
  expect((await upload(request(data))).status).toBe(201);expect(mock.validate).toHaveBeenCalled();expect(mock.upload).toHaveBeenCalledWith(id,data);
 });
 it("download privado revalida acesso e força attachment, nosniff e no-store",async()=>{
  mock.rpc.mockResolvedValue({data:{fileName:"justificativa.pdf",mediaType:"application/pdf",content:"dGVzdA=="},error:null});
  const response=await attachments(new Request(`http://localhost:3000/api/daily-call/attachments?id=${id}`));expect(response.status).toBe(200);expect(response.headers.get("Content-Disposition")).toMatch(/^attachment;/);expect(response.headers.get("Cache-Control")).toContain("no-store");expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");expect(await response.text()).toBe("test");
  mock.rpc.mockResolvedValueOnce({error:{code:"42501"}});expect((await attachments(new Request(`http://localhost:3000/api/daily-call/attachments?id=${id}`))).status).toBe(403);
 });
 it("arquivo rejeitado pelo parser ou payload excedido nunca chega ao serviço privilegiado",async()=>{
  mock.validate.mockRejectedValueOnce(new InvalidAttachmentError());
  const data={employeeId:id,date:"2026-10-10",fileName:"prova.pdf",mediaType:"application/pdf",content:"dGVzdA==",description:"Conferido"};
  expect((await upload(request(data))).status).toBe(400);expect(mock.upload).not.toHaveBeenCalled();
  const oversized=new Request("http://localhost:3000/api/daily-call/attachments",{method:"POST",headers:{"Content-Type":"application/json","Content-Length":"2850001"},body:"{}"});
  expect((await upload(oversized)).status).toBe(400);expect(mock.upload).not.toHaveBeenCalled();
 });
});
