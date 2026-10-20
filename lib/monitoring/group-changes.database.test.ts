import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFile,readdir } from "node:fs/promises";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { groupChangesSchema } from "./group-changes";
import { groupCatalogSchema } from "./group-catalog";

const admin="cb100000-0000-4000-8000-000000000001",employee="cb200000-0000-4000-8000-000000000001";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
let db:PGlite;
async function rpc(fn:string,args:unknown[],role="service_role",actor=""){
 await db.exec("savepoint group_rpc");await db.exec(`set role ${role}`);
 try{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);return (await db.query<{value:unknown}>(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)+(typeof args[i]==='object'?'::jsonb':'')).join(',')}) value`,args.map(v=>typeof v==='object'?JSON.stringify(v):v))).rows[0].value;}
 catch(e){await db.exec("rollback to savepoint group_rpc");throw e;}finally{await db.exec("reset role;release savepoint group_rpc");}
}
async function list(actor=admin,filters:Record<string,unknown>={}){return groupChangesSchema.parse(await rpc("monitoring_defense_group_changes",["list",filters],"authenticated",actor));}
async function catalog(actor=admin){return groupCatalogSchema.parse(await rpc("monitoring_query",["groups",{}],"authenticated",actor));}
async function filterCatalog(actor=admin){return groupCatalogSchema.parse(await rpc("monitoring_query",["filter_groups",{}],"authenticated",actor));}
const person=(groups:string[],id="123",name="Pessoa Sintética")=>({key:hash(id+name+groups.join(',')),line:Number(id),payloadHash:hash(JSON.stringify({id,groups,name})),person:{externalId:id,name,groups,photoReference:null,original:{id,name,groups:groups.join(',')}},original:{id,name,groups:groups.join(',')},issues:[]});
const access=(groups:string[],id="123",name="Pessoa Sintética")=>({key:hash(id+groups.join(',')),line:Number(id),payloadHash:hash(JSON.stringify({id,groups})),event:{key:"same-canonical-access",type:"access",identity:{type:"defense",value:id},timestamp:"2026-10-08T17:00:00-03:00",device:"Entrada",classification:"authorized",eligible:true,rawTimestamp:"08/10/2026 17:00",rawIdentifier:id,precisionSeconds:1,original:{name,groups:groups.join(',')}},original:{name,groups:groups.join(',')},issues:[]});
async function ingest(fileName:string,rows:ReturnType<typeof person>[]|ReturnType<typeof access>[],options:{kind?:"defense-person"|"defense-access";index?:number;total?:number;count?:number;sha?:string}={}){
 const kind=options.kind??"defense-person",source=kind==="defense-person"?"group-people":"group-access";
 return await rpc("monitoring_ingest",[{protocolVersion:1,source:{id:source,kind,timeZone:"America/Sao_Paulo",identityNamespace:"group-test"},
  file:{sha256:options.sha??hash(fileName),byteLength:100,parserVersion:"monitoring-import/1.0.0/"+kind,relativePath:fileName,issues:[],observedRange:null,metadata:{}},
  batch:{index:options.index??0,final:(options.index??0)===(options.total??1)-1,totalRows:options.count??rows.length,occurrenceCount:options.count??rows.length,totalBatches:options.total??1},occurrences:rows}]);
}
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
  create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec(`begin;
 insert into auth.users(id,email,raw_user_meta_data) select ('cb100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
  encode(sha256(convert_to('66555555'||lpad(i::text,3,'0'),'UTF8')),'hex')||'@auth.administrativo-cd.invalid',jsonb_build_object('nome_completo','Group fixture '||i,'cpf_normalizado','66555555'||lpad(i::text,3,'0')) from generate_series(1,4) i;
 update public.perfis set status_usuario='APROVADO',papel_usuario=case right(id::text,1) when '1' then 'ADMIN'::public.papel_usuario when '2' then 'RH'::public.papel_usuario when '3' then 'GESTOR'::public.papel_usuario else 'LEITURA'::public.papel_usuario end,aprovado_em=now() where id::text like 'cb100000-%';
 insert into public.colaboradores(id,matricula,nome,unidade_id,situacao,admissao) values('${employee}','123','Pessoa Sintética',(select id from public.unidades where codigo='CD I'),'ATIVO','2026-01-01');
 insert into public.monitoring_sources(id,kind,identity_namespace) values('group-people','defense-person','group-test'),('group-access','defense-access','group-test');
 insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by) values('group-people','defense','123','${employee}','2026-10-01','Vínculo sintético verificado','${admin}');`);});
afterEach(async()=>{await db.exec("rollback;reset role");});

describe("detecção automática dos grupos Defense",()=>{
 it("filtra grupos pelo escopo do gestor, sem liberar o catálogo administrativo",async()=>{
  const manager='cb100000-0000-4000-8000-000000000003',reader='cb100000-0000-4000-8000-000000000004';
  const other='cb200000-0000-4000-8000-000000000002';
  await db.exec(`insert into public.gestores(nome) values('Gestor do catálogo sintético');
   update public.perfis set gestor_id=(select id from public.gestores where nome='Gestor do catálogo sintético') where id='${manager}';
   update public.colaboradores set gestor_id=(select gestor_id from public.perfis where id='${manager}') where id='${employee}';
   insert into public.colaboradores(id,matricula,nome,unidade_id,situacao,admissao) values('${other}','124','Outra equipe',(select id from public.unidades where codigo='CD I'),'ATIVO','2026-01-01');
   insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by) values('group-people','defense','124','${other}','2026-10-01','Outro vínculo sintético','${admin}');`);
  await ingest('Person20261019160000.xlsx',[person(['Equipe permitida']),person(['Equipe restrita'],'124')]);
  await ingest('AccessRecords20261019170000.xlsx',[access(['Grupo novo no acesso'])],{kind:'defense-access'});
  expect((await filterCatalog(manager)).groups).toEqual(['EQUIPE PERMITIDA','GRUPO NOVO NO ACESSO']);
  expect((await filterCatalog(reader)).groups).toEqual(['EQUIPE PERMITIDA','EQUIPE RESTRITA','GRUPO NOVO NO ACESSO']);
  expect((await filterCatalog()).groups).toEqual((await catalog()).groups);
  await expect(catalog(manager)).rejects.toThrow('MONITORING_ADMIN_REQUIRED');
  await db.exec(`update public.perfis set gestor_id=null where id='${manager}'`);
  expect((await filterCatalog(manager)).groups).toEqual([]);
  await expect(filterCatalog('')).rejects.toThrow('MONITORING_FORBIDDEN');
 });
 it("lista grupos além da primeira página, normaliza nomes e inclui novos grupos somente após concluir",async()=>{
  const baseline=(await catalog()).groups;
  const settings=(await db.query('select count(*)::int n from public.monitoring_settings')).rows;
  await ingest('Person20261016160000.xlsx',Array.from({length:105},(_,i)=>person(i===104?['CD / Equipe Z']:[' equipe a ','EQUIPE A'],String(200+i),`Pessoa ${i}`)));
  expect((await catalog()).groups).toEqual([...baseline,'EQUIPE A','EQUIPE Z'].sort());
  const before=(await db.query('select version,results_version from private.monitoring_revision')).rows;
  await catalog('cb100000-0000-4000-8000-000000000002');
  expect((await db.query('select version,results_version from private.monitoring_revision')).rows).toEqual(before);
  await ingest('Person20261019160000.xlsx',[person(['Equipe Nova'])],{total:2,count:2});
  expect((await catalog()).groups).not.toContain('EQUIPE NOVA');
  await ingest('Person20261019160000.xlsx',[person(['Equipe Outra'],'124')],{index:1,total:2,count:2});
  expect((await catalog()).groups).toEqual([...baseline,'EQUIPE A','EQUIPE NOVA','EQUIPE OUTRA','EQUIPE Z'].sort());
  expect((await db.query('select count(*)::int n from public.monitoring_settings')).rows).toEqual(settings);
 });
 it("preserva grupos históricos e regras existentes sem depender de vínculos ou da página de pessoas",async()=>{
  await ingest('Person20261016160000.xlsx',[person(['Antigo'])]);
  await ingest('Person20261019160000.xlsx',[person(['Atual'])]);
  await ingest('AccessRecords20261019170000.xlsx',[access(['Só no acesso'])],{kind:'defense-access'});
  await db.exec(`insert into public.monitoring_settings(kind,target,valid_from,payload,reason) values
   ('policy','Grupo cadastrado','2026-10-01','{"scope":"group","indicator":"outsideOperation","exclude":true}','Regra sintética'),
   ('group_snapshot','${employee}','2026-10-01','{"groups":["Grupo histórico"],"evidence":"Conferido"}','Histórico sintético');`);
  expect((await catalog()).groups).toEqual(['ANTIGO','ATUAL','COZINHA JK','GRUPO CADASTRADO','GRUPO HISTORICO','LIDERANCA JK','SO NO ACESSO']);
  for(const suffix of ['3','4'])await expect(catalog('cb100000-0000-4000-8000-'+suffix.padStart(12,'0'))).rejects.toThrow('MONITORING_ADMIN_REQUIRED');
  await expect(rpc('monitoring_query',['groups',{}],'anon')).rejects.toThrow(/permission denied/);
  await expect(catalog('')).rejects.toThrow('MONITORING_ADMIN_REQUIRED');
  const rh='cb100000-0000-4000-8000-000000000002';
  await db.exec(`update public.perfis set status_usuario='BLOQUEADO',bloqueado_em=now(),bloqueado_por='${admin}' where id='${rh}'`);
  await expect(catalog(rh)).rejects.toThrow('MONITORING_ADMIN_REQUIRED');
 });
 it("detecta troca entre arquivos completos sem criar vigência nem identidade ambígua",async()=>{
  await ingest('Person20261016160000.xlsx',[person(['Equipe A'])]);expect((await list()).total).toBe(0);
  await ingest('Person20261019160000.xlsx',[person(['Equipe B'])]);const result=await list();expect(result.total).toBe(1);expect(result.rows[0]).toMatchObject({employee_id:employee,old_groups:['EQUIPE A'],new_groups:['EQUIPE B'],status:'pending',time_origin:'filename'});
  expect((await db.query("select groups,ambiguous from public.monitoring_people")).rows[0]).toEqual({groups:['EQUIPE B'],ambiguous:false});
  expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_settings where kind='group_snapshot'")).rows[0].n).toBe(0);
  await db.exec("update public.monitoring_sources set active=false where id='group-people'");expect((await list()).rows[0].new_groups).toEqual(['EQUIPE B']);
 });
 it("normaliza ordem, espaços, caixa e caminho; repetição não duplica notificação",async()=>{
  await ingest('Person20261016160000.xlsx',[person(['CD / Equipe A','Equipe B'])]);
  await ingest('Person20261017160000.xlsx',[person([' equipe b ','EQUIPE A'])]);expect((await list()).total).toBe(0);
  await ingest('Person20261018160000.xlsx',[person(['Equipe C'])]);const first=await list();
  await ingest('Person20261018160000.xlsx',[person(['Equipe C'])]);await ingest('Person20261019160000.xlsx',[person(['equipe c'])]);
  const next=await list();expect(next.total).toBe(1);expect(next.rows[0].key).toBe(first.rows[0].key);
 });
 it("arquivo antigo enviado depois não regride os grupos atuais",async()=>{
  await ingest('Person20261016160000.xlsx',[person(['A'])]);await ingest('Person20261019160000.xlsx',[person(['B'])]);await ingest('Person20261012160000.xlsx',[person(['C'])]);
  expect((await list()).rows[0]).toMatchObject({new_groups:['B'],file_name:'Person20261019160000.xlsx'});
  expect((await db.query<{groups:string[]}>("select groups from public.monitoring_people")).rows[0].groups).toEqual(['B']);
 });
 it("não confunde acentuação de cadastro e acessos com troca de grupo ou de pessoa",async()=>{
  await ingest('Person20261016160000.xlsx',[person(['6X1-8H JK CAFE-ALMOCO','LIDERANCA JK'],'123','JOAO DA CONCEICAO')]);
  await ingest('AccessRecords20261017160000.xlsx',[access(['Liderança JK','6X1-8H JK Café-Almoço'],'123','João da Conceição')],{kind:'defense-access'});
  expect((await list()).total).toBe(0);
  await ingest('Person20261019160000.xlsx',[person(['Lideranc\u0327a JK','6X1-8H JK Cafe\u0301-Almoc\u0327o'],'123','Joa\u0303o da Conceic\u0327a\u0303o')]);
  expect((await list()).total).toBe(0);
  expect((await db.query<{groups:string[]}>("select groups from public.monitoring_people")).rows[0].groups).toEqual(['6X1-8H JK CAFE-ALMOCO','LIDERANCA JK']);
  await ingest('Person20261019170000.xlsx',[person(['6X1-14H JK JANTA'],'123','JOAO DA CONCEICAO')]);
  expect((await list()).rows[0]).toMatchObject({status:'pending',new_groups:['6X1-14H JK JANTA']});
 });
 it("normaliza comparações anteriores sem alterar arquivos, datas ou evidência original",async()=>{
  await ingest('Person20261016160000.xlsx',[person(['CAFE'],'123','JOAO')]);
  await ingest('AccessRecords20261019160000.xlsx',[access(['CAFÉ'],'123','JOÃO')],{kind:'defense-access'});
  const before=await db.query('select * from private.monitoring_group_files order by file_id');
  const raw=await db.query('select payload from public.monitoring_occurrences order by payload::text');
  await db.exec(`update private.monitoring_group_observations set names='["JOÃO"]',variants='[["CAFÉ"],["CAFE"]]' where source_id='group-access';`);
  await db.exec(await readFile('supabase/migrations/20261019211123_monitoring_defense_group_spelling.sql','utf8'));
  expect((await list()).total).toBe(0);
  expect((await db.query('select * from private.monitoring_group_files order by file_id')).rows).toEqual(before.rows);
  expect((await db.query('select payload from public.monitoring_occurrences order by payload::text')).rows).toEqual(raw.rows);
 });
 it("não publica troca de arquivo parcial e mantém grupos anteriores até concluir",async()=>{
  await ingest('Person20261016160000.xlsx',[person(['A'])]);
  await ingest('Person20261019160000.xlsx',[person(['B'])],{total:2,count:2});expect((await list()).total).toBe(0);
  expect((await db.query<{groups:string[]}>("select groups from public.monitoring_people where external_id='123'")).rows[0].groups).toEqual(['A']);
  await ingest('Person20261019160000.xlsx',[person(['C'],'124')],{index:1,total:2,count:2});expect((await list()).rows[0].new_groups).toEqual(['B']);
 });
 it("detecta grupos no acesso mesmo se nenhum evento canônico novo foi criado",async()=>{
  await ingest('AccessRecords20261016160000.xlsx',[access(['A'])],{kind:'defense-access'});
  const second=await ingest('AccessRecords20261019160000.xlsx',[access(['B'])],{kind:'defense-access'}) as {newEvents:number};
  expect(second.newEvents).toBe(0);expect((await list()).rows[0]).toMatchObject({old_groups:['A'],new_groups:['B'],status:'pending'});
 });
 it("grupos diferentes no mesmo arquivo exigem conferência",async()=>{
  await ingest('Person20261016160000.xlsx',[person(['A'])]);const rows=[access(['B']),{...access(['C']),line:124}];await ingest('AccessRecords20261019160000.xlsx',rows,{kind:'defense-access'});
  expect((await list()).rows[0]).toMatchObject({status:'conflict',variants:[['B'],['C']]});
 });
 it("não associa pelo nome quando falta vínculo ou houve reuso do ID",async()=>{
  await ingest('Person20261016160000.xlsx',[person(['A'])]);await ingest('Person20261019160000.xlsx',[person(['B'])]);
  await db.exec('delete from public.monitoring_bindings');expect((await list()).rows[0]).toMatchObject({employee_id:null,status:'unlinked'});
  await ingest('Person20261019170000.xlsx',[person(['C'],'123','Outra Pessoa')]);expect((await list()).rows[0].status).toBe('conflict');
 });
 it("confirmação histórica resolve alerta sem apagar evidência; papéis inferiores não recebem dados",async()=>{
  await ingest('Person20261016160000.xlsx',[person(['A'])]);await ingest('Person20261019160000.xlsx',[person(['B'])]);const before=await list();
  const notices=await db.query<{key:string}>("select key from private.workspace_notifications($1,'ADMIN',null) where key like 'defense-group:%'",[admin]);expect(notices.rows).toHaveLength(1);
  expect((await db.query("select key from private.workspace_notifications($1,'GESTOR',null) where key like 'defense-group:%'",[admin])).rows).toHaveLength(0);
  await db.exec(`insert into public.monitoring_settings(kind,target,valid_from,payload,reason) values('group_snapshot','${employee}','2026-10-18','{"groups":["B"],"evidence":"Conferido"}','Conferência sintética');`);
  expect((await list()).total).toBe(0);const all=await list(admin,{includeConfirmed:true});expect(all.rows[0]).toMatchObject({key:before.rows[0].key,status:'confirmed'});
  for(const role of ['3','4'])await expect(list('cb100000-0000-4000-8000-'+role.padStart(12,'0'))).rejects.toThrow('DEFENSE_GROUP_FORBIDDEN');
  await expect(rpc('monitoring_defense_group_changes',['list',{}],'anon')).rejects.toThrow(/permission denied/);
 });
});
