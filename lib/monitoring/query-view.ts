import type { MonitoringFilters, MonitoringGroup, MonitoringRow, MonitoringSnapshot } from "./contracts";

export const monitoringSortKeys = ["name", "date", "quality", "workedSeconds", "outsideSeconds", "cafeteriaSeconds", "mealsWithoutRest", "lateSeconds"] as const;
export type MonitoringSortKey = typeof monitoringSortKeys[number];
const metrics = ["workedSeconds", "restSeconds", "outsideSeconds", "cafeteriaSeconds", "mealsWithoutRest", "lateSeconds", "unknownSeconds"];
const qualityNames: Record<string,string> = {complete:"Completa",partial:"Parcial",unavailable:"Não apurável",pending:"Pendente",excluded:"Excluída por regra",stale:"Recalcular"};
const collator = new Intl.Collator("pt-BR", {numeric:true,sensitivity:"base"});
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Missing/dirty days never become zero. Every group is assembled before pagination. */
export function monitoringGroups(rows: readonly MonitoringRow[]): MonitoringGroup[] {
  const grouped = new Map<string, MonitoringRow[]>();
  for (const row of rows) grouped.set(row.employeeId, [...grouped.get(row.employeeId) ?? [], row]);
  return [...grouped.values()].map(days => {
    const first = days[0];
    const summary: Record<string,unknown> = {};
    const metricDays: Record<string,number> = {};
    for (const key of metrics) {
      const known = days.filter(row => !row.dirty && row.quality !== "stale" && finite(row.summary?.[key]));
      metricDays[key] = known.length;
      summary[key] = known.length ? known.reduce((sum,row)=>sum + (row.summary![key] as number),0) : null;
    }
    const assessedDays = metricDays.workedSeconds;
    for (const [metric,quality] of [["outsideSeconds","outsideQuality"],["cafeteriaSeconds","cafeteriaQuality"],["mealsWithoutRest","mealQuality"]]) {
      if (days.length && days.every(day => !day.dirty && day.quality !== "stale" && day.summary?.[quality] === "excluded")) summary[quality] = "excluded";
      else if (metricDays[metric]) summary[quality] = "partial";
    }
    const dirty = days.some(day=>day.dirty || day.quality === "stale");
    const quality = dirty ? "stale" : days.every(day=>day.quality === "complete") ? "complete"
      : days.every(day=>day.quality === "excluded") ? "excluded" : assessedDays || Object.values(metricDays).some(Boolean) ? "partial"
        : days.some(day=>day.quality === "pending") ? "pending" : "unavailable";
    const dates = days.flatMap(day=>day.date ? [day.date] : []).sort();
    return {...first,date:null,computedAt:null,ruleVersion:null,quality,dirty,summary,metricDays,totalDays:dates.length,assessedDays,
      pendingDays:days.filter(day=>["pending","unavailable","stale"].includes(day.quality)).length,firstDate:dates[0] ?? null};
  });
}

export function sortMonitoringRows<T extends MonitoringRow>(rows: readonly T[], orderBy: MonitoringSortKey = "name", direction: "asc"|"desc" = "asc", grouped = false): T[] {
  const value = (row:T):string|number|null => orderBy === "name" ? row.name : orderBy === "quality" ? qualityNames[row.quality] ?? row.quality
    : orderBy === "date" ? grouped ? (row as unknown as MonitoringGroup).assessedDays : row.date
      : !grouped && (row.dirty || row.quality === "stale") ? null : finite(row.summary?.[orderBy]) ? row.summary![orderBy] as number : null;
  return [...rows].sort((a,b)=>{
    const left=value(a),right=value(b);
    // Unavailable values remain last in both directions.
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    const comparison=typeof left === "number" && typeof right === "number" ? left-right : left !== null && right !== null ? collator.compare(String(left),String(right)) : 0;
    return comparison*(direction === "asc" ? 1 : -1) || collator.compare(a.name,b.name) || a.employeeId.localeCompare(b.employeeId) || (a.date??"").localeCompare(b.date??"");
  });
}

export function monitoringQueryView(snapshot: MonitoringSnapshot, filters: MonitoringFilters): MonitoringSnapshot {
  // Build filter lists from the complete authorized dataset before pagination.
  snapshot = { ...snapshot, options: {
    units: snapshot.options?.units ?? [...new Set(snapshot.rows.map(row => row.unit))],
    managers: snapshot.options?.managers ?? [],
    employees: [...new Map(snapshot.rows.map(row => [row.employeeId, { id: row.employeeId, name: row.name, employeeNumber: row.employeeNumber }])).values()].sort((a, b) => collator.compare(a.name, b.name)),
    schedules: [...new Set(snapshot.rows.flatMap(row => typeof row.summary?.scheduleName === "string" && row.summary.scheduleName ? [row.summary.scheduleName] : []))].sort(collator.compare),
  } };
  const grouped=filters.start !== filters.end;
  if (!grouped) return {...snapshot,grouped:false,recordTotal:snapshot.total,rows:sortMonitoringRows(snapshot.rows,filters.orderBy,filters.direction).slice(filters.offset,filters.offset+filters.limit)};
  const groups=sortMonitoringRows(monitoringGroups(snapshot.rows),filters.orderBy,filters.direction,true);
  const page=groups.slice(filters.offset,filters.offset+filters.limit);
  const ids=new Set(page.map(group=>group.employeeId));
  return {...snapshot,grouped:true,recordTotal:snapshot.total,total:groups.length,groups:page,
    rows:snapshot.rows.filter(row=>ids.has(row.employeeId)).sort((a,b)=>(a.date??"").localeCompare(b.date??"")||a.employeeId.localeCompare(b.employeeId))};
}

type ReadSnapshot = (filters: MonitoringFilters,signal?:AbortSignal)=>Promise<MonitoringSnapshot>;
/** Rows, totals and version must come from one authorized SQL snapshot. */
export async function readCompleteMonitoring(filters: MonitoringFilters, readSnapshot: ReadSnapshot, signal?: AbortSignal): Promise<MonitoringSnapshot> {
  signal?.throwIfAborted();
  const snapshot=await readSnapshot({...filters,offset:0,limit:500},signal);
  signal?.throwIfAborted();
  if (snapshot.total>200_000) throw Object.assign(new Error("MONITORING_PERIOD_TOO_LARGE"),{code:"MONITORING_PERIOD_TOO_LARGE"});
  if (!snapshot.datasetVersion || snapshot.rows.length!==snapshot.total
    || new Set(snapshot.rows.map(row=>`${row.employeeId}|${row.date}`)).size!==snapshot.rows.length) {
    throw Object.assign(new Error("MONITORING_INCOMPLETE_PAGE"),{code:"MONITORING_INCOMPLETE_PAGE"});
  }
  return snapshot;
}
