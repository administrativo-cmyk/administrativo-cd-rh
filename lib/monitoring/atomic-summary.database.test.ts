import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { snapshotSchema } from './contracts';

let db:PGlite;
const admin='cf310000-0000-4000-8000-000000000001';
const manager='cf310000-0000-4000-8000-000000000002';
const employee='cf320000-0000-4000-8000-000000000001';
const period={start:'2026-01-01',end:'2026-10-27',query:'SNAPSHOT'};
async function summary(data:Record<string,unknown>,actor=manager){
 await db.exec('begin;set role authenticated');
 try{
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);
  return snapshotSchema.parse((await db.query<{value:unknown}>("select public.monitoring_query('summary',$1::jsonb) value",[JSON.stringify({...period,...data})])).rows[0].value);
 }finally{await db.exec('rollback;reset role');}
}
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
  create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 for(const name of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(`supabase/migrations/${name}`,'utf8'));
 await db.exec(`insert into auth.users(id,email,raw_user_meta_data) select ('cf310000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  encode(sha256(convert_to('88555555'||lpad(n::text,3,'0'),'UTF8')),'hex')||'@auth.administrativo-cd.invalid',
  jsonb_build_object('nome_completo','Snapshot sintético '||n,'cpf_normalizado','88555555'||lpad(n::text,3,'0')) from generate_series(1,2)n;
  insert into public.gestores(id,nome) values('cf330000-0000-4000-8000-000000000001','Snapshot gestor');
  update public.perfis set status_usuario='APROVADO',aprovado_em=now(),
   papel_usuario=case when id='${admin}' then 'ADMIN'::public.papel_usuario else 'GESTOR'::public.papel_usuario end,
   gestor_id=case when id='${manager}' then 'cf330000-0000-4000-8000-000000000001'::uuid end where id in('${admin}','${manager}');
  insert into public.colaboradores(id,matricula,nome,unidade_id,gestor_id,admissao)
  select ('cf320000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'SNAPSHOT-'||n,'Snapshot pessoa '||n,
   (select id from public.unidades where codigo='CD I'),case when n<=2 then 'cf330000-0000-4000-8000-000000000001'::uuid end,'2026-01-01'
   from generate_series(1,3)n;
  insert into public.monitoring_results(employee_id,operational_date,input_version,rule_version,result,summary,reason)
  select c.id,d::date,1,'synthetic','{}','{"quality":"partial","workedSeconds":60,"outsideSeconds":0}','Synthetic snapshot'
   from public.colaboradores c cross join generate_series('2026-01-01'::date,'2026-10-27'::date,interval '1 day')d where c.matricula like 'SNAPSHOT-%';`);
},30000);
afterAll(async()=>{await db?.close();});
describe('snapshot SQL completo e autorizado',()=>{
 it('preserva páginas de 500 e permite snapshot completo sem truncar o escopo do gestor',async()=>{
  const page=await summary({limit:500});expect(page.rows).toHaveLength(500);expect(page.total).toBe(600);
  const full=await summary({completeSnapshot:true,limit:1,offset:500});
  expect(full.rows).toHaveLength(600);expect(full.total).toBe(600);expect(full.people).toBe(2);
  expect(full.totals.workedSeconds).toBe(36000);expect(new Set(full.rows.map(r=>r.employeeId+'|'+r.date)).size).toBe(600);
  expect(full.rows.every(r=>r.employeeNumber!=='SNAPSHOT-3')).toBe(true);
  expect((await summary({completeSnapshot:true},admin)).rows).toHaveLength(900);
 });
 it('mantém filtros, zero e pendências sem reaproveitar um snapshot anterior',async()=>{
  const one=await summary({completeSnapshot:true,employeeId:employee});expect(one.rows).toHaveLength(300);expect(one.totals.outsideSeconds).toBe(0);
  await db.query("update public.monitoring_results set dirty=true where employee_id=$1 and operational_date='2026-01-01'",[employee]);
  await db.exec('update private.monitoring_revision set results_version=results_version+1 where id=true');
  const next=await summary({completeSnapshot:true,employeeId:employee});expect(next.datasetVersion).not.toBe(one.datasetVersion);
  expect(next.rows).toHaveLength(300);expect(next.pending).toBe(1);expect(next.totals.workedSeconds).toBe(299*60);
  expect((await summary({completeSnapshot:true,employeeId:employee,quality:'stale'})).rows).toHaveLength(1);
 });
 it('continua recusando sessão ausente e acesso anônimo à RPC',async()=>{
  await expect(summary({completeSnapshot:true},'')).rejects.toThrow('MONITORING_FORBIDDEN');
  await db.exec('set role anon');
  try{await expect(db.query("select public.monitoring_query('summary',$1::jsonb)",[JSON.stringify({...period,completeSnapshot:true})])).rejects.toThrow('permission denied');}
  finally{await db.exec('reset role');}
 });
});
