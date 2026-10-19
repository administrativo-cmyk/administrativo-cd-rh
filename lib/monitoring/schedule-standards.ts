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
export type ScheduleDefinition = { name:string;start:string;end:string;days:number[];lunchMinutes:60;weeklyRosterConfirmed:boolean;estimated:boolean;allowNoBreak:false;pairing:"alternating";coffeeWindows:never[];cycle?:{kind:"12x36";anchorDate:string};monthlySundayOff?:boolean;monthlySundayOffDates?:string[] };
export function rosterState(payload: { days:number[];cycle?:{kind:"12x36";anchorDate:string};monthlySundayOff?:boolean;monthlySundayOffDates?:string[] },date:string): "work"|"off"|"pending" {
 const weekday=new Date(`${date}T12:00:00Z`).getUTCDay();
 if(!payload.days.includes(weekday)) return "off";
 if(payload.cycle && Math.abs(Math.round((Date.parse(date)-Date.parse(payload.cycle.anchorDate))/86400000))%2!==0) return "off";
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
  return { name: item.name, start: item.start, end: item.end, days, lunchMinutes: 60, monthlySundayOff: night && item.family!=="app", monthlySundayOffDates: [], weeklyRosterConfirmed: item.family!=="app", estimated: false, allowNoBreak: false, pairing: "alternating", coffeeWindows: [] };
}
