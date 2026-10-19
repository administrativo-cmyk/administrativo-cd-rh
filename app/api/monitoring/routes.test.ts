import { beforeEach,describe,it,expect,vi } from 'vitest';
const mocks=vi.hoisted(()=>({getClaims:vi.fn(),single:vi.fn(),rpc:vi.fn(),serviceRpc:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getClaims:mocks.getClaims},from:()=>({select:()=>({eq:()=>({single:mocks.single})})}),rpc:mocks.rpc})}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({rpc:mocks.serviceRpc})}));
import { GET as summary } from './route';
import { GET as admin } from './admin/route';
import { GET as detail } from './detail/route';
import { GET as photo } from './photo/route';
import { POST as config } from './config/route';
import { POST as ingest } from './ingest/route';
import { POST as confirmDefense } from './defense-confirmation/route';
import { GET as groupChanges } from './group-changes/route';
const uuid='80000000-0000-0000-0000-000000000001';
const read=()=>new Request('http://localhost:3000/api/monitoring?start=2026-10-01&end=2026-10-31');
describe('monitoring HTTP authorization',()=>{
 beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('NODE_ENV','development');mocks.getClaims.mockResolvedValue({data:{claims:{sub:uuid}}});mocks.single.mockResolvedValue({data:{id:uuid,status_usuario:'APROVADO',papel_usuario:'ADMIN'}});mocks.rpc.mockResolvedValue({data:null,error:null});});
 it('rejects anonymous API and protected photos before reading database records',async()=>{
  mocks.getClaims.mockResolvedValue({data:null});expect((await summary(read())).status).toBe(401);expect((await photo(new Request(`http://localhost:3000/api/monitoring/photo?employeeId=${uuid}`))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();
  expect((await groupChanges(new Request('http://localhost:3000/api/monitoring/group-changes'))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it.each(['PENDENTE','BLOQUEADO'])('rejects %s approval state',async status=>{
  mocks.single.mockResolvedValue({data:{status_usuario:status,papel_usuario:'ADMIN'}});expect((await summary(read())).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it.each(['GESTOR','LEITURA'])('restricts administration for %s',async papel_usuario=>{
  mocks.single.mockResolvedValue({data:{status_usuario:'APROVADO',papel_usuario}});expect((await admin(new Request('http://localhost:3000/api/monitoring/admin'))).status).toBe(403);
  expect((await config(new Request('http://localhost:3000/api/monitoring/config',{method:'POST',headers:{origin:'http://localhost:3000'},body:'{}'}))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
  expect((await confirmDefense(new Request('http://localhost:3000/api/monitoring/defense-confirmation',{method:'POST',headers:{origin:'http://localhost:3000'},body:'{}'}))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
  expect((await groupChanges(new Request('http://localhost:3000/api/monitoring/group-changes'))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('requires same-site origin for session-authenticated writes',async()=>{
  expect((await config(new Request('http://localhost:3000/api/monitoring/config',{method:'POST',headers:{origin:'https://evil.invalid'},body:'{}'}))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('delegates UUID detail scope to authorized RPC and preserves database denial',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});mocks.rpc.mockResolvedValue({data:null,error:{code:'42501',message:'secret'}});
  const result=await detail(new Request(`http://localhost:3000/api/monitoring/detail?employeeId=${uuid}&start=2026-10-01&end=2026-10-31`));expect(result.status).toBe(403);expect(await result.text()).not.toContain('secret');log.mockRestore();
 });
 it('does not accept session cookies as a worker credential',async()=>{
  const result=await ingest(new Request('http://localhost:3000/api/monitoring/ingest',{method:'POST',body:'{}'}));expect(result.status).toBe(401);expect(mocks.serviceRpc).not.toHaveBeenCalled();
 });
 it('explains missing database installation without leaking backend details',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  mocks.rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'private SQL payload'}});
  const result=await summary(read());expect(result.status).toBe(503);
  const body=await result.json();expect(body.code).toBe('PGRST202');expect(body.error).toContain('ainda não está habilitado');expect(JSON.stringify(body)).not.toContain('private SQL payload');log.mockRestore();
 });
 it('rejects a valid worker token for a source outside its allowlist',async()=>{
  const token='unit-test-token-not-a-secret-0123456789';vi.stubEnv('MONITORING_INGEST_TOKEN',token);vi.stubEnv('MONITORING_INGEST_SOURCE_IDS','one');
  const result=await ingest(new Request('http://localhost:3000/api/monitoring/ingest',{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify({protocolVersion:1,heartbeat:{sourceId:'two',state:'idle'}})}));expect(result.status).toBe(403);expect(mocks.serviceRpc).not.toHaveBeenCalled();
 });
});
