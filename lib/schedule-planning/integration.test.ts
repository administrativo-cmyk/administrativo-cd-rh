import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { planningSnapshotSchema, suggestionResultSchema } from "./contracts";
import { reprocessMonitoringSnapshot } from "@/lib/monitoring/reprocess";
const admin = "db000000-0000-4000-8000-000000000001", manager = "db000000-0000-4000-8000-000000000002", reader = "db000000-0000-4000-8000-000000000003";
const team = "dc000000-0000-4000-8000-000000000001", person = "dd000000-0000-4000-8000-000000000001", person2 = "dd000000-0000-4000-8000-000000000002";
let db: PGlite;
async function guarded<T>(action: () => Promise<T>) { await db.exec("savepoint action_guard"); try { const result=await action(); await db.exec("release savepoint action_guard"); return result; } catch(error) { await db.exec("rollback to savepoint action_guard;release savepoint action_guard"); throw error; } }
async function rpc(action: string, data: unknown = {}) { return guarded(async () => (await db.query<{ value: unknown }>("select public.schedule_planning($1,$2::jsonb) value", [action, JSON.stringify(data)])).rows[0].value as Record<string, unknown>); }
async function administration(entity: string, action: string, data: unknown) { return guarded(async () => (await db.query<{ value: Record<string, unknown> }>("select public.administration($1,$2,$3::jsonb) value", [entity, action, JSON.stringify(data)])).rows[0].value); }
async function actor(id = admin) { await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','${id}',true);`); }
const schedule = { name: "Diurno teste", start: "08:00", end: "17:00", days: [0,1,2,3,4,5,6], allowNoBreak: false, pairing: "alternating", coffeeWindows: [] };
async function template() { return (await rpc("save", { kind: "template", name: "Modelo teste", scope: "global", target: null, validFrom: "2020-01-01", validTo: "2099-12-31", payload: schedule, reason: "Modelo sintético confirmado" })).record as Record<string, string>; }
async function calendar(working: boolean, model?: Record<string, string>, scope = "global", target: string | null = null) { return rpc("save", { kind: "calendar", name: "Calendário teste", scope, target, validFrom: "2026-10-01", validTo: "2026-10-01", payload: working ? { working, templateId: model!.id, expectedTemplateUpdatedAt: model!.updatedAt } : { working }, reason: "Exceção sintética confirmada" }); }
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
  for (const file of (await readdir(path.resolve("supabase/migrations"))).filter(file => file.endsWith(".sql")).sort()) {
    if (file.startsWith("20261018021801")) await db.exec(`insert into public.gestores(id,nome) values('${team}','Equipe sintética');insert into public.colaboradores(id,matricula,nome,unidade_id,gestor_id,setor,funcao,categoria,admissao) values('${person}','PLAN-A','Pessoa A',(select id from public.unidades limit 1),'${team}','Expedição',' Operador  CD ','Equipe','2020-01-01'),('${person2}','PLAN-B','Pessoa B',(select id from public.unidades limit 1),'${team}','  expedicao  ','operador cd','EQUIPE','2020-01-01');`);
    try { await db.exec(await readFile(path.join("supabase/migrations",file),"utf8")); } catch(error) { throw new Error(`${file}: ${(error as Error).message}`); }
  }
  await db.exec(`insert into auth.users(id,email,raw_user_meta_data) select x.id::uuid,encode(sha256(convert_to(x.cpf,'UTF8')),'hex')||'@auth.administrativo-cd.invalid',jsonb_build_object('nome_completo','Perfil sintético','cpf_normalizado',x.cpf) from (values('${admin}','88899900001'),('${manager}','88899900002'),('${reader}','88899900003'))x(id,cpf);update public.perfis set status_usuario='APROVADO',aprovado_em=now(),papel_usuario=case id when '${admin}'::uuid then 'ADMIN'::public.papel_usuario when '${manager}'::uuid then 'GESTOR'::public.papel_usuario else 'LEITURA'::public.papel_usuario end,gestor_id=case when id='${manager}' then '${team}'::uuid end where id in ('${admin}','${manager}','${reader}');`);
}, 60000);
beforeEach(async () => { await db.exec("begin"); await actor(); });
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db.close(); });
describe("catálogos e planejamento reais em banco isolado", () => {
  it("exceção de trabalho substitui F derivado da escala sem alterar chamada", async () => {
    await db.exec("reset role");
    await db.query("insert into public.monitoring_settings(kind,target,valid_from,payload,reason) values('schedule',$1,'2026-10-01',$2::jsonb,'Folga sintética confirmada')", [person, JSON.stringify({ ...schedule, days: [] })]);
    await actor();
    const read = async () => (await db.query<{ value: { employees: Array<{ id: string; attendance: Array<{ status: string; origin: string }> }> } }>("select public.daily_call_read('2026-10-01','2026-10-01','2026-10-01') value")).rows[0].value.employees.find(row => row.id === person)!.attendance;
    expect(await read()).toMatchObject([{ status: "F", origin: "schedule" }]);
    await calendar(true, await template());
    expect(await read()).toEqual([]);
  });
  it("migra grafias equivalentes uma vez e preserva os valores originais", async () => {
    await db.exec("reset role");
    const result = (await db.query<{ catalogs: number; aliases: number; original: string; ids: number }>(`select (select count(*)::int from private.canonical_catalog where kind='department') catalogs,(select count(*)::int from private.canonical_catalog_alias where kind='department') aliases,(select department from private.employee_catalog_legacy where employee_id='${person2}') original,(select count(distinct department_catalog_id)::int from public.colaboradores where id in ('${person}','${person2}')) ids`)).rows[0];
    expect(result).toEqual({ catalogs: 1, aliases: 2, original: "  expedicao  ", ids: 1 });
  });
  it("aplica CAS, evita duplicidade por acento e protege catálogo referenciado", async () => {
    const row = (await administration("department","list",{})).rows as Array<Record<string,string>>;
    await expect(administration("department","save",{ name:"EXPEDICAO",reason:"Duplicidade teste" })).rejects.toThrow("DUPLICATE");
    await expect(administration("department","save",{ name:"Expedic\u0327a\u0303o",reason:"Unicode equivalente" })).rejects.toThrow("DUPLICATE");
    await expect(administration("department","archive",{id:row[0].id,expectedUpdatedAt:row[0].updatedAt,reason:"Arquivar teste"})).rejects.toThrow("REFERENCED");
    const updated = (await administration("department","save",{id:row[0].id,expectedUpdatedAt:row[0].updatedAt,name:"Expedição central",reason:"Renomear teste"})).record as Record<string,string>;
    expect(updated.name).toBe("Expedição central");
    await expect(administration("department","save",{id:row[0].id,expectedUpdatedAt:row[0].updatedAt,name:"Stale",reason:"Versão teste"})).rejects.toThrow("STALE");
  });
  it("nega mutações a leitura/gestor e bloqueia acesso bruto e anônimo", async () => {
    await actor(reader); await expect(template()).rejects.toThrow("FORBIDDEN");
    await actor(manager); await expect(template()).rejects.toThrow("FORBIDDEN");
    const privileges=(await db.query<{raw:boolean;anon:boolean}>("select has_table_privilege('authenticated','private.planning_configurations','select') raw,has_function_privilege('anon','public.schedule_planning(text,jsonb)','execute') anon")).rows[0];
    expect(privileges).toEqual({raw:false,anon:false});
  });
  it("atribui modelo em lote atômico e rejeita concorrência/overlap", async () => {
    const model=await template();const snapshot=planningSnapshotSchema.parse(await rpc("list"));
    const data={templateId:model.id,expectedTemplateUpdatedAt:model.updatedAt,employeeIds:[person,person2],expectedRosterVersion:snapshot.rosterVersion,validFrom:"2026-10-01",validTo:"2026-10-31",reason:"Atribuição teste"};
    expect((await rpc("assign",data)).assigned).toBe(2);
    await expect(rpc("assign",{...data,expectedRosterVersion:"stale"})).rejects.toThrow("STALE");
    await expect(rpc("assign",data)).rejects.toThrow("VALIDITY_CONFLICT");
  });
  it("feriado retira falta automática, preserva manual e chega ao motor", async () => {
    await calendar(false);
    await db.exec(`reset role;select set_config('request.jwt.claim.sub','',true);insert into public.chamada_diaria(colaborador_id,data,status,origin) values('${person}','2026-10-01','I','automatic_absence'),('${person2}','2026-10-01','I','manual');`);
    for(const employeeId of [person,person2]) await db.query("select private.daily_call_apply_import_impl(jsonb_build_object('employeeId',$1::text,'date','2026-10-01','inputVersion',(select version from private.monitoring_revision where id=true)))",[employeeId]);
    expect((await db.query("select origin from public.chamada_diaria where data='2026-10-01' order by colaborador_id")).rows).toEqual([{origin:"manual"}]);
    const raw=(await db.query<{value:unknown}>("select private.monitoring_input($1::uuid,'2026-10-01','2026-10-01') value",[person])).rows[0].value;
    const result=reprocessMonitoringSnapshot(raw,{employeeId:person,start:"2026-10-01",end:"2026-10-01",reason:"Teste integração calendário"},Date.parse("2026-10-05T00:00:00Z"))[0];
    expect(result.summary.late).toBeNull();expect(result.result.issues.some(issue=>issue.code==="CALENDAR_NON_WORKING_DAY")).toBe(true);
  });
  it("exceção pessoal trabalhada vence feriado geral com escala realmente usada", async () => {
    const model=await template();await calendar(false);await calendar(true,model,"person",person);
    await db.exec("reset role");
    const resolution=(await db.query<{value:Record<string,unknown>}>("select private.daily_call_evidence($1::uuid,'2026-10-01') value",[person])).rows[0].value;
    expect(resolution.expected).toBe(true);expect(resolution.state).not.toBe("automatic_absence");
    expect((resolution.calendar as {state:string}).state).toBe("work");
    expect((await db.query<{n:number}>("select count(*)::int n from private.schedule_window_rows($1::uuid,'2026-10-01','2026-10-01')",[person])).rows[0].n).toBe(1);
  });
  it("sugere conforme capacidade configurada e aceitar cria só rascunho com CAS", async () => {
    const policy=(await rpc("save",{kind:"vacation_policy",name:"Política teste",scope:"global",target:null,validFrom:"2020-01-01",validTo:"2099-12-31",reason:"Critérios RH teste",payload:{minimumTenureDays:365,durationDays:5,noticeDays:0,maximumAbsentPercent:50,minimumAvailable:1,includeRequested:true}})).record as Record<string,string>;
    const input={employeeId:person,policyId:policy.id,start:"2090-01-01",end:"2090-01-10"};
    const result=suggestionResultSchema.parse(await rpc("suggest",input));expect(result.suggestions.length).toBeGreaterThan(0);expect(result.suggestions[0].minimumOutsidePlannedVacation).toBe(1);
    await actor(manager);
    const accepted=await rpc("accept_suggestion",{...input,expectedVersion:result.version,selectedStart:result.suggestions[0].startDate,reason:"Aceite de sugestão teste"});
    expect((accepted.record as {status:string}).status).toBe("draft");
    await expect(rpc("accept_suggestion",{...input,expectedVersion:result.version,selectedStart:result.suggestions[0].startDate,reason:"Repetição de sugestão"})).rejects.toThrow("STALE");
  });
  it("lote reverte primeira pessoa quando a segunda já possui escala",async()=>{
    const model=await template();const snapshot=planningSnapshotSchema.parse(await rpc("list"));
    const input={templateId:model.id,expectedTemplateUpdatedAt:model.updatedAt,expectedRosterVersion:snapshot.rosterVersion,validFrom:"2026-10-01",validTo:"2026-10-31",reason:"Lote atômico teste"};
    await rpc("assign",{...input,employeeIds:[person2]});
    await expect(rpc("assign",{...input,employeeIds:[person,person2]})).rejects.toThrow("VALIDITY_CONFLICT");
    await db.exec("reset role");
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_settings where kind='schedule' and target=$1",[person])).rows[0].n).toBe(0);
  });
  it("calendário valida período do modelo e bloqueia restauração sobreposta",async()=>{
    const model=(await rpc("save",{kind:"template",name:"Restrito",scope:"global",target:null,validFrom:"2026-11-01",validTo:"2026-11-30",payload:schedule,reason:"Vigência teste"})).record as Record<string,string>;
    await expect(calendar(true,model)).rejects.toThrow("INVALID_INPUT");
    const old=(await calendar(false)).record as Record<string,string>;
    const archived=(await rpc("archive",{id:old.id,expectedUpdatedAt:old.updatedAt,reason:"Arquivar teste"})).record as Record<string,string>;
    await calendar(false);
    await expect(rpc("restore",{id:old.id,expectedUpdatedAt:archived.updatedAt,reason:"Restaurar teste"})).rejects.toThrow("VALIDITY_CONFLICT");
  });
  it("pessoa transferida não recebe dois calendários na mesma prioridade",async()=>{
    await calendar(false,undefined,"manager",team);
    await db.exec(`reset role;insert into public.gestores(id,nome) values('dc000000-0000-4000-8000-000000000002','Equipe nova');update public.colaboradores set gestor_id='dc000000-0000-4000-8000-000000000002' where id='${person}';`);
    await actor();
    await expect(calendar(false,undefined,"manager","dc000000-0000-4000-8000-000000000002")).rejects.toThrow("VALIDITY_CONFLICT");
  });
  it.each([null,"5",1.5])("RPC direta rejeita duração de política inválida %j",async durationDays=>{
    await expect(rpc("save",{kind:"vacation_policy",name:"Inválida",scope:"global",target:null,validFrom:"2020-01-01",validTo:null,reason:"Política teste",payload:{minimumTenureDays:365,durationDays,noticeDays:0,maximumAbsentPercent:50,minimumAvailable:1,includeRequested:true}})).rejects.toThrow("INVALID_INPUT");
  });
  it("gestor cancela proposta própria e não aprova nem consulta outra equipe",async()=>{
    await actor(manager);
    const row=(await administration("vacation","save",{employeeId:person,startDate:"2090-01-01",endDate:"2090-01-05",status:"requested",reason:"Proposta própria"})).record as Record<string,string>;
    await expect(administration("vacation","save",{id:row.id,expectedUpdatedAt:row.updatedAt,employeeId:person,startDate:"2090-01-01",endDate:"2090-01-05",status:"approved",reason:"Aprovação teste"})).rejects.toThrow("VACATION_LOCKED");
    const cancelled=(await administration("vacation","save",{id:row.id,expectedUpdatedAt:row.updatedAt,employeeId:person,startDate:"2090-01-01",endDate:"2090-01-05",status:"cancelled",reason:"Cancelamento próprio"})).record as Record<string,string>;
    expect(cancelled.status).toBe("cancelled");
    await actor();
    const policy=(await rpc("save",{kind:"vacation_policy",name:"Critério",scope:"global",target:null,validFrom:"2020-01-01",validTo:null,reason:"Política teste",payload:{minimumTenureDays:365,durationDays:5,noticeDays:0,maximumAbsentPercent:50,minimumAvailable:1,includeRequested:true}})).record as Record<string,string>;
    await db.exec(`reset role;update public.colaboradores set gestor_id=null where id='${person2}';`);await actor(manager);
    await expect(rpc("suggest",{employeeId:person2,policyId:policy.id,start:"2090-01-01",end:"2090-01-10"})).rejects.toThrow("FORBIDDEN");
    const snapshot=planningSnapshotSchema.parse(await rpc("list"));expect(snapshot.options.employees.map(row=>row.id)).toEqual([person]);
  });
  it("solicitação concorrente consome capacidade e invalida sugestão consultada",async()=>{
    const policy=(await rpc("save",{kind:"vacation_policy",name:"Critério",scope:"global",target:null,validFrom:"2020-01-01",validTo:null,reason:"Política teste",payload:{minimumTenureDays:365,durationDays:5,noticeDays:0,maximumAbsentPercent:50,minimumAvailable:1,includeRequested:true}})).record as Record<string,string>;
    const input={employeeId:person,policyId:policy.id,start:"2090-01-01",end:"2090-01-05"};
    const old=suggestionResultSchema.parse(await rpc("suggest",input));expect(old.suggestions).toHaveLength(1);
    await administration("vacation","save",{employeeId:person2,startDate:"2090-01-01",endDate:"2090-01-05",status:"requested",reason:"Reserva capacidade"});
    await expect(rpc("accept_suggestion",{...input,expectedVersion:old.version,selectedStart:"2090-01-01",reason:"Sugestão obsoleta"})).rejects.toThrow("STALE");
    const current=suggestionResultSchema.parse(await rpc("suggest",input));expect(current.suggestions).toEqual([]);expect(current.blockers).toContain("NO_WINDOW_MATCHES_POLICY");
    await db.exec("reset role");expect((await db.query<{n:number}>("select count(*)::int n from public.chamada_diaria")).rows[0].n).toBe(0);
  });
  it("cobertura posterior enfileira exceção trabalhada sem escala regular",async()=>{
    const model=await template();await calendar(true,model,"person",person);
    await db.exec(`reset role;insert into public.monitoring_sources(id,kind,timezone,identity_namespace,configuration) values('calendar-afd','afd','America/Sao_Paulo','calendar-afd','{"sourceIdentityConfirmed":true,"declaredCoverage":{"from":"2026-10-01T00:00:00-03:00","to":"2026-10-01T23:59:59-03:00","continuous":true}}');insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by) values('calendar-afd','cpf','12345678909','${person}','2020-01-01','Vínculo sintético','${admin}');delete from public.monitoring_jobs where employee_id='${person}';`);
    await db.query("select private.monitoring_enqueue($1::uuid,'2026-10-01','2026-10-01','calendar-afd')",[person]);
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_jobs where employee_id=$1::uuid and operational_date='2026-10-01'",[person])).rows[0].n).toBe(1);
    await db.exec(`delete from public.monitoring_jobs where employee_id='${person}'`);
    await db.query("select private.monitoring_prepare_identity($1::uuid,'calendar-afd','cpf','12345678909','2020-01-01',null)",[person]);
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_jobs where employee_id=$1::uuid and operational_date='2026-10-01'",[person])).rows[0].n).toBe(1);
  });
  it("calendário invalida também fronteiras vizinhas nas vigências nova e antiga",async()=>{
    await db.exec(`reset role;insert into public.monitoring_results(employee_id,operational_date,input_version,rule_version,result,summary,reason) select '${person}',d::date,1,'fixture','{}','{}','Resultado sintético' from generate_series('2026-09-30'::date,'2026-10-04'::date,interval '1 day')d;`);await actor();
    const row=(await calendar(false)).record as Record<string,string>;
    await db.exec("reset role");expect((await db.query<{dates:string[]}>("select array_agg(operational_date::text order by operational_date) dates from public.monitoring_results where employee_id=$1::uuid and dirty",[person])).rows[0].dates).toEqual(["2026-09-30","2026-10-01","2026-10-02"]);
    await db.exec(`delete from public.monitoring_jobs where employee_id='${person}';update public.monitoring_results set dirty=false where employee_id='${person}'`);await actor();
    await rpc("save",{kind:"calendar",id:row.id,expectedUpdatedAt:row.updatedAt,name:"Data corrigida",scope:"global",target:null,validFrom:"2026-10-03",validTo:"2026-10-03",payload:{working:false},reason:"Corrigir data teste"});await db.exec("reset role");
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_jobs where employee_id=$1::uuid",[person])).rows[0].n).toBe(5);expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_results where employee_id=$1::uuid and dirty",[person])).rows[0].n).toBe(5);
  });
  it("catálogo arquivado não pode voltar por alias antigo ou importação direta",async()=>{
    const first=(await administration("department","save",{name:"Setor antigo",reason:"Cadastro teste"})).record as Record<string,string>;
    const renamed=(await administration("department","save",{id:first.id,expectedUpdatedAt:first.updatedAt,name:"Setor novo",reason:"Renomear teste"})).record as Record<string,string>;
    const archived=(await administration("department","archive",{id:first.id,expectedUpdatedAt:renamed.updatedAt,reason:"Arquivar teste"})).record as Record<string,string>;
    const employee=((await administration("employee","list",{employeeId:person})).rows as Array<Record<string,unknown>>)[0];
    await expect(administration("employee","save",{...employee,id:person,expectedUpdatedAt:employee.updatedAt,department:" SETOR ANTIGO ",reason:"Alias arquivado"})).rejects.toThrow("INACTIVE_REFERENCE");
    await db.exec("reset role");await expect(guarded(()=>db.query("update public.colaboradores set setor='Setor antigo' where id=$1::uuid",[person]))).rejects.toThrow("INACTIVE_REFERENCE");await actor();
    const restored=(await administration("department","restore",{id:first.id,expectedUpdatedAt:archived.updatedAt,reason:"Restaurar teste"})).record as Record<string,string>;
    expect(restored.active).toBe(true);
  });
  it.each([{validTo:null,offUntil:"2026-10-01"},{validTo:"2026-09-30",offUntil:"2026-10-01"},{validTo:"2026-09-30",offUntil:"2026-10-02"}])("feriado não duplica saída noturna: %j",async ({validTo,offUntil})=>{
    await db.exec("reset role");
    const overnight={...schedule,start:"22:00",end:"06:00",allowNoBreak:true};
    await db.query("insert into public.monitoring_settings(kind,target,valid_from,valid_to,payload,reason,created_by) values('schedule',$1,'2026-09-01',$2::date,$3::jsonb,'Noturno sintético',$4::uuid)",[person,validTo,JSON.stringify(overnight),admin]);
    await db.query("insert into public.monitoring_settings(kind,target,valid_from,payload,reason,created_by) values('evidence',$1,'2026-09-01','{\"startConfirmed\":true,\"endConfirmed\":true,\"startCoverageConfirmed\":false}','Evidência sintética',$2::uuid)",[person,admin]);
    await db.exec(`insert into public.monitoring_sources(id,kind,timezone,identity_namespace,configuration) values('night-clock','afd','America/Sao_Paulo','night-clock','{"sourceIdentityConfirmed":true}');insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by) values('night-clock','cpf','12345678909','${person}','2020-01-01','Vínculo sintético','${admin}');`);
    for(const [index,timestamp] of ["2026-09-30T22:00:00-03:00","2026-10-01T06:00:00-03:00",...(offUntil==="2026-10-02"?["2026-10-01T22:00:00-03:00","2026-10-02T06:00:00-03:00"]:[])].entries()){
      const payload={key:`night-${index}`,type:"punch",timestamp,device:"clock",classification:"authorized",eligible:true,precisionSeconds:1,identity:{type:"cpf",value:"12345678909"},original:{}};
      await db.query("insert into public.monitoring_events(source_id,event_key,payload_hash,event_type,identity_type,identity_value,occurred_at,device,classification,eligible,payload,nsr) values('night-clock',$1,repeat('a',64),'punch','cpf','12345678909',$2::timestamptz,'clock','authorized',true,$3::jsonb,$4)",[payload.key,timestamp,JSON.stringify(payload),String(index).padStart(9,"0")]);
    }
    await actor();await rpc("save",{kind:"calendar",name:"Feriado noturno",scope:"global",target:null,validFrom:"2026-10-01",validTo:offUntil,payload:{working:false},reason:"Exceção noturna"});await db.exec("reset role");
    const evidence=(await db.query<{day:string;value:{state:string;status:string|null;punchIds:string[]}}>("select d::date::text as operational_day,private.daily_call_evidence($1::uuid,d::date)value from generate_series('2026-09-30'::date,'2026-10-01'::date,interval '1 day')d",[person])).rows;
    expect(evidence[0].value).toMatchObject({state:"present",status:"P"});expect(evidence[0].value.punchIds).toHaveLength(2);if(offUntil==="2026-10-01")expect(evidence[1].value).toMatchObject({state:"not_expected",status:null,punchIds:[]});else{expect(evidence[1].value).toMatchObject({state:"present",status:"P",expected:false});expect(evidence[1].value.punchIds).toHaveLength(2);const next=(await db.query<{value:unknown}>("select private.daily_call_evidence($1::uuid,'2026-10-02')value",[person])).rows[0].value;expect(next).toMatchObject({state:"not_expected",status:null,punchIds:[]});}
    const input=(await db.query<{value:unknown}>("select private.monitoring_input($1::uuid,'2026-09-30','2026-10-01')value",[person])).rows[0].value;
    const result=reprocessMonitoringSnapshot(input,{employeeId:person,start:"2026-09-30",end:"2026-10-01",reason:"Noturno com feriado"},Date.parse("2026-10-05T00:00:00Z"));
    expect(result[0].summary.workedSeconds).toBe(8*3600);expect(result[0].result.journey.retainedPunchIds).toHaveLength(2);if(offUntil==="2026-10-01")expect(result[1].result.journey.retainedPunchIds).toHaveLength(0);expect(result[1].summary.late).toBeNull();
  });
  it("renomear calendário não reescreve histórico de membros da equipe",async()=>{
    const row=(await calendar(false,undefined,"manager",team)).record as Record<string,string>;
    await db.exec(`reset role;update public.colaboradores set gestor_id=null where id='${person}'`);await actor();
    const renamed=await rpc("save",{id:row.id,expectedUpdatedAt:row.updatedAt,kind:"calendar",name:"Nome corrigido",scope:"manager",target:team,validFrom:"2026-10-01",validTo:"2026-10-01",payload:{working:false},reason:"Correção apenas textual"});
    expect((renamed.record as {memberCount:number}).memberCount).toBe(2);await db.exec("reset role");expect((await db.query<{state:string}>("select private.calendar_resolution($1::uuid,'2026-10-01')->>'state' state",[person])).rows[0].state).toBe("off");
  });
  async function employeeSchedule(action: string, data: unknown) { return guarded(async () => (await db.query<{ value: Record<string,unknown> }>("select public.employee_schedule($1,$2::jsonb) value", [action,JSON.stringify(data)])).rows[0].value); }
  const defaultPayload = {name:"Padrão conferido",start:"08:00",end:"18:00",days:[1,2,3,4,5],lunchMinutes:60,weeklyRosterConfirmed:true,estimated:false,allowNoBreak:false,pairing:"alternating",coffeeWindows:[]};
  async function saveDefault(who=person,from="2026-10-01",payload:Record<string,unknown>=defaultPayload) {
    const current=await employeeSchedule("get",{employeeId:who,date:from});
    return employeeSchedule("save",{employeeId:who,date:from,validFrom:from,expectedVersion:current.version,payload,reason:"Alteração sintética do horário"});
  }
  async function completeNightClock() {
    await db.exec("reset role");
    await db.query("insert into public.monitoring_sources(id,kind,identity_namespace,configuration,last_success_at) select id,'afd','night-fixture',jsonb_build_object('sourceIdentityConfirmed',true,'declaredCoverage',jsonb_build_object('from','2026-10-01T00:00:00-03:00','to','2026-10-23T00:00:00-03:00','continuous',true)),'2026-10-22T12:00:00Z' from (values('night-a'),('night-b')) x(id)");
    await db.exec("insert into public.monitoring_files(source_id,sha256,byte_length,relative_path,parser_version,status,expected_rows,expected_batches,metadata,completed_at) select id,repeat('a',64),1,'clock.txt','fixture','complete',0,1,'{}','2026-10-22T12:00:00Z' from public.monitoring_sources where id in ('night-a','night-b')");
    await db.query("insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by) values('night-a','cpf','12345678909',$1::uuid,'2026-10-01','Vínculo sintético confirmado',$2::uuid)",[person,admin]);
  }
  async function clockMark(at:string) {
    const payload={key:at,type:"punch",timestamp:at,device:"rep",classification:"authorized",eligible:true,precisionSeconds:1,identity:{type:"cpf",value:"12345678909"},original:{}};
    await db.query("insert into public.monitoring_events(source_id,event_key,payload_hash,event_type,identity_type,identity_value,occurred_at,classification,eligible,nsr,payload) values('night-a',$1,repeat('b',64),'punch','cpf','12345678909',($1::text)::timestamptz,'authorized',true,lpad(((select count(*) from public.monitoring_events)+1)::text,9,'0'),$2::jsonb)",[at,JSON.stringify(payload)]);
  }
  async function sundayAnchor(reference="2026-10-23T12:00:00-03:00",until="2026-10-23") {
    return (await db.query<{value:string|null}>("select private.night_sunday_absence_anchor($1::uuid,'22:00','06:20','2026-10-01',$2::date,$3::timestamptz)::text value",[person,until,reference])).rows[0].value;
  }
  it("encarregado altera própria equipe e notifica exclusivamente ADMIN/RH, com auditoria",async()=>{
    await actor(manager);const result=await saveDefault();expect(result.canEdit).toBe(true);
    await db.exec("reset role");
    const notices=(await db.query<{role:string;body:string}>("select audience_role::text role,body from private.workspace_notices order by audience_role")).rows;
    expect(notices.map(n=>n.role).sort()).toEqual(["ADMIN","RH"]);expect(notices.every(n=>n.body.includes("08:00–18:00")&&n.body.includes("Alteração sintética"))).toBe(true);
    expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_audit where action='employee_default_schedule'")).rows[0].n).toBe(1);
    expect((await db.query<{n:number}>("select count(*)::int n from private.workspace_notifications($1,'GESTOR',$2) where key like 'notice:%'",[manager,team])).rows[0].n).toBe(0);
  });
  it("nega outra equipe e leitura; transferência invalida versão, replay não duplica aviso",async()=>{
    await actor(manager);const current=await employeeSchedule("get",{employeeId:person,date:"2026-10-01"});
    const input={employeeId:person,date:"2026-10-01",validFrom:"2026-10-01",expectedVersion:current.version,payload:defaultPayload,reason:"Alteração sintética do horário"};
    await employeeSchedule("save",input);await expect(employeeSchedule("save",input)).rejects.toThrow("STALE");
    await db.exec(`reset role;update public.colaboradores set gestor_id=null where id='${person2}'`);await actor(manager);
    await expect(employeeSchedule("get",{employeeId:person2,date:"2026-10-01"})).rejects.toThrow("FORBIDDEN");
    await actor(reader);const read=await employeeSchedule("get",{employeeId:person,date:"2026-10-01"});expect(read.canEdit).toBe(false);await expect(saveDefault()).rejects.toThrow("FORBIDDEN");
    await db.exec("reset role");expect((await db.query<{n:number}>("select count(*)::int n from private.workspace_notices")).rows[0].n).toBe(2);
  });
  it("mudança com vigência preserva horário anterior e marca resultados para reapurar",async()=>{
    await saveDefault();await saveDefault(person,"2026-10-08",{...defaultPayload,start:"09:00",end:"19:00"});
    const old=await employeeSchedule("get",{employeeId:person,date:"2026-10-07"});const next=await employeeSchedule("get",{employeeId:person,date:"2026-10-08"});
    expect((old.setting as {payload:typeof defaultPayload}).payload.start).toBe("08:00");expect((next.setting as {payload:typeof defaultPayload}).payload.start).toBe("09:00");
    await db.exec("reset role");expect((await db.query<{n:number}>("select count(*)::int n from public.monitoring_settings where kind='schedule' and target=$1 and revoked_at is null",[person])).rows[0].n).toBe(2);
  });
  it("12x36 materializa plantão/folga e mantém SQL e motor no mesmo ciclo",async()=>{
    await saveDefault(person,"2026-10-01",{...defaultPayload,start:"19:00",end:"07:00",days:[0,1,2,3,4,5,6],cycle:{kind:"12x36",anchorDate:"2026-10-01"}} as typeof defaultPayload);
    await db.exec("reset role");
    const evidence=(await db.query<{date:string;expected:boolean}>("select d::date::text date,(private.daily_call_evidence($1::uuid,d::date)->>'expected')::boolean expected from generate_series('2026-10-01'::date,'2026-10-03'::date,interval '1 day') d",[person])).rows;
    expect(evidence.map(e=>e.expected)).toEqual([true,false,true]);
    const snapshot=(await db.query<{value:{settings:Array<{kind:string;valid_from:string;payload:{days:number[]}}>}}>("select private.monitoring_input($1::uuid,'2026-10-01','2026-10-03') value",[person])).rows[0].value;
    expect(snapshot.settings.filter(s=>s.kind==='schedule'&&s.valid_from==='2026-10-02')[0].payload.days).toEqual([]);
    expect(()=>reprocessMonitoringSnapshot(snapshot,{employeeId:person,start:"2026-10-01",end:"2026-10-03",reason:"Ciclo 12x36 real"},Date.parse("2026-10-19T00:00:00Z"))).not.toThrow();
  });
  it("valida almoço e ciclo também no RPC, sem depender da tela",async()=>{
    await expect(saveDefault(person,"2026-10-01",{...defaultPayload,lunchMinutes:0})).rejects.toThrow("INVALID");
    await expect(saveDefault(person,"2026-10-01",{...defaultPayload,weeklyRosterConfirmed:false,cycle:{kind:"12x36",anchorDate:"2026-10-01"}} as typeof defaultPayload)).rejects.toThrow("INVALID");
    await actor();await saveDefault();await db.exec("reset role");expect((await db.query<{n:number}>("select count(*)::int n from private.workspace_notices")).rows[0].n).toBe(0);
  });

  it("noturno exige perfil confirmado e alterna domingos femininos a cada 14 dias",async()=>{
    const payload={...defaultPayload,start:"22:00",end:"06:20",days:[0,1,2,3,4,5]};
    await saveDefault(person,"2026-10-01",payload);
    await db.exec("reset role");
    const check=async(d:string)=>(await db.query<{value:Record<string,unknown>}>("select private.daily_call_evidence($1::uuid,$2::date) value",[person,d])).rows[0].value;
    expect(await check("2026-10-03")).toMatchObject({expected:false,state:"not_expected"});
    expect((await check("2026-10-04")).blockers).toContain("WEEKLY_ROSTER_UNCONFIRMED");
    const raw=(await db.query<{value:unknown}>("select private.monitoring_input($1::uuid,'2026-10-03','2026-10-04') value",[person])).rows[0].value;
    expect(()=>reprocessMonitoringSnapshot(raw,{employeeId:person,start:"2026-10-03",end:"2026-10-04",reason:"Domingo pendente de perfil"},Date.parse("2026-10-19T00:00:00Z"))).not.toThrow();
    await completeNightClock();await db.query("update public.colaboradores set genero='feminino' where id=$1::uuid",[person]);
    await actor();await saveDefault(person,"2026-10-01",{...payload,weeklyRest:{kind:"night-women"}});await db.exec("reset role");
    for(const date of ["2026-10-04","2026-10-18"]) expect(await check(date)).toMatchObject({expected:false,state:"not_expected"});
    expect((await db.query<{p:{days:number[]}}>("select payload p from private.schedule_window_rows($1::uuid,'2026-11-01','2026-11-01')",[person])).rows[0].p.days).toEqual([]);
    for(const date of ["2026-10-11","2026-10-25"]) expect((await check(date)).blockers).not.toContain("WEEKLY_ROSTER_UNCONFIRMED");
    await db.query("update public.colaboradores set genero='masculino' where id=$1::uuid",[person]);
    await actor();await saveDefault(person,"2026-10-01",{...payload,weeklyRest:{kind:"night"}});await db.exec("reset role");
    expect((await check("2026-10-04")).blockers).not.toContain("WEEKLY_ROSTER_UNCONFIRMED");
  });

  it("referência automática usa data da jornada e não uma saída da madrugada de domingo",async()=>{
    await completeNightClock();
    await clockMark("2026-10-03T22:00:00-03:00");await clockMark("2026-10-04T06:20:00-03:00");
    expect(await sundayAnchor()).toBe("2026-10-04");
    expect(await sundayAnchor("2026-10-04T23:00:00-03:00","2026-10-04")).toBeNull();
    await clockMark("2026-10-04T22:03:00-03:00");
    expect(await sundayAnchor()).toBe("2026-10-11");
  });
  it.each(["partial","source-error","conflict","leave"])("não presume folga com evidência %s",async variant=>{
    await completeNightClock();
    if(variant==="partial") await db.exec("update public.monitoring_sources set configuration=jsonb_set(configuration,'{declaredCoverage,continuous}','false') where id='night-b'");
    if(variant==="source-error") await db.exec("update public.monitoring_files set rejected_rows=1 where source_id='night-b'");
    if(variant==="conflict") {await clockMark("2026-10-04T22:03:00-03:00");await db.exec("update public.monitoring_events set conflicted=true");}
    if(variant==="leave") await db.query("insert into private.employee_absence_periods(employee_id,situation,start_date,actual_return) values($1::uuid,'AFASTADO','2026-10-04','2026-10-05')",[person]);
    expect(await sundayAnchor("2026-10-23T12:00:00-03:00","2026-10-04")).toBeNull();
  });
  it("captura referência após completar coleta e preserva fase em importações seguintes",async()=>{
    await completeNightClock();
    await db.exec("update public.monitoring_sources set configuration=jsonb_set(configuration,'{declaredCoverage,continuous}','false') where id='night-b'");
    await db.query("update public.colaboradores set genero='feminino' where id=$1::uuid",[person]);
    await actor();await saveDefault(person,"2026-10-01",{...defaultPayload,start:"22:00",end:"06:20",days:[0,1,2,3,4,5]});await db.exec("reset role");
    const references=async()=>(await db.query<{n:number}>("select count(*)::int n from private.employee_sunday_off_references where employee_id=$1::uuid",[person])).rows[0].n;
    expect(await references()).toBe(0);
    await db.exec("update public.monitoring_sources set configuration=jsonb_set(configuration,'{declaredCoverage,continuous}','true') where id='night-b'");
    await db.query("select private.monitoring_enqueue($1::uuid)",[person]);expect(await references()).toBe(1);
    await clockMark("2026-10-04T22:03:00-03:00");
    await db.query("select private.monitoring_enqueue($1::uuid)",[person]);expect(await references()).toBe(1);
    await actor();
    const current=await employeeSchedule("get",{employeeId:person,date:"2026-10-23"});
    expect((current.setting as {payload:unknown}).payload).toMatchObject({weeklyRest:{kind:"night-women",sundayOffAnchor:"2026-10-04"}});
    await db.exec("reset role");await db.query("update public.colaboradores set genero=null where id=$1::uuid",[person]);await actor();
    expect(((await employeeSchedule("get",{employeeId:person,date:"2026-10-23"})).setting as {payload:unknown}).payload).toMatchObject({weeklyRest:{kind:"night-pending"}});
  });
  it("gênero feminino não substitui 12x36 nem cria referência de domingo para esse ciclo",async()=>{
    await completeNightClock();await db.query("update public.colaboradores set genero='feminino' where id=$1::uuid",[person]);
    await actor();await saveDefault(person,"2026-10-01",{...defaultPayload,start:"19:00",end:"07:00",days:[0,1,2,3,4,5,6],cycle:{kind:"12x36",anchorDate:"2026-10-01"}});
    const current=await employeeSchedule("get",{employeeId:person,date:"2026-10-23"});
    expect((current.setting as {payload:unknown}).payload).toMatchObject({cycle:{kind:"12x36",anchorDate:"2026-10-01"}});
    expect((current.setting as {payload:Record<string,unknown>}).payload).not.toHaveProperty("weeklyRest");
    await db.exec("reset role");expect((await db.query<{n:number}>("select count(*)::int n from private.employee_sunday_off_references where employee_id=$1::uuid",[person])).rows[0].n).toBe(0);
  });
  it("calendário de trabalho explícito prevalece sobre folga dominical",async()=>{
    await saveDefault(person,"2026-10-01",{...defaultPayload,days:[0,1,2,3,4,5,6]});
    const model=await template();
    await rpc("save",{kind:"calendar",name:"Domingo trabalhado",scope:"global",target:null,validFrom:"2026-10-04",validTo:"2026-10-04",payload:{working:true,templateId:model.id,expectedTemplateUpdatedAt:model.updatedAt},reason:"Exceção explícita confirmada"});
    await db.exec("reset role");
    const raw=(await db.query<{value:unknown}>("select private.monitoring_input($1::uuid,'2026-10-04','2026-10-04') value",[person])).rows[0].value;
    const [day]=reprocessMonitoringSnapshot(raw,{employeeId:person,start:"2026-10-04",end:"2026-10-04",reason:"Domingo de trabalho explícito"},Date.parse("2026-10-19T00:00:00Z"));
    expect(day.summary.scheduleName).toBe("Diurno teste");
  });

  it("aplica folga dominical a horários existentes e rejeita referência inválida",async()=>{
    await saveDefault(person,"2026-10-01",{...defaultPayload,days:[0,1,2,3,4,5,6]});
    await db.exec("reset role");
    expect((await db.query<{p:{days:number[];weeklyRest:{kind:string}}}>("select payload p from private.schedule_window_rows($1::uuid,'2026-10-04','2026-10-04')",[person])).rows[0].p).toMatchObject({days:[1,2,3,4,5,6],weeklyRest:{kind:"day"}});
    expect((await db.query<{value:{expected:boolean}}>("select private.daily_call_evidence($1::uuid,'2026-10-04') value",[person])).rows[0].value.expected).toBe(false);
    await actor();await expect(saveDefault(person,"2026-10-01",{...defaultPayload,start:"22:00",end:"06:20",weeklyRest:{kind:"night-women",sundayOffAnchor:"2026-10-05"}})).rejects.toThrow("INVALID");
  });
});
