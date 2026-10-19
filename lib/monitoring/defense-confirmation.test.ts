import { describe,expect,it,vi } from "vitest";
import { applyDefenseConfirmation,defenseConfirmationSchema,planDefenseConfirmation,type DefenseAdmin } from "./defense-confirmation";
const id=(n:number)=>`30000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const input=defenseConfirmationSchema.parse({action:"preview",start:"2026-10-03",end:"2026-10-15",accessSourceId:"access",personSourceId:"people",confirmCoverage:true,confirmGroups:true,reason:"Confirmação expressa dos dias e grupos pelo responsável"});
function fixture():DefenseAdmin{return {
 sources:[{id:"access",kind:"defense-access",identity_namespace:"defense",active:true},{id:"people",kind:"defense-person",identity_namespace:"defense",active:true}],
 files:[{id:id(1),source_id:"people",status:"complete",relative_path:"Person.xlsx",completed_at:"2026-10-16T12:00:00Z"},{id:id(2),source_id:"access",status:"complete",relative_path:"Access.xlsx",completed_at:"2026-10-16T12:00:00Z"}],
 settings:(["operation","cafeteria"] as const).flatMap((area,i)=>(["entry","exit"] as const).map((direction,j)=>({id:id(10+i*2+j),kind:"mapping",target:`${area}-${direction}`,valid_from:"2026-10-01",valid_to:null,payload:{area,direction,validated:true,eventClasses:["face"]},revoked_at:null}))),
 bindings:[{id:id(20),source_id:"people",identity_type:"defense",identity_value:"123",employee_id:id(30),valid_from:"2026-10-01",valid_to:null,revoked_at:null}],
 employees:[{id:id(30),name:"Pessoa Sintética",employeeNumber:"123"}],people:[{source_id:"people",external_id:"123",name:"Pessoa Sintética",groups:["Equipe A"],ambiguous:false}]
};}
describe("confirmação histórica do Defense",()=>{
 it("cria grupos apenas no intervalo e cobertura fecha à meia-noite seguinte",()=>{
  const plan=planDefenseConfirmation(fixture(),input);
  expect(plan.people[0]).toMatchObject({status:"create",setting:{kind:"group_snapshot",target:id(30),validFrom:"2026-10-03",validTo:"2026-10-15",payload:{groups:["EQUIPE A"]}}});
  expect(plan.coverage[0].setting).toMatchObject({kind:"coverage",validFrom:"2026-10-03",validTo:"2026-10-15",payload:{start:"2026-10-03T00:00:00-03:00",end:"2026-10-16T00:00:00-03:00",sourceIds:["access"]}});
 });
 it("amplia evidência igual em 08/10, preservando revisão e dados originais",()=>{
  const a=fixture();a.settings.push({id:id(50),kind:"group_snapshot",target:id(30),valid_from:"2026-10-08",valid_to:"2026-10-08",payload:{groups:["Equipe A"],evidence:"Anterior"},updated_at:"2026-10-19T10:00:00Z",revoked_at:null});
  const plan=planDefenseConfirmation(a,input);expect(plan.people[0]).toMatchObject({status:"extend",previous:{id:id(50)},setting:{validFrom:"2026-10-03",validTo:"2026-10-15"}});expect(a.settings.at(-1)?.valid_from).toBe("2026-10-08");
 });
 it("não modifica grupos posteriores nem decide conflito anterior",()=>{
  const a=fixture();a.settings.push({id:id(50),kind:"group_snapshot",target:id(30),valid_from:"2026-10-16",valid_to:null,payload:{groups:["Outra equipe"]},updated_at:"2026-10-19T10:00:00Z",revoked_at:null});
  expect(planDefenseConfirmation(a,input).people[0].status).toBe("create");
  a.settings[4].valid_from="2026-10-08";expect(planDefenseConfirmation(a,input).people[0].status).toBe("conflict");expect(planDefenseConfirmation(a,input).people[0].setting).toBeUndefined();
 });
 it("não vincula pelo nome nem extrapola vínculo com vigência menor",()=>{
  const a=fixture();a.bindings=[];expect(planDefenseConfirmation(a,input).people[0].status).toBe("unlinked");
  const b=fixture();b.bindings[0].valid_from="2026-10-08";expect(planDefenseConfirmation(b,input).people[0]).toMatchObject({status:"create",setting:{validFrom:"2026-10-08",validTo:"2026-10-15"}});
  const c=fixture();c.bindings[0].valid_from="2026-10-16";expect(planDefenseConfirmation(c,input).people[0].status).toBe("unlinked");
 });
 it("bloqueia identidade ambígua e dois cadastros para o mesmo empregado",()=>{
  const a=fixture();a.people[0].ambiguous=true;expect(planDefenseConfirmation(a,input).people[0].status).toBe("conflict");
  const b=fixture();b.people.push({...b.people[0],external_id:"124"});b.bindings.push({...b.bindings[0],id:id(21),identity_value:"124"});expect(planDefenseConfirmation(b,input).people.every(p=>p.status==="conflict")).toBe(true);
 });
 it("não atravessa interrupções no vínculo e respeita a data final",()=>{
  const a=fixture();a.bindings[0].valid_to="2026-10-05";a.bindings.push({...a.bindings[0],id:id(21),valid_from:"2026-10-08",valid_to:null});
  expect(planDefenseConfirmation(a,input).people[0].status).toBe("conflict");
  const b=fixture();b.bindings[0].valid_to="2026-10-10";expect(planDefenseConfirmation(b,input).people[0].setting).toMatchObject({validFrom:"2026-10-03",validTo:"2026-10-10"});
 });
 it("não libera cobertura com leitor sem validação",()=>{
  const a=fixture();a.settings[0].payload.validated=false;expect(planDefenseConfirmation(a,input).coverage[0].status).toBe("conflict");
 });
 it("amplia janela horária estreita mesmo se datas já cobrem o intervalo",()=>{
  const a=fixture();a.settings.push({id:id(70),kind:"coverage",target:"old-coverage",valid_from:input.start,valid_to:input.end,updated_at:"2026-10-19T10:00:00Z",revoked_at:null,payload:{area:"operation",start:"2026-10-03T12:00:00-03:00",end:"2026-10-15T12:00:00-03:00",sourceIds:["access"],declaredComplete:true}});
  expect(planDefenseConfirmation(a,input).coverage[0]).toMatchObject({status:"extend",setting:{target:"old-coverage",payload:{start:"2026-10-03T00:00:00-03:00",end:"2026-10-16T00:00:00-03:00"}}});
 });
 it("recusa fontes de espaços diferentes e arquivo não concluído",()=>{
  const a=fixture();a.sources[0].identity_namespace="other";expect(()=>planDefenseConfirmation(a,input)).toThrow("DEFENSE_SOURCE_MISMATCH");
  const b=fixture();b.files[1].status="failed";expect(()=>planDefenseConfirmation(b,input)).toThrow("DEFENSE_FILE_MISSING");
 });
 it("prévia obsoleta ou cursor inválido não faz nenhuma escrita",async()=>{
  const a=fixture(),plan=planDefenseConfirmation(a,input),save=vi.fn();
  await expect(applyDefenseConfirmation(plan,{...input,action:"apply",fingerprint:"f".repeat(64)},save)).rejects.toThrow("DEFENSE_PREVIEW_STALE");expect(save).not.toHaveBeenCalled();
  await expect(applyDefenseConfirmation(plan,{...input,action:"apply",fingerprint:plan.preview.fingerprint,cursor:1},save)).rejects.toThrow("DEFENSE_CURSOR_INVALID");expect(save).not.toHaveBeenCalled();
 });
 it("é retomável: evidências já confirmadas não geram duplicações",async()=>{
  const a=fixture(),plan=planDefenseConfirmation(a,input);const save=vi.fn(async(change:typeof plan.people[number])=>{const s=change.setting!;a.settings.push({id:id(100+a.settings.length),kind:s.kind,target:s.target,valid_from:s.validFrom,valid_to:s.validTo??null,payload:s.payload,revoked_at:null,updated_at:"2026-10-19T10:00:00Z"});});
  const applied={...input,action:"apply" as const,fingerprint:plan.preview.fingerprint};expect((await applyDefenseConfirmation(plan,applied,save)).applied).toBe(3);
  const next=planDefenseConfirmation(a,input);expect(next.preview.fingerprint).toBe(plan.preview.fingerprint);expect(next.preview.counts.covered).toBe(3);save.mockClear();expect((await applyDefenseConfirmation(next,applied,save)).applied).toBe(0);expect(save).not.toHaveBeenCalled();
 });
 it("não aceita grupos/colaboradores enviados pelo cliente",()=>{
  expect(defenseConfirmationSchema.safeParse({...input,employeeId:id(30),groups:["Forçado"]}).success).toBe(false);
 });
});
