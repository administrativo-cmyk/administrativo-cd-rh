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
});
