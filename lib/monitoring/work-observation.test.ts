import { describe, expect, it } from "vitest";
import { observeIncompleteWork } from "./work-observation";
import type { AccessEvent, AccessPointMapping, PunchEvent } from "./domain";
const date = "2026-10-21", employeeId = "person";
const at = (time: string, day = date) => Date.parse(`${day}T${time}:00-03:00`);
const punch = (time: string, day = date): PunchEvent => ({ id: `p-${day}-${time}`, at: at(time, day), personId: employeeId, sourceId: "rep", precision: "minute" });
const access = (time: string, direction: "entry" | "exit" = "exit", day = date): AccessEvent => ({ id: `a-${day}-${time}`, at: at(time, day), personId: employeeId, sourceId: "defense", pointId: direction, eventClass: "face", authorized: true, identified: true });
const mappings: AccessPointMapping[] = ["entry", "exit"].map(direction => ({ id: direction, pointId: direction, portalId: "turnstile", area: "operation", direction: direction as "entry" | "exit", validated: true, eventClasses: ["face"], validFrom: "2026-10-01" }));
const input = () => ({ employeeId, date, punches: [punch("10:00")], accesses: [access("13:00"), access("17:00"), access("18:12")], mappings,
  window: { start: at("02:00"), end: at("02:00", "2026-10-22") }, schedule: { start: at("10:00"), end: at("18:20") }, referenceAt: at("12:00", "2026-10-23") });
describe("observação auxiliar de jornadas incompletas", () => {
  it("desconta o maior intervalo saída/retorno e sugere só as duas marcações faltantes", () => {
    const raw = { ...input(), punches: [punch("10:00"),punch("18:00")], accesses: [access("11:00"),access("11:20","entry"),access("12:05"),access("14:02","entry"),access("16:00"),access("16:30","entry")] };
    const copy=structuredClone(raw), result=observeIncompleteWork(raw)!;
    expect(result.restSuggestion).toMatchObject({start:at("12:05"),end:at("14:02"),outsideSeconds:117*60});
    expect(result.workedSeconds).toBe(8*3600-117*60);
    expect(result.suggestedMarks?.map(m=>m.role)).toEqual(["breakStart","breakEnd"]);
    expect(raw).toEqual(copy);
  });
  it.each(["breakStart","breakEnd","end","start"] as const)("preenche somente %s quando existem três batidas", missing => {
    const times={start:"10:00",breakStart:"12:00",breakEnd:"13:00",end:"18:00"};
    const raw={...input(),punches:(Object.entries(times) as Array<[keyof typeof times,string]>).filter(([role])=>role!==missing).map(([role,time])=>({...punch(time),role})),accesses:[access("09:59","entry"),access("12:00"),access("13:00","entry"),access("18:00")]};
    const result=observeIncompleteWork(raw)!;
    expect(result.suggestedMarks).toHaveLength(1);expect(result.suggestedMarks![0].role).toBe(missing);
    expect(result.restSeconds).toBe(3600);
  });
  it("usa a função faltante identificada pelo banco sem atribuir funções às batidas originais", () => {
    const raw={...input(),punches:[punch("10:00"),punch("12:00"),punch("18:00")],missingRole:"breakEnd" as const,
      slots:[{role:"start" as const,at:at("10:00")},{role:"breakStart" as const,at:at("12:00")},{role:"breakEnd" as const,at:null},{role:"end" as const,at:at("18:00")}],
      accesses:[access("12:00"),access("13:00","entry")]};
    const original=structuredClone(raw),result=observeIncompleteWork(raw)!;
    expect(result.suggestedMarks?.map(m=>m.role)).toEqual(["breakEnd"]);expect(result.restSeconds).toBe(3600);expect(raw).toEqual(original);
  });
  it("não sugere nada com quatro ou seis marcações, nem com par saída/retorno aberto", () => {
    expect(observeIncompleteWork({...input(),punches:["10:00","12:00","13:00","18:00"].map(t=>punch(t))})).toBeNull();
    expect(observeIncompleteWork({...input(),punches:["10:00","11:00","11:15","12:00","13:00","18:00"].map(t=>punch(t))})).toBeNull();
    const result=observeIncompleteWork({...input(),punches:[punch("10:00"),punch("18:00")],accesses:[access("12:00")]});
    expect(result?.restSuggestion).toBeUndefined();expect(result?.suggestedMarks).toEqual([]);
  });
  it("não fecha a saída final enquanto a janela operacional ainda está aberta", () => {
    expect(observeIncompleteWork({...input(),referenceAt:at("23:00")})).toBeNull();
  });
  it("exclui saída sem retorno e leituras muito curtas da sugestão de descanso", () => {
    const result=observeIncompleteWork({...input(),punches:[punch("10:00"),punch("18:00")],accesses:[access("12:00"),access("12:05","entry"),access("17:00")]});
    expect(result?.restSuggestion).toBeUndefined();
  });
  it("calcula entrada e saída reais sem inventar descanso ou mudar os dados", () => {
    const raw = { ...input(), punches: [punch("09:52"), punch("18:00")] }, original = structuredClone(raw);
    expect(observeIncompleteWork(raw)).toMatchObject({ workedSeconds: 8 * 3600 + 8 * 60, restSeconds: 0, basis: "clock-pair" });
    expect(raw).toEqual(original);
  });
  it("trata a mesma leitura nos relógios CPF/PIS como uma marca lógica", () => {
    const start=punch("10:00"),end=punch("18:00");
    const result=observeIncompleteWork({...input(),punches:[start,{...start,id:"other-start",sourceId:"pis"},end,{...end,id:"other-end",sourceId:"pis"}]});
    expect(result?.workedSeconds).toBe(8*3600);expect(result?.suggestedMarks).toEqual([]);
  });
  it("sugere a última saída válida da operação, com proveniência", () => {
    expect(observeIncompleteWork(input())).toMatchObject({ basis: "turnstile-suggestion", workedSeconds: 8 * 3600 + 12 * 60, exitSuggestion: { at: at("18:12"), eventId: "a-2026-10-21-18:12", pointId: "exit", sourceId: "defense" } });
  });
  it("não usa saída anterior se houve retorno posterior", () => expect(observeIncompleteWork({ ...input(), accesses: [...input().accesses, access("18:15", "entry")] })).toBeNull());
  it("não encerra o expediente ainda aberto com a saída de almoço", () => expect(observeIncompleteWork({ ...input(), referenceAt: at("17:30"), accesses: [access("13:00")] })).toBeNull());
  it.each(["denied", "anonymous", "manual", "unvalidated", "perimeter", "expired", "other-person"])("não usa acesso %s", kind => {
    const raw = input(); raw.accesses = [access("18:00")]; raw.mappings = structuredClone(mappings);
    if (kind === "denied") raw.accesses[0].authorized = false;
    if (kind === "anonymous") raw.accesses[0].identified = false;
    if (kind === "manual") raw.accesses[0].provenance = { sourceId: "manual", origin: "manual" };
    if (kind === "unvalidated") raw.mappings.forEach(m => m.validated = false);
    if (kind === "perimeter") raw.mappings.forEach(m => m.area = "perimeter");
    if (kind === "expired") raw.mappings.forEach(m => m.validTo = "2026-10-20");
    if (kind === "other-person") raw.accesses[0].personId = "other";
    expect(observeIncompleteWork(raw)).toBeNull();
  });
  it("respeita meia-noite na jornada noturna e exclui o próximo turno", () => {
    const raw = { ...input(), punches: [punch("22:00")], schedule: { start: at("22:00"), end: at("06:20", "2026-10-22") }, window: { start: at("14:10"), end: at("14:10", "2026-10-22") }, accesses: [access("06:18", "exit", "2026-10-22"), access("18:00", "exit", "2026-10-22")] };
    expect(observeIncompleteWork(raw)?.exitSuggestion?.at).toBe(at("06:18", "2026-10-22"));
  });
  it("não transforma uma marca de intervalo em entrada nem completa três batidas", () => {
    expect(observeIncompleteWork({ ...input(), punches: [{ ...punch("10:00"), role: "breakEnd" }] })).toBeNull();
    expect(observeIncompleteWork({ ...input(), punches: [punch("10:00"), punch("13:00"), punch("18:00")] })).toBeNull();
  });
});
