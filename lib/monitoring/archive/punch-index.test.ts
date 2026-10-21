import { describe,expect,it } from "vitest";
import { digest } from "./format";
import { equivalentPunch,indexMetadata,mergeIndexedPunch,parsePunchIndex,rollingWindow,shardFor,type IndexedPunch } from "./punch-index";
const punch=(changes:Partial<IndexedPunch>={}):IndexedPunch=>({nsr:"000010001",key:"event",payloadHash:digest("raw"),at:"2026-10-08T11:00:00.000Z",precisionSeconds:60,
 identityType:"cpf",identityValue:"12345678909",profile:"legacy",conflicted:false,origins:[{fileSha256:digest("file"),line:1}],...changes});
describe("immutable archive NSR index",()=>{
 it("retains more precise compatible punches without declaring a conflict",()=>{
  const a=punch();const b=punch({at:"2026-10-08T11:00:37.000Z",precisionSeconds:1,profile:"iso",payloadHash:digest("iso"),eventId:"aa120000-0000-4000-8000-000000000001"});
  expect(equivalentPunch(a,b)).toBe(true);expect(mergeIndexedPunch(a,b)).toMatchObject({at:b.at,precisionSeconds:1,conflicted:false,eventId:b.eventId});
 });
 it("flags different minutes or documents and preserves both original references",()=>{
  const b=punch({at:"2026-10-08T11:01:00.000Z",origins:[{fileSha256:digest("other"),line:5}]});
  expect(mergeIndexedPunch(punch(),b)).toMatchObject({conflicted:true});expect(mergeIndexedPunch(punch(),b).origins).toHaveLength(2);
  expect(equivalentPunch(punch(),punch({identityType:"pis"}))).toBe(false);
  expect(equivalentPunch(punch(),punch({payloadHash:digest("changed same layout")}))).toBe(false);
 });
 it("validates shard membership, duplicate NSRs and document digits",()=>{
  expect(shardFor("000010001")).toBe(1);
  expect(parsePunchIndex({version:1,sourceId:"clock",shard:1,punches:[punch()]}).punches).toHaveLength(1);
  expect(()=>parsePunchIndex({version:1,sourceId:"clock",shard:0,punches:[punch()]})).toThrow("ARCHIVE_INDEX_INVALID");
  expect(()=>parsePunchIndex({version:1,sourceId:"clock",shard:1,punches:[punch(),punch()]})).toThrow("ARCHIVE_INDEX_INVALID");
  expect(()=>parsePunchIndex({version:1,sourceId:"clock",shard:1,punches:[punch({identityValue:"00000000000"})]})).toThrow();
 });
 it("keeps source identity in the index and private document hashes in metadata",()=>{
  const metadata=indexMetadata({version:1,sourceId:"clock-one",shard:1,punches:[punch()]});
  expect(metadata.sourceId).toBe("clock-one");expect(JSON.stringify(metadata)).not.toContain("12345678909");
 });
 it("uses rolling months instead of payroll cycles and includes the night boundary",()=>{
  expect(rollingWindow("2026-10-21")).toEqual({months:3,cutoff:"2026-07-21",eventFrom:"2026-07-20T00:00:00-03:00"});
  expect(rollingWindow("2026-05-31").cutoff).toBe("2026-02-28");
  expect(rollingWindow("2024-05-31").cutoff).toBe("2024-02-29");
 });
});
