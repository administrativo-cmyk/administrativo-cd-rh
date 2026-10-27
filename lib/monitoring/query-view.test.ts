import { describe,expect,it,vi } from "vitest";
import { filtersSchema,type MonitoringRow,type MonitoringSnapshot } from "./contracts";
import { monitoringGroups,monitoringQueryView,readCompleteMonitoring,sortMonitoringRows } from "./query-view";
const id=(n:number)=>`30000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const row=(n:number,date="2026-10-08",worked:number|null=3600):MonitoringRow=>({employeeId:id(n),name:`Pessoa ${n}`,employeeNumber:String(n),unit:"CD I",manager:"Gestor",managerId:null,date,quality:worked===null?"unavailable":"partial",dirty:false,computedAt:null,ruleVersion:"test",summary:{workedSeconds:worked,outsideSeconds:worked===null?null:0,cafeteriaSeconds:null,lateSeconds:null}});
const filters=filtersSchema.parse({start:"2026-10-08",end:"2026-10-09",limit:1});
const snapshot=(rows:MonitoringRow[],total=rows.length,version="v1"):MonitoringSnapshot=>({datasetVersion:version,rows,total,people:new Set(rows.map(r=>r.employeeId)).size,pending:0,excluded:0,totals:{workedSeconds:1},timezone:"America/Sao_Paulo",queriedAt:"2026-10-19T12:00:00Z",start:filters.start,end:filters.end});
describe("agrupamento e ordenação de todo o período",()=>{
 it("seleciona tempos observados uma única vez e mantém totais oficiais e dados de origem",()=>{
  const first={...row(1),summary:{outsideSeconds:900,cafeteriaSeconds:800,outsideQuality:"excluded",locationObservation:{quality:"observed-partial",outsideSeconds:92,cafeteriaSeconds:1880}}};
  const second={...row(2),summary:{outsideSeconds:100,cafeteriaSeconds:200}};
  const source=snapshot([first,second]),original=structuredClone(source);
  const result=monitoringQueryView(source,{...filters,orderBy:"outsideSeconds",direction:"desc"});
  expect(result.totals).toMatchObject({displayedOutsideSeconds:192,displayedCafeteriaSeconds:2080,outsideSecondsObservedDays:1,cafeteriaSecondsObservedDays:1});
  expect(result.groups?.[0].employeeId).toBe(id(2));
  const observed=monitoringGroups([first])[0];
  expect(observed.summary).toMatchObject({outsideSeconds:92,cafeteriaSeconds:1880,outsideQuality:"partial"});
  expect(source).toEqual(original);
 });
 it("soma todos os dias antes de ordenar e paginar colaboradores",()=>{
  const source=snapshot([row(1,"2026-10-08",100),row(2,"2026-10-08",250),row(1,"2026-10-09",200)]);
  const view=monitoringQueryView(source,{...filters,orderBy:"workedSeconds",direction:"desc"});
  expect(view.total).toBe(2);expect(view.recordTotal).toBe(3);expect(view.groups?.[0].employeeId).toBe(id(1));expect(view.groups?.[0].summary?.workedSeconds).toBe(300);expect(view.rows).toHaveLength(2);
  expect(monitoringQueryView(source,{...filters,orderBy:"workedSeconds",direction:"desc",offset:1}).groups?.[0].employeeId).toBe(id(2));
 });
 it("listas incluem colaboradores e escalas fora da página, sem duplicar dias",()=>{
  const source=snapshot([
   {...row(1),summary:{scheduleName:"Manhã"}},
   {...row(1,"2026-10-09"),summary:{scheduleName:"Manhã"}},
   {...row(2),summary:{scheduleName:"Noite"}},
   {...row(3),summary:null},
  ]);
  const view=monitoringQueryView(source,filters);
  expect(view.groups).toHaveLength(1);
  expect(view.options?.employees?.map(employee=>employee.id)).toEqual([id(1),id(2),id(3)]);
  expect(view.options?.schedules).toEqual(["Manhã","Noite"]);
 });
 it("distingue zero conhecido, total parcial e ausência de apuração",()=>{
  const groups=monitoringGroups([row(1,"2026-10-08",100),row(1,"2026-10-09",null),row(2,"2026-10-08",null)]);
  expect(groups[0]).toMatchObject({assessedDays:1,totalDays:2,metricDays:{workedSeconds:1,outsideSeconds:1,cafeteriaSeconds:0},summary:{workedSeconds:100,outsideSeconds:0,cafeteriaSeconds:null}});
  expect(groups[1].summary?.workedSeconds).toBeNull();
 });
 it.each(["asc","desc"] as const)("mantém não apurável no fim em %s",direction=>{
  const sorted=sortMonitoringRows([row(1,"2026-10-08",null),row(2,"2026-10-08",0),row(3,"2026-10-08",1)],"workedSeconds",direction);
  expect(sorted.at(-1)?.employeeId).toBe(id(1));expect(sorted[0].summary?.workedSeconds).toBe(direction==="asc"?0:1);
 });
 it("exclui resultados desatualizados dos totais",()=>{
  const group=monitoringGroups([row(1,"2026-10-08",100),{...row(1,"2026-10-09",500),dirty:true,quality:"stale"}])[0];
  expect(group.summary?.workedSeconds).toBe(100);expect(group.quality).toBe("stale");expect(group.metricDays.workedSeconds).toBe(1);
 });
 it("ordena nomes em português e não altera a entrada",()=>{
  const rows=[{...row(1),name:"Zélia"},{...row(2),name:"Álvaro"},{...row(3),name:"Bruno"}];
  expect(sortMonitoringRows(rows,"name","asc").map(r=>r.name)).toEqual(["Álvaro","Bruno","Zélia"]);expect(rows[0].name).toBe("Zélia");
 });
 it("dia único também ordena globalmente antes da página",()=>{
  const result=monitoringQueryView(snapshot([row(1,"2026-10-08",10),row(2,"2026-10-08",99)]),{...filters,end:filters.start,orderBy:"workedSeconds",direction:"desc"});
  expect(result.grouped).toBe(false);expect(result.rows[0].employeeId).toBe(id(2));expect(result.total).toBe(2);
 });
 it("soma uma única linha pendente sem inventar dias",()=>{
  const group=monitoringGroups([{...row(1),date:null,summary:null,quality:"pending"}])[0];expect(group.totalDays).toBe(0);expect(group.summary?.workedSeconds).toBeNull();
 });
});
describe("leitura integral consistente da RPC autorizada",()=>{
 const rows=Array.from({length:1001},(_,n)=>row(n+1));
 it("lê todos os registros de uma só vez e conserva filtros e sinal",async()=>{
  const read=vi.fn(async()=>snapshot(rows,rows.length));
  const controller=new AbortController();
  const result=await readCompleteMonitoring({...filters,employeeId:id(7),query:"teste",offset:500},read,controller.signal);
  expect(result.rows).toHaveLength(1001);expect(read).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledWith(expect.objectContaining({employeeId:id(7),query:"teste",offset:0}),controller.signal);
 });
 it("publicações contínuas do worker não exigem uma versão estável entre chamadas",async()=>{
  let version=0;const read=vi.fn(async()=>snapshot(rows,rows.length,String(++version)));
  expect((await readCompleteMonitoring(filters,read)).datasetVersion).toBe("1");
  expect((await readCompleteMonitoring(filters,read)).datasetVersion).toBe("2");expect(read).toHaveBeenCalledTimes(2);
 });
 it("recusa dados duplicados ou incompletos",async()=>{
  await expect(readCompleteMonitoring(filters,async f=>snapshot(f.offset===0?rows.slice(0,500):[rows[0]],501))).rejects.toThrow("MONITORING_INCOMPLETE_PAGE");
  await expect(readCompleteMonitoring(filters,async()=>snapshot(rows.slice(0,100),501))).rejects.toThrow("MONITORING_INCOMPLETE_PAGE");
 });
 it("interrompe uma consulta cancelada sem disparar outra leitura",async()=>{
  const controller=new AbortController();controller.abort();const read=vi.fn(async()=>snapshot(rows));
  await expect(readCompleteMonitoring(filters,read,controller.signal)).rejects.toThrow();expect(read).not.toHaveBeenCalled();
 });
 it("recusa paginação sem revisão e limita consultas excessivas",async()=>{
  await expect(readCompleteMonitoring(filters,async()=>({...snapshot(rows,1001),datasetVersion:undefined}))).rejects.toThrow("MONITORING_INCOMPLETE_PAGE");
  await expect(readCompleteMonitoring(filters,async()=>snapshot([],200001))).rejects.toThrow("MONITORING_PERIOD_TOO_LARGE");
 });
});
