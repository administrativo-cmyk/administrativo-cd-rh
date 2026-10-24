export const ALL_DAYS = [0,1,2,3,4,5,6];
export const STANDARD_SCHEDULES = [
  { id: "operational-06", family: "operational", name: "Operação / Refeitório / Conservação · 06h", start: "06:00", end: "14:20" },
  { id: "operational-10", family: "operational", name: "Operação / Refeitório / Conservação · 10h", start: "10:00", end: "18:20" },
  { id: "operational-14", family: "operational", name: "Operação / Refeitório / Conservação · 14h", start: "14:00", end: "22:20" },
  { id: "operational-22", family: "operational", name: "Operação / Refeitório / Conservação · 22h", start: "22:00", end: "06:20" },
  { id: "app-day", family: "app", name: "APP · 12×36 diurno", start: "07:00", end: "19:00" },
  { id: "app-night", family: "app", name: "APP · 12×36 noturno", start: "19:00", end: "07:00" },
  { id: "administrative", family: "administrative", name: "Administrativo · segunda a sexta", start: "08:00", end: "18:00" },
  { id: "young-08", family: "young", name: "Jovens · 08h", start: "08:00", end: "14:15" },
  { id: "young-11", family: "young", name: "Jovens · 11h", start: "11:00", end: "17:15" },
  { id: "minor", family: "minor", name: "Menor · 08h", start: "08:00", end: "12:00" },
  { id: "maintenance", family: "maintenance", name: "Manutenção · segunda a sábado", start: "08:00", end: "16:20" },
] as const;
export function durationMinutes(start: string, end: string) { const minutes = (s: string) => Number(s.slice(0,2))*60+Number(s.slice(3)); return (minutes(end)-minutes(start)+1440)%1440 || 1440; }
export type WeeklyRest = { kind: "day" | "night" | "night-women" | "night-pending"; sundayOffAnchor?: string };
export function isNightSchedule(payload:{start:string;end:string}) { return payload.end<payload.start; }
export type ScheduleDefinition = { name:string;start:string;end:string;days:number[];lunchMinutes:60;weeklyRosterConfirmed:boolean;estimated:boolean;allowNoBreak:false;pairing:"alternating";coffeeWindows:never[];cycle?:{kind:"12x36";anchorDate:string};monthlySundayOff?:boolean;monthlySundayOffDates?:string[];weeklyRest?:WeeklyRest };
/** Preserve confirmed 12x36 cycles and additional weekday restrictions. */
export function applyWeeklyRest<T extends {start:string;end:string;days:number[];cycle?:{kind:"12x36";anchorDate:string};weeklyRest?:WeeklyRest}>(payload:T):T {
 if(payload.cycle) { const result={...payload};delete result.weeklyRest;return result; }
 const night=isNightSchedule(payload);
 const weeklyRest:WeeklyRest=night && payload.weeklyRest && payload.weeklyRest.kind!=="day" ? payload.weeklyRest : {kind:night?"night-pending":"day"};
 return {...payload,days:night?[0,1,2,3,4,5]:payload.days.filter(day=>day!==0),weeklyRest,monthlySundayOff:false,monthlySundayOffDates:[]};
}
export function rosterState(payload: { days:number[];cycle?:{kind:"12x36";anchorDate:string};monthlySundayOff?:boolean;monthlySundayOffDates?:string[];weeklyRest?:WeeklyRest },date:string): "work"|"off"|"pending" {
 const weekday=new Date(`${date}T12:00:00Z`).getUTCDay();
 if(!payload.days.includes(weekday)) return "off";
 if(payload.cycle && Math.abs(Math.round((Date.parse(date)-Date.parse(payload.cycle.anchorDate))/86400000))%2!==0) return "off";
 if(!payload.cycle && payload.weeklyRest) {
  const rest=payload.weeklyRest;
  if(rest.kind==="day") return weekday===0?"off":"work";
  if(weekday===6) return "off";
  if(weekday===0 && rest.kind==="night-pending") return "pending";
  if(weekday===0 && rest.kind==="night-women") return !rest.sundayOffAnchor?"pending":Math.abs(Math.round((Date.parse(date)-Date.parse(rest.sundayOffAnchor))/86400000))%14===0?"off":"work";
  return "work";
 }
 if(payload.monthlySundayOff && weekday===0) {
  if(payload.monthlySundayOffDates?.includes(date)) return "off";
  if(!payload.monthlySundayOffDates?.some(d=>d.slice(0,7)===date.slice(0,7))) return "pending";
 }
 return "work";
}
export function scheduledOn(payload: Parameters<typeof rosterState>[0],date:string) {return rosterState(payload,date)!=="off";}
export function standardPayload(id: string): ScheduleDefinition {
  const item = STANDARD_SCHEDULES.find(s => s.id === id); if (!item) throw Error("UNKNOWN_STANDARD");
  const night=item.end<item.start;
  const days = ["administrative","young","minor"].includes(item.family) ? [1,2,3,4,5] : item.family === "app" ? [...ALL_DAYS] : night ? [0,1,2,3,4,5] : [1,2,3,4,5,6];
  const payload:ScheduleDefinition={ name: item.name, start: item.start, end: item.end, days, lunchMinutes: 60, monthlySundayOff: false, monthlySundayOffDates: [], weeklyRosterConfirmed: item.family!=="app", estimated: false, allowNoBreak: false, pairing: "alternating", coffeeWindows: [] };
  return item.family==="app"?payload:applyWeeklyRest(payload);
}
