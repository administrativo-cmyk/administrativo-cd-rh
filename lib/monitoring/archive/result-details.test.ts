import {describe,it,expect,vi} from "vitest";
import type {ArchiveCloudStore} from "./cloud-store";
import {digest,packObject} from "./format";
import {hydrateResultDetails} from "./result-details";

const id='aa120000-0000-4000-8000-000000000001';
function fixture(){
 const full={workMs:3600000,location:{operation:[{state:'outside',from:1,to:2}]},issues:[]};
 const raw=JSON.stringify(full);const packed=packObject('details/test.gz',Buffer.from(JSON.stringify({table:'public.monitoring_result_details',rows:[{id,raw},{id:'aa120000-0000-4000-8000-000000000002',raw:JSON.stringify({otherEmployee:true})}]})));
 const catalog={objects:[{...packed.object,expanded_sha256:packed.object.expandedSha256,expanded_bytes:packed.object.expandedBytes}]};
 const client={rpc:vi.fn().mockResolvedValue(catalog),download:vi.fn().mockResolvedValue(packed.compressed)} as unknown as ArchiveCloudStore;
 const value={results:[{date:'2026-10-08',summary:{workedSeconds:3600},result:{archiveDetail:{path:packed.object.path,id,sha256:digest(raw)}}}]};
 return {full,client,value};
}
describe('authenticated archived calculation details',()=>{
 it('verifies the cloud object and row hash, returning only the employee already authorized by the RPC',async()=>{
  const {full,client,value}=fixture();const result=await hydrateResultDetails(value,()=>client);
  expect(result).toEqual({results:[{...value.results[0],result:full}]});expect(JSON.stringify(result)).not.toContain('otherEmployee');expect(JSON.stringify(result)).not.toContain('archiveDetail');
 });
 it('refuses missing cloud objects and changed result rows instead of showing a partial projection',async()=>{
  const {client,value}=fixture();value.results[0].result.archiveDetail.sha256='0'.repeat(64);
  await expect(hydrateResultDetails(value,()=>client)).rejects.toThrow('ARCHIVE_RESULT_INVALID');
  vi.mocked(client.rpc).mockResolvedValue({objects:[]});await expect(hydrateResultDetails(value,()=>client)).rejects.toThrow('ARCHIVE_RESULT_UNAVAILABLE');
 });
 it('keeps fresh results independent of archive credentials',async()=>{
  const getClient=vi.fn();const value={results:[{result:{workMs:null}}]};expect(await hydrateResultDetails(value,getClient)).toBe(value);expect(getClient).not.toHaveBeenCalled();
 });
});
