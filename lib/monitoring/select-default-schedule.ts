import { STANDARD_SCHEDULES, standardPayload, durationMinutes, applyWeeklyRest } from "./schedule-standards.ts";
import type { ObservedSchedule } from "./schedule-inference.ts";
const normalized = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
const minute = (s: string) => Number(s.slice(0,2))*60+Number(s.slice(3));
const distance = (a: string,b: string) => Math.min(Math.abs(minute(a)-minute(b)),1440-Math.abs(minute(a)-minute(b)));
export function scheduleFamily(employee: { role: string | null; department: string | null }) {
  const role=normalized(employee.role ?? ""); const department=normalized(employee.department ?? "");
  if (role.includes("MENOR")) return "minor";
  if (/APRENDIZ|ESTAGIARIO/.test(role)) return "young";
  if (/MANUTENCAO/.test(`${role} ${department}`)) return "maintenance";
  if (/PREVENCAO|\bAPP\b/.test(`${role} ${department}`)) return "app";
  if (/ADMINISTRATIVO|^ADM CD|RECRUTAMENTO/.test(department)) return "administrative";
  if (/ARMAZENISTA/.test(role) || /REFEITORIO|CONSERVACAO|ARMAZENAMENTO|OPERACAO|EMPILHADEIRA|CONFERENCIA|SEPARACAO|CARGA|RECEBIMENTO DE MERCADORIAS|RESFRIADO|AVARIA/.test(department)) return "operational";
  return null;
}
/** Modal observed standard; ties and incompatible cycles remain reviewable, never guessed. */
function selectOfficialSchedule(employee: { role: string | null; department: string | null }, pattern: ObservedSchedule | null) {
  const family=scheduleFamily(employee);
  if (!pattern || !family) return { state: "review" as const, reason: "Categoria ou batidas insuficientes", payload: null, matchedDates: [] as string[] };
  const candidates=STANDARD_SCHEDULES.filter(s=>s.family===family).map(s=>({standard:s,dates:pattern.dailyObservations.filter(d=>
    distance(d.start,s.start)<=30 && distance(d.end,s.end)<=60 && Math.abs(durationMinutes(d.start,d.end)-durationMinutes(s.start,s.end))<=75).map(d=>d.date)}))
    .sort((a,b)=>b.dates.length-a.dates.length);
  const winner=candidates[0];
  if (!winner || winner.dates.length<3 || winner.dates.length/Math.max(1,pattern.dailyObservations.length)<0.5 || (candidates[1] && candidates[1].dates.length===winner.dates.length))
    return { state: "review" as const, reason: "Padrão sem predominância suficiente", payload: null, matchedDates: winner?.dates ?? [] };
  const payload: ReturnType<typeof standardPayload> & {cycle?:{kind:"12x36";anchorDate:string}}=standardPayload(winner.standard.id);
  if (family==="app") {
    const dates=[...winner.dates].sort();const base=Date.parse(dates[0]);
    const samePhase=dates.every(d=>Math.round((Date.parse(d)-base)/86400000)%2===0);
    if (dates.length>=4 && samePhase && Date.parse(dates.at(-1)!)-base>=6*86400000) {
      payload.cycle={kind:"12x36",anchorDate:dates[0]};payload.weeklyRosterConfirmed=true;
    }
  }
  return {state:"selected" as const,reason:`Padrão mais frequente: ${winner.dates.length}/${pattern.dailyObservations.length} jornadas completas`,payload,matchedDates:winner.dates};
}

export function selectDefaultSchedule(employee: {role:string|null;department:string|null},pattern:ObservedSchedule|null) {
 const selected=selectOfficialSchedule(employee,pattern);
 if(selected.state==="selected" || pattern?.status!=="recurring" || !pattern.start || !pattern.end) return selected;
 return {state:"estimated" as const,reason:`Horário fora dos padrões fornecidos; recorrente em ${pattern.matchingDays}/${pattern.daysObserved} jornadas. Conferir entrada/saída e folgas.`,matchedDates:pattern.matchingDates,
 payload:applyWeeklyRest({name:`Horário observado ${pattern.start}–${pattern.end}`,start:pattern.start,end:pattern.end,days:[0,1,2,3,4,5,6],lunchMinutes:60 as const,weeklyRosterConfirmed:false,estimated:true,allowNoBreak:false as const,pairing:"alternating" as const,coffeeWindows:[] as never[],monthlySundayOff:false,monthlySundayOffDates:[] as string[]})};
}
