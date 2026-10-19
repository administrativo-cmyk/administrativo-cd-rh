import { createHash } from "node:crypto";
import { z } from "zod";
import { dateSchema, settingSchema, type MonitoringSetting } from "./contracts";
import { normalizeGroups } from "./domain/eligibility";

const text=z.string().min(1).max(200);
const setting=z.object({id:z.string().uuid(),kind:z.string(),target:z.string(),valid_from:dateSchema,valid_to:dateSchema.nullable(),payload:z.record(z.unknown()),revoked_at:z.string().nullable(),updated_at:z.string().optional(),supersedes_id:z.string().nullable().optional()});
export const defenseAdminSchema=z.object({
  sources:z.array(z.object({id:text,kind:text,active:z.boolean().optional(),identity_namespace:text.optional()})),
  files:z.array(z.object({id:z.string().uuid(),source_id:text,status:text,relative_path:z.string(),completed_at:z.string().nullable(),group_observed_at:z.string().nullable().optional()})),
  settings:z.array(setting).max(20000),
  bindings:z.array(z.object({id:z.string().uuid(),source_id:text,identity_type:text,identity_value:text,employee_id:z.string().uuid(),valid_from:dateSchema,valid_to:dateSchema.nullable(),revoked_at:z.string().nullable(),updated_at:z.string().optional()})).max(20000),
  employees:z.array(z.object({id:z.string().uuid(),name:text,employeeNumber:text})),
  people:z.array(z.object({source_id:text,external_id:text,name:text,groups:z.array(text).max(50),ambiguous:z.boolean().optional()})).max(100),
});
export type DefenseAdmin=z.infer<typeof defenseAdminSchema>;
export const defenseConfirmationSchema=z.object({action:z.enum(["preview","apply"]),start:dateSchema,end:dateSchema,
  accessSourceId:text,personSourceId:text,confirmCoverage:z.boolean(),confirmGroups:z.boolean(),reason:z.string().trim().min(5).max(1000),
  fingerprint:z.string().regex(/^[a-f0-9]{64}$/).optional(),cursor:z.number().int().min(0).max(5000).default(0),
}).strict().refine(v=>v.end>=v.start&&Date.parse(v.end)-Date.parse(v.start)<=30*86400000,"Confirme até 31 dias por vez")
  .refine(v=>v.confirmCoverage||v.confirmGroups,"Selecione a evidência confirmada")
  .refine(v=>v.action!=="apply"||Boolean(v.fingerprint),"Faça a prévia antes de aplicar");
export type DefenseConfirmationInput=z.infer<typeof defenseConfirmationSchema>;
type Status="create"|"extend"|"covered"|"conflict"|"unlinked";
type Change={status:Status;label:string;why?:string;setting?:MonitoringSetting;previous?:z.infer<typeof setting>};
export type DefenseConfirmationPreview={fingerprint:string;people:Array<{employeeId?:string;name:string;employeeNumber:string;groups:string[];status:Status;why?:string;validFrom?:string;validTo?:string}>;coverage:Array<{label:string;status:Status;why?:string}>;counts:Record<Status,number>;sourceFile:string;total:number};
export interface DefenseConfirmationPlan {preview:DefenseConfirmationPreview;people:Change[];coverage:Change[]}
function fail(code:string):never {throw Object.assign(new Error(code),{code});}
const overlaps=(a:{valid_from:string;valid_to:string|null},start:string,end:string)=>a.valid_from<=end&&(!a.valid_to||a.valid_to>=start);
const normalized=(groups:unknown)=>normalizeGroups(Array.isArray(groups)?groups.filter((v):v is string=>typeof v==="string"):[]).sort();

function changeFor(existing:z.infer<typeof setting>[],next:MonitoringSetting,same:(payload:Record<string,unknown>)=>boolean,coversPayload:(payload:Record<string,unknown>)=>boolean=()=>true):Change {
  const matches=existing.filter(s=>s.kind===next.kind&&s.target===next.target&&overlaps(s,next.validFrom,next.validTo!));
  if(matches.length>1||matches.some(s=>!same(s.payload)))return {status:"conflict",label:next.target,why:"Existe evidência diferente ou sobreposta; revisar individualmente"};
  const previous=matches[0];
  if(previous&&previous.valid_from<=next.validFrom&&(!previous.valid_to||previous.valid_to>=next.validTo!)&&coversPayload(previous.payload))return {status:"covered",label:next.target};
  if(previous&&!previous.updated_at)return {status:"conflict",label:next.target,why:"Atualize o cadastro para obter a revisão atual"};
  const expanded=previous?{...next,validFrom:previous.valid_from<next.validFrom?previous.valid_from:next.validFrom,
    validTo:previous.valid_to===null?null:previous.valid_to!>next.validTo!?previous.valid_to:next.validTo}:next;
  return {status:previous?"extend":"create",label:next.target,setting:settingSchema.parse(expanded),previous};
}

/** The file supplies groups; only an existing, unambiguous, dated binding supplies the employee. */
export function planDefenseConfirmation(admin:DefenseAdmin,input:DefenseConfirmationInput):DefenseConfirmationPlan {
  const access=admin.sources.find(s=>s.id===input.accessSourceId&&s.kind==="defense-access"&&s.active!==false);
  const person=admin.sources.find(s=>s.id===input.personSourceId&&s.kind==="defense-person"&&s.active!==false);
  if(!access||!person||!access.identity_namespace||access.identity_namespace!==person.identity_namespace)fail("DEFENSE_SOURCE_MISMATCH");
  const file=admin.files.filter(f=>f.source_id===person.id&&f.status==="complete").sort((a,b)=>(b.group_observed_at??b.completed_at??"").localeCompare(a.group_observed_at??a.completed_at??""))[0];
  if(!file)fail("DEFENSE_FILE_MISSING");
  const accessFile=admin.files.filter(f=>f.source_id===access.id&&f.status==="complete").sort((a,b)=>(b.completed_at??"").localeCompare(a.completed_at??""))[0];
  if(input.confirmCoverage&&!accessFile)fail("DEFENSE_FILE_MISSING");
  const active=admin.settings.filter(s=>!s.revoked_at&&!admin.settings.some(other=>other.supersedes_id===s.id));
  const bindings=admin.bindings.filter(b=>!b.revoked_at&&b.identity_type==="defense"&&admin.sources.find(s=>s.id===b.source_id)?.identity_namespace===person.identity_namespace);
  const people=admin.people.filter(p=>p.source_id===person.id).sort((a,b)=>a.external_id.localeCompare(b.external_id));
  if(new Set(people.map(p=>p.external_id)).size!==people.length)fail("DEFENSE_PAGE_CHANGED");
  const changes:Change[]=[];
  const peoplePreview:DefenseConfirmationPreview["people"]=[];
  const employeeMultiplicity=new Map<string,number>();
  for(const p of people){const ids=[...new Set(bindings.filter(b=>b.identity_value===p.external_id&&overlaps(b,input.start,input.end)).map(b=>b.employee_id))];if(ids.length===1)employeeMultiplicity.set(ids[0],(employeeMultiplicity.get(ids[0])??0)+1);}
  if(input.confirmGroups)for(const p of people){
    const candidates=bindings.filter(b=>b.identity_value===p.external_id&&overlaps(b,input.start,input.end));
    const ids=[...new Set(candidates.map(b=>b.employee_id))];
    const employee=ids.length===1?admin.employees.find(e=>e.id===ids[0]):undefined;
    const intervals=candidates.filter(b=>b.employee_id===employee?.id).map(b=>({start:b.valid_from<input.start?input.start:b.valid_from,end:!b.valid_to||b.valid_to>input.end?input.end:b.valid_to})).sort((a,b)=>a.start.localeCompare(b.start));
    const interval=intervals[0]?{...intervals[0]}:undefined;
    let gap=false;for(const next of intervals.slice(1)){if(Date.parse(next.start)-Date.parse(interval!.end)>86400000)gap=true;if(next.end>interval!.end)interval!.end=next.end;}
    let change:Change;
    if(p.ambiguous||ids.length>1||(employee&&(employeeMultiplicity.get(employee.id)??0)>1))change={status:"conflict",label:p.name,why:"Identidade com mais de um vínculo ou cadastro ambíguo"};
    else if(!employee||!interval)change={status:"unlinked",label:p.name,why:"Sem vínculo confirmado no intervalo"};
    else if(gap)change={status:"conflict",label:p.name,why:"Vigência do vínculo tem interrupção; revisar individualmente"};
    else if(!p.groups.length)change={status:"conflict",label:p.name,why:"Cadastro sem grupos para confirmar"};
    else {change=changeFor(active,{kind:"group_snapshot",target:employee.id,validFrom:interval.start,validTo:interval.end,reason:input.reason,payload:{groups:normalized(p.groups),evidence:`${input.reason} · Cadastro ${file.relative_path}`.slice(0,1000)}},payload=>JSON.stringify(normalized(payload.groups))===JSON.stringify(normalized(p.groups)));
      if(!change.why&&(interval.start!==input.start||interval.end!==input.end))change.why=`Limitado à vigência do vínculo: ${interval.start} a ${interval.end}`;}
    changes.push(change);peoplePreview.push({employeeId:employee?.id,name:employee?.name??p.name,employeeNumber:employee?.employeeNumber??p.external_id,groups:normalized(p.groups),status:change.status,why:change.why,validFrom:interval?.start,validTo:interval?.end});
  }
  const coverage:Change[]=[];
  if(input.confirmCoverage)for(const area of ["operation","cafeteria"] as const){
    let mapsValid=true;
    for(let day=input.start;day<=input.end;day=new Date(Date.parse(day+"T12:00:00Z")+86400000).toISOString().slice(0,10))for(const direction of ["entry","exit"]){
      if(active.filter(s=>s.kind==="mapping"&&s.payload.area===area&&s.payload.direction===direction&&s.payload.validated===true&&Array.isArray(s.payload.eventClasses)&&s.payload.eventClasses.length&&s.valid_from<=day&&(!s.valid_to||s.valid_to>=day)).length!==1)mapsValid=false;
    }
    if(!mapsValid){coverage.push({status:"conflict",label:area,why:"Confirme os mapas de entrada e saída em todos os dias"});continue;}
    const old=active.filter(s=>s.kind==="coverage"&&s.payload.area===area&&Array.isArray(s.payload.sourceIds)&&s.payload.sourceIds.includes(access.id)&&overlaps(s,input.start,input.end));
    if(old.length>1){coverage.push({status:"conflict",label:area,why:"Há coberturas sobrepostas; conferir individualmente"});continue;}
    const end=new Date(Date.parse(input.end+"T12:00:00Z")+86400000).toISOString().slice(0,10);
    const next:MonitoringSetting={kind:"coverage",target:old[0]?.target??`defense-${area}-${access.id}`,validFrom:input.start,validTo:input.end,reason:input.reason,
      payload:{area,start:`${input.start}T00:00:00-03:00`,end:`${end}T00:00:00-03:00`,sourceIds:[access.id],declaredComplete:true,evidence:input.reason}};
    // Never shorten an existing wider coverage or absorb unrelated sources.
    if(old[0]){
      const p=old[0].payload;
      if(p.declaredComplete!==true||JSON.stringify(p.sourceIds)!==JSON.stringify([access.id])){coverage.push({status:"conflict",label:area,why:"Cobertura existente usa evidência ou fontes diferentes"});continue;}
      if(typeof p.start!=="string"||typeof p.end!=="string")fail("DEFENSE_COVERAGE_INVALID");
      if(Date.parse(p.start)<Date.parse(next.payload.start))next.payload.start=p.start;
      if(Date.parse(p.end)>Date.parse(next.payload.end))next.payload.end=p.end;
    }
    const change=changeFor(active,next,p=>p.area===area&&p.declaredComplete===true&&JSON.stringify(p.sourceIds)===JSON.stringify([access.id])&&typeof p.start==="string"&&typeof p.end==="string",
      p=>Date.parse(String(p.start))<=Date.parse(next.payload.start)&&Date.parse(String(p.end))>=Date.parse(next.payload.end));
    coverage.push({...change,label:area});
  }
  const fingerprint=createHash("sha256").update(JSON.stringify({source:person.id,access:access.id,namespace:person.identity_namespace,file:file.id,accessFile:accessFile?.id,start:input.start,end:input.end,confirmGroups:input.confirmGroups,confirmCoverage:input.confirmCoverage,
    people:people.map(p=>[p.external_id,p.name,normalized(p.groups),p.ambiguous??false]),bindings:bindings.map(b=>[b.id,b.employee_id,b.identity_value,b.valid_from,b.valid_to,b.updated_at]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))})).digest("hex");
  const all=[...changes,...coverage];
  const counts=Object.fromEntries((["create","extend","covered","conflict","unlinked"] as const).map(status=>[status,all.filter(change=>change.status===status).length])) as DefenseConfirmationPreview["counts"];
  return {people:changes,coverage,preview:{fingerprint,people:peoplePreview,coverage:coverage.map(({label,status,why})=>({label,status,why})),counts,sourceFile:file.relative_path,total:changes.length}};
}

export async function readDefenseConfirmationAdmin(read:(offset:number)=>Promise<unknown>):Promise<DefenseAdmin>{
  const first=defenseAdminSchema.parse(await read(0));const people=[...first.people];
  const signature=(page:DefenseAdmin)=>JSON.stringify({files:page.files.map(f=>[f.id,f.status,f.completed_at]).sort(),bindings:page.bindings.map(b=>[b.id,b.updated_at,b.revoked_at]).sort()});
  const original=signature(first);
  for(let offset=100;people.length%100===0&&offset<=5000;offset+=100){const page=defenseAdminSchema.parse(await read(offset));if(signature(page)!==original)fail("DEFENSE_PAGE_CHANGED");people.push(...page.people);if(page.people.length<100)break;}
  if(people.length>=5000)fail("DEFENSE_PAGE_LIMIT");
  return {...first,people};
}

export async function applyDefenseConfirmation(plan:DefenseConfirmationPlan,input:DefenseConfirmationInput,save:(change:Change)=>Promise<unknown>){
  if(input.fingerprint!==plan.preview.fingerprint)fail("DEFENSE_PREVIEW_STALE");
  if(input.cursor>plan.people.length||input.cursor%20!==0)fail("DEFENSE_CURSOR_INVALID");
  const selected=[...(input.cursor===0?plan.coverage:[]),...plan.people.slice(input.cursor,input.cursor+20)];
  let applied=0;for(const change of selected)if(change.setting&&(change.status==="create"||change.status==="extend")){await save(change);applied++;}
  const cursor=Math.min(plan.people.length,input.cursor+20);
  return {ok:true,applied,cursor,done:cursor>=plan.people.length,counts:plan.preview.counts};
}
