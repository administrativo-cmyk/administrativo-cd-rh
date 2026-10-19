"use client";

import { Fragment, useState } from "react";
import { ArrowDown, ArrowUp, Minus, Plus, Users } from "lucide-react";
import { EmployeeAvatar } from "@/components/employee-avatar";
import type { MonitoringFilters, MonitoringGroup, MonitoringRow, MonitoringSnapshot } from "@/lib/monitoring/contracts";
import { sortMonitoringRows, type MonitoringSortKey } from "@/lib/monitoring/query-view";
import { buttonClass, calendarDate, duration, Quality } from "./shared";

const metrics = ["workedSeconds", "outsideSeconds", "cafeteriaSeconds", "mealsWithoutRest", "lateSeconds"] as const;
function metricValue(summary: MonitoringRow["summary"], key: typeof metrics[number]) {
  const quality = { workedSeconds: "", outsideSeconds: "outsideQuality", cafeteriaSeconds: "cafeteriaQuality", mealsWithoutRest: "mealQuality", lateSeconds: "" }[key];
  if (quality && summary?.[quality] === "excluded") return "Excluído por regra";
  if (key === "mealsWithoutRest") return typeof summary?.[key] === "number" ? `${summary[key]} vez(es)` : "Não apurável";
  return duration(summary?.[key]);
}
type Props={snapshot:MonitoringSnapshot;applied:MonitoringFilters;loading:boolean;onSort:(key:MonitoringSortKey)=>void;onPage:(offset:number)=>void;onDetails:(employeeId:string,date:string|null)=>void};

function Person({row}:{row:MonitoringRow}) {
  return <div className="flex items-center gap-2"><EmployeeAvatar name={row.name} employeeId={row.employeeId}/><div><span className="block font-semibold">{row.name}</span><span className="text-xs text-slate-500">{row.employeeNumber} · {row.unit} · {row.manager??"Sem gestor"}</span></div></div>;
}

export function MonitoringResults({snapshot,applied,loading,onSort,onPage,onDetails}:Props) {
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set());
  const grouped=Boolean(snapshot.grouped);
  const groups=snapshot.groups??[];
  const byEmployee=new Map<string,MonitoringRow[]>();
  for(const row of snapshot.rows)byEmployee.set(row.employeeId,[...byEmployee.get(row.employeeId)??[],row]);
  const orderBy=applied.orderBy??"name",direction=applied.direction??"asc";
  const headers:Array<[MonitoringSortKey,string]>=[["name","Colaborador / unidade"],["date",grouped?"Dias apurados":"Data operacional"],["quality","Qualidade"],["workedSeconds","Trabalho"],["outsideSeconds","Fora operação"],["cafeteriaSeconds","Refeitório"],["mealsWithoutRest","Refeições sem descanso"],["lateSeconds","Atraso"]];
  const dayRow=(row:MonitoringRow,child=false)=><tr key={`${row.employeeId}|${row.date}`} className={child?"bg-slate-50/70 hover:bg-blue-50/40":"hover:bg-slate-50"}>
    <td className="px-4 py-3">{child?<span className="pl-12 text-xs font-medium text-slate-600">Jornada individual</span>:<Person row={row}/>}</td>
    <td className="whitespace-nowrap px-4 py-3">{calendarDate(row.date)}</td><td className="px-4 py-3"><Quality value={row.quality}/></td>
    {metrics.map(key=><td className="whitespace-nowrap px-4 py-3" key={key}>{row.dirty?"Recalcular":metricValue(row.summary,key)}</td>)}
    <td className="px-4 py-3"><button className={buttonClass} onClick={()=>onDetails(row.employeeId,row.date)} aria-label={`Detalhes de ${row.name}${child?` em ${calendarDate(row.date)}`:""}`}>Ver detalhes</button></td>
  </tr>;
  const groupRow=(group:MonitoringGroup)=>{
    const open=expanded.has(group.employeeId),days=sortMonitoringRows(byEmployee.get(group.employeeId)??[],orderBy==="name"?"date":orderBy,direction);
    const id=`monitoring-days-${group.employeeId}`;
    return <Fragment key={group.employeeId}><tbody className="divide-y divide-slate-100">
      <tr className="border-t border-slate-200 hover:bg-slate-50" data-testid="monitoring-employee-summary">
        <th scope="row" className="px-4 py-3 text-left font-normal"><div className="flex items-center gap-2"><button type="button" className={`${buttonClass} h-11 w-11 shrink-0 p-0`} aria-expanded={open} aria-controls={id} aria-label={`${open?"Recolher":"Expandir"} dias de ${group.name}`} onClick={()=>setExpanded(current=>{const next=new Set(current);if(next.has(group.employeeId))next.delete(group.employeeId);else next.add(group.employeeId);return next;})}>{open?<Minus size={16} aria-hidden/>:<Plus size={16} aria-hidden/>}</button><Person row={group}/></div></th>
        <td className="px-4 py-3"><b>{group.assessedDays} de {group.totalDays}</b><span className="mt-1 block text-xs text-slate-500">dias com trabalho apurado</span></td>
        <td className="px-4 py-3"><Quality value={group.quality}/>{group.pendingDays?<span className="mt-1 block text-xs text-amber-900">{group.pendingDays} dia(s) pendente(s)</span>:null}</td>
        {metrics.map(key=><td className="whitespace-nowrap px-4 py-3" key={key}><b>{metricValue(group.summary,key)}</b><span className="mt-1 block text-xs text-slate-500">{group.metricDays[key]??0} de {group.totalDays} dias</span></td>)}
        <td className="px-4 py-3"><button className={buttonClass} aria-label={`Histórico de ${group.name} no período`} onClick={()=>onDetails(group.employeeId,group.firstDate)}>Ver histórico</button></td>
      </tr>
    </tbody><tbody id={id} hidden={!open} aria-label={`Dias de ${group.name}`} className="divide-y divide-slate-100">{open?days.map(row=>dayRow(row,true)):null}</tbody></Fragment>;
  };
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label="Resultados do Monitoramento" aria-busy={loading}>
    {grouped?<div className="border-b border-slate-200 px-4 py-3 text-xs leading-relaxed text-slate-600">Uma linha por colaborador. Os totais incluem todos os dias filtrados do período, antes da paginação. O “+” abre as jornadas. Dias sem valor apurado não entram como zero.</div>:null}
    {snapshot.rows.length?<div className="overflow-x-auto"><table className="w-full min-w-[1060px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr>{headers.map(([key,label])=><th scope="col" key={key} className="px-4 py-2" aria-sort={orderBy===key?direction==="asc"?"ascending":"descending":"none"}><button type="button" className="flex min-h-11 w-full items-center gap-2 text-left font-semibold focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50" disabled={loading} aria-label={`Ordenar por ${label}`} onClick={()=>onSort(key)}>{label}{orderBy===key?direction==="asc"?<ArrowUp size={14} aria-hidden/>:<ArrowDown size={14} aria-hidden/>:null}</button></th>)}<th scope="col" className="px-4 py-3">Detalhes</th></tr></thead>
      {grouped?groups.map(groupRow):<tbody className="divide-y divide-slate-100">{snapshot.rows.map(row=>dayRow(row))}</tbody>}
    </table></div>:<div className="p-12 text-center text-slate-600"><Users className="mx-auto mb-3" size={28}/><p>Nenhum colaborador encontrado nos filtros e permissões atuais.</p></div>}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 p-3 text-xs text-slate-600"><span>{snapshot.total?applied.offset+1:0}–{Math.min(applied.offset+applied.limit,snapshot.total)} de {snapshot.total}{grouped?" colaboradores":" registros"}</span><div className="flex gap-2"><button className={buttonClass} disabled={loading||applied.offset===0} onClick={()=>onPage(Math.max(0,applied.offset-applied.limit))}>Anterior</button><button className={buttonClass} disabled={loading||applied.offset+applied.limit>=snapshot.total} onClick={()=>onPage(applied.offset+applied.limit)}>Próxima</button></div></div>
    <details className="border-t border-slate-200 px-4 py-3 text-xs leading-relaxed text-slate-600"><summary className="cursor-pointer font-semibold text-blue-900">Por que um valor aparece como “Não apurável”?</summary><p className="mt-2">Batidas e acessos são evidências diferentes. A jornada exige escala e sequência de ponto confirmadas. Os indicadores de localização exigem leitores validados, coleta integral no dia e, quando aplicável, grupos com vigência histórica. Abra “Ver detalhes” no dia para conferir a pendência específica. Dias sem trabalho, sem coleta completa ou com batida faltante não devem receber duração zero por suposição.</p></details>
  </section>;
}
