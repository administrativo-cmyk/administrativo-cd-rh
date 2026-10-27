"use client";

import { Fragment, useState } from "react";
import { ArrowDown, ArrowUp, Minus, Plus, Users } from "lucide-react";
import { EmployeeAvatar } from "@/components/employee-avatar";
import type { MonitoringFilters, MonitoringGroup, MonitoringRow, MonitoringSnapshot } from "@/lib/monitoring/contracts";
import { sortMonitoringRows, type MonitoringSortKey } from "@/lib/monitoring/query-view";
import { buttonClass, calendarDate, duration, Quality } from "./shared";
import { displayedLocation, displayedRest, displayedWork, locationObservation, workObservation } from "@/lib/monitoring/work-observation-view";

const metrics = ["workedSeconds", "restSeconds", "outsideSeconds", "cafeteriaSeconds", "mealsWithoutRest", "lateSeconds"] as const;
function metricValue(summary: MonitoringRow["summary"], key: typeof metrics[number]) {
  if (key === "workedSeconds") return duration(displayedWork(summary));
  if (key === "restSeconds") return duration(displayedRest(summary));
  if ((key === "outsideSeconds" || key === "cafeteriaSeconds") && typeof locationObservation(summary)?.[key] === "number") return duration(displayedLocation(summary, key));
  const quality = { outsideSeconds: "outsideQuality", cafeteriaSeconds: "cafeteriaQuality", mealsWithoutRest: "mealQuality", lateSeconds: "" }[key];
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
  const headers:Array<[MonitoringSortKey,string]>=[["name","Colaborador / unidade"],["date",grouped?"Dias apurados":"Data operacional"],["quality","Qualidade"],["workedSeconds","Trabalho"],["restSeconds","Descanso"],["outsideSeconds","Fora operação"],["cafeteriaSeconds","Refeitório"],["mealsWithoutRest","Refeições sem descanso"],["lateSeconds","Atraso"]];
  const dayRow=(row:MonitoringRow,child=false)=><tr key={`${row.employeeId}|${row.date}`} className={child?"bg-slate-50/70 hover:bg-blue-50/40":"hover:bg-slate-50"}>
    <td className="px-4 py-3">{child?<span className="pl-12 text-xs font-medium text-slate-600">Jornada individual</span>:<Person row={row}/>}</td>
    <td className="whitespace-nowrap px-4 py-3">{calendarDate(row.date)}</td><td className="px-4 py-3"><Quality value={row.quality}/></td>
    {metrics.map(key=><td className="whitespace-nowrap px-4 py-3" key={key}>{row.dirty?"Recalcular":<>{metricValue(row.summary,key)}{(key === "outsideSeconds" || key === "cafeteriaSeconds") && typeof locationObservation(row.summary)?.[key] === "number" ? <span className="mt-1 block max-w-48 whitespace-normal text-xs text-amber-900" title={locationObservation(row.summary)?.reason}>Observado · cobertura parcial{key === "cafeteriaSeconds" && Number(locationObservation(row.summary)?.cafeteriaWithinSuggestedRestSeconds) > 0 ? " · inclui período sem intervalo no ponto" : ""}</span> : null}{workObservation(row.summary) && (key === "workedSeconds" || key === "restSeconds") ? <span className={`mt-1 block max-w-48 whitespace-normal text-xs ${workObservation(row.summary)?.basis === "turnstile-suggestion" ? "text-red-700" : "text-slate-600"}`} title={workObservation(row.summary)?.reason}>{key === "restSeconds" ? workObservation(row.summary)?.restBasis === "turnstile-suggestion" ? "Intervalo sugerido · torniquete" : workObservation(row.summary)?.restBasis === "clock" ? "Descanso registrado" : "Sem descanso registrado" : workObservation(row.summary)?.basis === "turnstile-suggestion" ? "Sugerido · torniquete" : "Observado · entrada e saída"}</span> : null}</>}</td>)}
    <td className="px-4 py-3"><button className={buttonClass} onClick={()=>onDetails(row.employeeId,row.date)} aria-label={`Detalhes de ${row.name}${child?` em ${calendarDate(row.date)}`:""}`}>Ver detalhes</button></td>
  </tr>;
  const groupRow=(group:MonitoringGroup)=>{
    const open=expanded.has(group.employeeId),days=sortMonitoringRows(byEmployee.get(group.employeeId)??[],orderBy==="name"?"date":orderBy,direction);
    const id=`monitoring-days-${group.employeeId}`;
    return <Fragment key={group.employeeId}><tbody className="divide-y divide-slate-100">
      <tr className="border-t border-slate-200 hover:bg-slate-50" data-testid="monitoring-employee-summary">
        <th scope="row" className="px-4 py-3 text-left font-normal"><div className="flex items-center gap-2"><button type="button" className={`${buttonClass} h-11 w-11 shrink-0 p-0`} aria-expanded={open} aria-controls={id} aria-label={`${open?"Recolher":"Expandir"} dias de ${group.name}`} onClick={()=>setExpanded(current=>{const next=new Set(current);if(next.has(group.employeeId))next.delete(group.employeeId);else next.add(group.employeeId);return next;})}>{open?<Minus size={16} aria-hidden/>:<Plus size={16} aria-hidden/>}</button><Person row={group}/></div></th>
        <td className="px-4 py-3"><b>{group.assessedDays} de {group.totalDays}</b><span className="mt-1 block text-xs text-slate-500">dias com trabalho apurado</span>{Number(group.summary?.observedDays)>0?<span className="mt-1 block text-xs text-amber-900">{Number(group.summary?.observedDays)} com cálculo observado; {Number(group.summary?.turnstileDays)} sugerido(s) pelo torniquete</span>:null}</td>
        <td className="px-4 py-3"><Quality value={group.quality}/>{group.pendingDays?<span className="mt-1 block text-xs text-amber-900">{group.pendingDays} dia(s) pendente(s)</span>:null}</td>
        {metrics.map(key=><td className="whitespace-nowrap px-4 py-3" key={key}><b>{metricValue(group.summary,key)}</b><span className="mt-1 block text-xs text-slate-500">{group.metricDays[key]??0} de {group.totalDays} dias</span>{Number(group.summary?.[`${key}ObservedDays`]) > 0 ? <span className="mt-1 block max-w-48 whitespace-normal text-xs text-amber-900">{Number(group.summary?.[`${key}ObservedDays`])} com tempo observado parcial</span> : null}</td>)}
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
    <details className="border-t border-slate-200 px-4 py-3 text-xs leading-relaxed text-slate-600"><summary className="cursor-pointer font-semibold text-blue-900">Por que um valor aparece como “Não apurável”?</summary><p className="mt-2">O cálculo observado entre entrada e saída não comprova ausência de pausa. “Sem descanso registrado” informa a falta de marcação do intervalo. Horários sugeridos pelo torniquete aparecem em vermelho com a origem; o maior período entre saída e retorno à operação pode sugerir o intervalo, sem comprovar descanso; não altera o relógio de ponto ou o banco de horas. Tempos observados usam pares fechados de leitores validados, mesmo sem jornada confirmada ou horário padrão. Fora da operação desconta a união do intervalo registrado e sugerido, sem duplicar. Refeitório desconta somente intervalo marcado no ponto: o tempo dentro de intervalo apenas sugerido continua contado. Cobertura parcial não comprova todo o período; indicadores oficiais mantêm suas regras. Abra “Ver detalhes” para conferir a pendência. Ausência de evidência não recebe duração zero.</p></details>
  </section>;
}
