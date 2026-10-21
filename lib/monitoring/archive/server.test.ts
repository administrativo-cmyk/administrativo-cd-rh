import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {packObject} from "./format";
import {indexMetadata,type PunchIndex} from "./punch-index";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),download:vi.fn()}));
vi.mock("./cloud-store",()=>({ArchiveCloudStore:class{rpc=mocks.rpc;download=mocks.download;}}));
vi.mock("@/lib/data/daily-call-dates",()=>({todayInSaoPaulo:()=>"2026-10-21"}));
import {augmentArchivedInput} from "./server";
const employeeId="aa130000-0000-4000-8000-000000000001";
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://abcdefghijklmnopqrst.supabase.co");vi.stubEnv("MONITORING_SUPABASE_SERVICE_ROLE_KEY","synthetic");});
afterEach(()=>vi.unstubAllEnvs());
describe("authorized employee archive input",()=>{
 it("does not contact private storage for a recent period",async()=>{
  const input={events:[]};expect(await augmentArchivedInput(input,{employeeId,start:"2026-10-08",end:"2026-10-08"})).toEqual({input,archive:undefined});
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it("returns only bound identities in their effective dates and preserves existing canonical events",async()=>{
  const punch={nsr:"000000001",key:"punch:1",payloadHash:"a".repeat(64),at:"2026-06-15T11:00:00Z",precisionSeconds:1 as const,profile:"iso" as const,identityType:"cpf" as const,identityValue:"12345678909",conflicted:false,origins:[]};
  const index:PunchIndex={version:1,sourceId:"clock",shard:0,punches:[punch,{...punch,nsr:"000000002",key:"punch:2",identityValue:"11144477735"},{...punch,nsr:"000000003",key:"punch:3",at:"2026-06-16T11:00:00Z"}]};
  const packed=packObject("index.gz",Buffer.from(JSON.stringify(index)));const object={...packed.object,kind:"nsr_index",metadata:indexMetadata(index)};
  mocks.rpc.mockResolvedValue({active:true,maintenance:false,cutoff:"2026-07-21",files:[],objects:[object],bindings:[{sourceId:"clock",identityType:"cpf",identityValue:punch.identityValue,validFrom:"2026-06-15",validTo:"2026-06-15"}]});
  mocks.download.mockResolvedValue(packed.compressed);
  const period={employeeId,start:"2026-06-15",end:"2026-06-16"};
  const result=await augmentArchivedInput({events:[],version:2},period);
  expect(result.archive).toMatchObject({used:true,records:1});
  const input=result.input as {events:Array<{sourceId:string;payload:{identity:{value:string};key:string}}>} ;
  expect(input.events).toHaveLength(1);expect(input.events[0].payload.identity.value).toBe(punch.identityValue);
  const existing={sourceId:"clock",payload:{key:"punch:1",canonical:true}};
  expect((await augmentArchivedInput({events:[existing]},period)).input).toEqual({events:[existing]});
 });
 it("fails closed when a private object cannot be verified",async()=>{
  mocks.rpc.mockResolvedValue({active:true,maintenance:false,cutoff:"2026-07-21",bindings:[],files:[],objects:[{path:"broken.gz"}]});
  mocks.download.mockRejectedValue(new Error("private details"));
  await expect(augmentArchivedInput({events:[]},{employeeId,start:"2026-06-15",end:"2026-06-15"})).rejects.toThrow("ARCHIVE_HISTORY_UNAVAILABLE");
 });
});
