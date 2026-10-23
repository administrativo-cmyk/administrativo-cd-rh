import {describe,it,expect,vi} from "vitest";
import type {ArchiveCloudStore} from "./cloud-store";
import {retainRecentMonths} from "./retention";
import {digest} from "./format";
describe("cloud rolling retention",()=>{
 it("never commits removal when upload verification fails",async()=>{
  const raw=JSON.stringify({table:"public.monitoring_results",rows:[{id:"synthetic"}]});
  const rpc=vi.fn(async(action:string)=>action==="policy"?{active:true,maintenance:false}:{raw,sha256:digest(raw),table:"public.monitoring_results",rows:1});
  const client={rpc,put:vi.fn().mockRejectedValue(new Error("ARCHIVE_REMOTE_HASH_MISMATCH"))} as unknown as ArchiveCloudStore;
  await expect(retainRecentMonths(client,Date.now()+30000)).rejects.toThrow("ARCHIVE_REMOTE_HASH_MISMATCH");
  expect(rpc.mock.calls.map(call=>call[0])).not.toContain("retention_commit");
 });
 it("compacts full result details only after cloud verification and keeps the scheduled follow-up state accurate",async()=>{
  const raw=JSON.stringify({table:"public.monitoring_result_details",rows:[{id:"synthetic",raw:"{}"}]});let details=0;
  const rpc=vi.fn(async(action:string)=>{
   if(action==="policy")return {active:true,maintenance:false};
   if(action==="retention_page")return {rows:0};
   if(action==="details_page")return details++?{rows:0}:{raw,sha256:digest(raw),table:"public.monitoring_result_details",rows:1};
   if(action==="details_commit")return {ok:true,rows:1};return {ok:true};
  });
  const put=vi.fn().mockResolvedValue(undefined);const client={rpc,put} as unknown as ArchiveCloudStore;
  expect(await retainRecentMonths(client,Date.now()+30000)).toEqual({archived:0,compacted:1,pending:false});
  expect(put.mock.calls[0][0]).toMatchObject({metadata:{type:"result-details"}});
  expect(put.mock.calls[0][0].path).toBe(`details/public.monitoring_result_details/${put.mock.calls[0][0].sha256}.json.gz`);
  expect(rpc.mock.calls.map(call=>call[0])).toContain("details_commit");expect(rpc.mock.calls.map(call=>call[0])).not.toContain("retention_commit");
 });
});
