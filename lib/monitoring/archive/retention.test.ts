import {describe,it,expect,vi} from "vitest";
import type {ArchiveCloudStore} from "./cloud-store";
import {retainRecentMonths} from "./retention";
import {digest} from "./format";
import * as archiveFormat from "./format";
describe("cloud rolling retention",()=>{
 it("compacts calculated details even while provenance retirement has a continuing backlog",async()=>{
  const raw=JSON.stringify({rows:[{id:"synthetic"}]});
  const rpc=vi.fn(async(action:string)=>{
   if(action==="policy")return {active:true,maintenance:false};
   if(action==="details_page"||action==="retention_page")return {rows:1,raw,sha256:digest(raw),table:action==="details_page"?"public.monitoring_result_details":"public.monitoring_occurrences"};
   return {ok:true,rows:1};
  });
  const client={rpc,put:vi.fn()} as unknown as ArchiveCloudStore;
  expect(await retainRecentMonths(client,Date.now()+30000,4)).toMatchObject({pending:true,archived:2,compacted:2});
 });
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
  expect(rpc.mock.calls.map(call=>call[0])).toContain("details_commit");expect(rpc.mock.calls.map(call=>call[0])).not.toContain("retention_commit");
 });
 it("keeps immutable cloud copies compatible when two platforms encode the same raw page with different gzip headers",async()=>{
  const raw=JSON.stringify({table:"public.monitoring_result_details",rows:[{id:"synthetic",raw:"{}"}]});
  const realPack=archiveFormat.packObject;let platform=0,served=false;
  const encode=vi.spyOn(archiveFormat,"packObject").mockImplementation((path,bytes)=>{
   const packed=realPack(path,bytes);const compressed=Buffer.from(packed.compressed);compressed[9]=platform;
   return {compressed,object:{...packed.object,sha256:digest(compressed)}};
  });
  const copies=new Map<string,Buffer>();
  const client={rpc:vi.fn(async(action:string)=>{
   if(action==="policy")return {active:true,maintenance:false};if(action==="retention_page")return {rows:0};
   if(action==="details_page"){if(served)return {rows:0};served=true;return {raw,sha256:digest(raw),table:"public.monitoring_result_details",rows:1};}
   if(action==="details_commit")return {ok:true,rows:1};return {ok:true};
  }),put:vi.fn(async(object:archiveFormat.ArchiveObject,bytes:Buffer)=>{
   if(copies.has(object.path)&&!copies.get(object.path)!.equals(bytes))throw new Error("ARCHIVE_REMOTE_HASH_MISMATCH");
   expect(archiveFormat.unpackObject(object,bytes).toString()).toBe(raw);copies.set(object.path,bytes);
  })} as unknown as ArchiveCloudStore;
  try{
   expect(await retainRecentMonths(client,Date.now()+30000)).toMatchObject({compacted:1,pending:false});
   platform=3;served=false;expect(await retainRecentMonths(client,Date.now()+30000)).toMatchObject({compacted:1,pending:false});
   expect(copies.size).toBe(2);
  }finally{encode.mockRestore();}
 });
});
