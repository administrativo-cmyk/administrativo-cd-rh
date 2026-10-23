import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), calculate: vi.fn() }));
vi.mock("@/lib/monitoring/server", () => ({ workerClient: () => ({ rpc: (name: string, args: unknown) => ({ abortSignal: () => mocks.rpc(name, args) }) }) }));
vi.mock("@/lib/monitoring/reprocess", () => ({ buildReprocessResults: mocks.calculate }));
vi.mock("./server", () => ({ CloudError: class extends Error {} }));
import { reprocessCloudDays } from "./reprocess";
const employeeId = "30000000-0000-4000-8000-000000000001";
beforeEach(() => {
 vi.clearAllMocks(); vi.stubEnv("MONITORING_INGEST_SOURCE_IDS", "clock,clock");
 mocks.calculate.mockImplementation((_input,request)=>[{ employeeId, date: request.start, version: 1, ruleVersion: "test", result: {}, summary: {} }]);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("bounded cloud attendance backfill", () => {
 it("defers a shift that has not started without marking the day as failed",async()=>{
  const availableAt=Date.now()+3600000;let claimed=false;
  mocks.calculate.mockImplementation(()=>{throw Object.assign(new Error('MONITORING_FUTURE_PERIOD'),{availableAt});});
  mocks.rpc.mockImplementation(async(_name,args)=>args.p_action==='claim'?{data:{pending:1,jobs:claimed?[]:(claimed=true,[{employeeId,date:'2026-10-21',reason:'Turno ainda não iniciado',leaseToken:'40000000-0000-4000-8000-000000000001',input:{}}])}}:{error:null});
  const result=await reprocessCloudDays(new AbortController().signal,Date.now()+230000);
  expect(result).toMatchObject({processed:0,failed:0,deferred:1});
  expect(mocks.rpc.mock.calls.find(([,args])=>args.p_action==='defer')?.[1].p_data.until).toBe(new Date(availableAt+60000).toISOString());
 });
 it("continues beyond thirty days while time remains, with no unused leases", async () => {
  let claims = 0; let finishes = 0;
  mocks.rpc.mockImplementation(async (_name, args) => {
   if (args.p_action === "finish_many") { finishes+=args.p_data.jobs.length; return { error: null,data:{finished:args.p_data.jobs.length} }; }
   claims++;
   return { data: { pending: Math.max(0, 200 - finishes), jobs: finishes < 200 ? [{ employeeId, date: "2026-10-02", reason: "Revisão da chamada", leaseToken: "40000000-0000-4000-8000-000000000001", input: {} }] : [] } };
  });
  const result = await reprocessCloudDays(new AbortController().signal, Date.now() + 230_000);
  expect(result).toMatchObject({ processed: 200, failed: 0 }); expect(finishes).toBe(200); expect(claims).toBe(201);
  expect(mocks.rpc.mock.calls[0][1].p_data).toEqual({ sourceIds: ["clock"], limit: 5 });
 });
 it("stops claiming before the deadline while finishing every claimed day", async () => {
  let now = 0; let claims = 0; let finishes = 0; vi.spyOn(Date, "now").mockImplementation(() => now);
  mocks.rpc.mockImplementation(async (_name, args) => {
   if (args.p_action === "finish_many") { finishes+=args.p_data.jobs.length; now += 20_000; return { error: null,data:{finished:args.p_data.jobs.length} }; }
   claims++; return { data: { pending: 1000, jobs: [{ employeeId, date: "2026-10-02", reason: "Revisão da chamada", leaseToken: "40000000-0000-4000-8000-000000000001", input: {} }] } };
  });
  const result = await reprocessCloudDays(new AbortController().signal, 230_000);
  expect(result.processed).toBeGreaterThan(0); expect(result.processed).toBeLessThan(30); expect(claims).toBe(finishes); expect(now).toBeLessThan(230_000);
 });
 it("acknowledges all five claimed days together and replays an uncertain receipt",async()=>{
  let claimed=false;let acknowledgments=0;
  mocks.rpc.mockImplementation(async(_name,args)=>{
   if(args.p_action==="claim")return {data:{pending:claimed?0:5,jobs:claimed?[]:(claimed=true,Array.from({length:5},(_,i)=>({employeeId,date:`2026-10-0${i+1}`,reason:"Revisão recente",leaseToken:`40000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`,input:{}})))}};
   if(args.p_action==="finish_many")return ++acknowledgments===1?{error:{code:"NETWORK"}}:{error:null,data:{finished:5,replayed:true}};
   return {error:null};
  });
  expect(await reprocessCloudDays(new AbortController().signal,Date.now()+230000)).toMatchObject({processed:5,failed:0,pending:0});
  const writes=mocks.rpc.mock.calls.filter(([,args])=>args.p_action==="finish_many");
  expect(writes).toHaveLength(2);expect(writes[0][1].p_data).toEqual(writes[1][1].p_data);
  expect(writes[0][1].p_data.jobs).toHaveLength(5);expect(mocks.rpc.mock.calls.some(([,args])=>args.p_action==="retry")).toBe(false);
 });
});
