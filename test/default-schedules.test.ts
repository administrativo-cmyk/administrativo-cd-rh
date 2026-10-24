import { describe, expect, it } from "vitest";
import { defaultSchedulePayloadSchema, standardPayload, STANDARD_SCHEDULES, rosterState } from "../lib/monitoring/standard-schedules";
import { selectDefaultSchedule } from "../lib/monitoring/select-default-schedule";
import { inferObservedSchedules, type PatternPunch } from "../lib/monitoring/schedule-inference";
function pattern(hours=["06:00","10:00","11:00","14:20"]) {
  const punches:PatternPunch[]=[1,2,5,6,7,8,9,12].flatMap(day=>hours.map((time,index)=>({id:`${day}-${index}`,employeeId:"synthetic",sourceId:"cpf",timestamp:`2026-10-${String(day).padStart(2,"0")}T${time}:00-03:00`,eligible:true,conflicted:false})));
  return inferObservedSchedules(punches,"2026-10-01T00:00:00-03:00","2026-10-13T00:00:00-03:00")[0];
}
describe("Padrões e folgas informados pela operação",()=>{
  it("todos os onze padrões têm uma hora de almoço",()=>{expect(STANDARD_SCHEDULES).toHaveLength(11);for(const s of STANDARD_SCHEDULES) expect(defaultSchedulePayloadSchema.parse(standardPayload(s.id)).lunchMinutes).toBe(60);});
  it.each(["administrative","young-08","young-11","minor"])("%s trabalha somente segunda a sexta",id=>{expect(standardPayload(id).days).toEqual([1,2,3,4,5]);});
  it("diurno folga domingo; manutenção trabalha sábado",()=>{expect(standardPayload("operational-06").days).toEqual([1,2,3,4,5,6]);expect(standardPayload("maintenance").days).toEqual([1,2,3,4,5,6]);});
  it("noturno folga sábado e aguarda perfil e referência da alternância",()=>{
    const p=standardPayload("operational-22");expect(rosterState(p,"2026-10-03")).toBe("off");expect(rosterState(p,"2026-10-04")).toBe("pending");
    p.weeklyRest={kind:"night-women",sundayOffAnchor:"2026-10-04"};expect(rosterState(p,"2026-10-04")).toBe("off");expect(rosterState(p,"2026-10-11")).toBe("work");expect(rosterState(p,"2026-11-01")).toBe("off");
  });
  it("APP mantém 12x36 sem impor domingo de folga",()=>{const p={...standardPayload("app-night"),weeklyRosterConfirmed:true,cycle:{kind:"12x36" as const,anchorDate:"2026-10-01"}};expect(rosterState(p,"2026-10-01")).toBe("work");expect(rosterState(p,"2026-10-02")).toBe("off");expect(rosterState(p,"2026-10-03")).toBe("work");});
  it("seleciona o padrão mais repetido e mantém diferenças fora do padrão em revisão",()=>{
    const selected=selectDefaultSchedule({role:"ARMAZENISTA",department:"OPERAÇÃO"},pattern());expect(selected.payload).toMatchObject({start:"06:00",end:"14:20",estimated:false,weeklyRosterConfirmed:true});
    expect(selectDefaultSchedule({role:"ARMAZENISTA",department:"OPERAÇÃO"},pattern(["08:00","12:00","13:00","18:00"])).state).toBe("estimated");
  });
  it("rejeita domingo mensal em dia de semana ou duas folgas no mesmo mês",()=>{
    const p=standardPayload("operational-22");expect(defaultSchedulePayloadSchema.safeParse({...p,monthlySundayOffDates:["2026-10-05"]}).success).toBe(false);
    expect(defaultSchedulePayloadSchema.safeParse({...p,monthlySundayOffDates:["2026-10-04","2026-10-11"]}).success).toBe(false);
  });
});
