import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {ArchiveCloudStore,StoredArchiveObject} from './cloud-store';
import {digest,packObject,unpackObject} from './format';
import {indexedImport,indexMetadata} from './punch-index';
import type {CanonicalImportEvent} from '../ingestion/types';
const mocks=vi.hoisted(()=>({parse:vi.fn()}));
vi.mock('../ingestion/parsers.ts',()=>({parseAfd:mocks.parse}));
import {ensureArchivedSnapshot} from './prepare-cloud';
beforeEach(()=>vi.clearAllMocks());
const event:CanonicalImportEvent={key:'punch-key',type:'punch',timestamp:'2026-06-15T11:00:00Z',device:'clock',classification:'authorized',eligible:true,
 identity:{type:'cpf',value:'12345678909'},nsr:'000000001',precisionSeconds:1,rawTimestamp:'original',rawIdentifier:'original',original:{profile:'iso'}};
function fixture(conflict=false){
 const bytes=Buffer.from('new export, same historic NSR');const payloadHash=digest('canonical row');
 const punch=indexedImport(event,payloadHash,[]);const index={version:1 as const,sourceId:'clock',shard:0,punches:[punch]};
 const packed=packObject('old-index.gz',Buffer.from(JSON.stringify(index)));const object={...packed.object,kind:'nsr_index',metadata:indexMetadata(index)};
 const writes:Array<{object:StoredArchiveObject;raw:unknown}>=[];
 const rpc=vi.fn(async(action:string)=>action==='policy'?{active:true,maintenance:false,cutoff:'2026-07-21',eventFrom:'2026-07-20T03:00:00Z'}:action==='indices'?{objects:[object]}:action==='file'?{file:null}:{ok:true});
 const client={rpc,download:vi.fn().mockResolvedValue(packed.compressed),put:vi.fn(async(object:StoredArchiveObject,compressed:Buffer)=>{
  const raw=unpackObject(object,compressed).toString('utf8');writes.push({object,raw:object.kind==='original'?raw:JSON.parse(raw)});
 })} as unknown as ArchiveCloudStore;
 mocks.parse.mockReturnValue({sha256:digest(bytes),parserVersion:'test-parser',occurrences:[{event:conflict?{...event,timestamp:'2026-06-15T11:02:00Z'}:event,payloadHash:conflict?digest('changed'):payloadHash,line:1}]});
 return {client,bytes,writes,rpc,job:{source:{id:'clock',kind:'afd' as const,timeZone:'America/Sao_Paulo',afdProfile:'iso' as const},sha256:digest(bytes),byteLength:bytes.length,parserVersion:'test-parser'}};
}
describe('archive preparation before ingestion',()=>{
 it('preserves a new original without adding the same NSR to the historic index again',async()=>{
  const f=fixture();await ensureArchivedSnapshot(f.client,f.job,f.bytes);
  expect(f.writes.map(w=>w.object.kind)).toEqual(['original','manifest']);
  expect(f.rpc.mock.calls.map(([action])=>action)).toContain('register_file');
 });
 it('records a divergent old NSR as a conflict before registering the file',async()=>{
  const f=fixture(true);await ensureArchivedSnapshot(f.client,f.job,f.bytes);
  const index=f.writes.find(w=>w.object.kind==='nsr_index')!.raw as {punches:Array<{conflicted:boolean}>};
  expect(index.punches[0].conflicted).toBe(true);
  expect((f.writes.find(w=>w.object.kind==='manifest')!.raw as {conflictNsrs:string[]}).conflictNsrs).toEqual(['000000001']);
 });
});
