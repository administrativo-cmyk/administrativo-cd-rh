import { describe, expect, it } from "vitest";
import { observeLocations, unscheduledObservationWindow } from "./location-observation";
import { observeIncompleteWork } from "./work-observation";
import type { AccessEvent, AccessPointMapping, PunchEvent } from "./domain";
const date = "2026-10-22", employeeId = "person";
const at = (time: string, day = date) => Date.parse(`${day}T${time}-03:00`);
const punch = (time: string, day = date): PunchEvent => ({ id: `p-${day}-${time}`, personId: employeeId, sourceId: "rep", precision: "second", at: at(time, day) });
const access = (time: string, area: "operation" | "cafeteria", direction: "entry" | "exit"): AccessEvent => ({ id: `${area}-${direction}-${time}`, personId: employeeId, sourceId: "access", at: at(time), pointId: `${area}-${direction}`, eventClass: "face", authorized: true, identified: true });
const mappings: AccessPointMapping[] = (["operation", "cafeteria"] as const).flatMap(area => (["entry", "exit"] as const).map(direction => ({ id: `${area}-${direction}`, pointId: `${area}-${direction}`, area, direction, portalId: area, validated: true, eventClasses: ["face"], validFrom: "2026-10-01" })));
const base = () => ({ employeeId, date, mappings, window: { start: at("00:00:00"), end: at("00:00:00", "2026-10-23") }, referenceAt: at("00:00:00", "2026-10-24"), punches: [punch("10:10:00")],
  accesses: [access("10:07:23", "operation", "entry"), access("10:10:24", "operation", "exit"), access("10:11:56", "operation", "entry"), access("12:26:03", "operation", "exit"), access("12:26:31", "cafeteria", "entry"), access("12:57:51", "cafeteria", "exit"), access("14:01:54", "operation", "entry"), access("18:20:11", "operation", "exit")] });
describe("tempos observados sem depender da jornada oficial", () => {
  it("Lucas: desconta descanso sugerido só de fora da operação; mantém refeitório sem ponto de intervalo", () => {
    const input = base(), original = structuredClone(input);
    const workObservation = observeIncompleteWork({ ...input, schedule: null })!;
    expect(workObservation.restSeconds).toBe(5751);
    const result = observeLocations({ ...input, workObservation })!;
    expect(result).toMatchObject({ quality: "observed-partial", outsideGrossSeconds: 5843, outsideSeconds: 92, cafeteriaSeconds: 1880, cafeteriaWithinSuggestedRestSeconds: 1880 });
    expect(input).toEqual(original);
  });
  it("desconta somente a sobreposição real do intervalo marcado no ponto", () => {
    const input = { ...base(), punches: ["10:00:00", "12:40:00", "13:40:00", "18:30:00"].map(t => punch(t)) };
    const result = observeLocations({ ...input, workObservation: null })!;
    expect(result.cafeteriaSeconds).toBe(809); // 12:26:31–12:40:00
    expect(result.outsideSeconds).toBe(5843 - 3600);
  });
  it("subtrai a união de intervalos sobrepostos uma única vez", () => {
    const input = { ...base(), punches: ["10:00:00", "12:00:00", "13:00:00", "18:30:00"].map(t => punch(t)) };
    const workObservation = { workedSeconds: 1, restSeconds: 1, basis: "turnstile-suggestion" as const,
      span: { start: at("10:00:00"), end: at("18:30:00") }, reason: "test",
      restSuggestion: { start: at("12:30:00"), end: at("14:00:00"), exitEventId: "x", entryEventId: "y", outsideSeconds: 5400 } };
    const result = observeLocations({ ...input, workObservation })!;
    expect(result.outsideSeconds).toBe(92 + 114);
    expect(result.cafeteriaSeconds).toBe(0);
  });
  it("não transforma par ausente ou aberto em zero; par inteiramente descontado vale zero observado", () => {
    expect(observeLocations({ ...base(), accesses: [access("12:00:00", "cafeteria", "entry")], workObservation: null })).toBeNull();
    const result = observeLocations({ ...base(), accesses: [access("12:00:00", "cafeteria", "entry"), access("13:00:00", "cafeteria", "exit")], punches: ["10:00:00", "12:00:00", "13:00:00", "18:00:00"].map(t => punch(t)), workObservation: null })!;
    expect(result).toMatchObject({ outsideSeconds: null, cafeteriaSeconds: 0 });
  });
  it("calcula pares de acesso sem horário padrão e sem nenhuma batida de ponto", () => {
    expect(observeLocations({ ...base(), punches: [], workObservation: null })).toMatchObject({ outsideSeconds: 5843, cafeteriaSeconds: 1880 });
  });
  it.each(["denied", "anonymous", "manual", "unvalidated", "conflicting-directions"])("não usa acesso %s", kind => {
    const input = base();
    input.accesses = [access("12:00:00", "cafeteria", "entry"), access("13:00:00", "cafeteria", "exit")];
    if (kind === "denied") input.accesses[0].authorized = false;
    if (kind === "anonymous") input.accesses[0].identified = false;
    if (kind === "manual") input.accesses[0].provenance = { origin: "manual", sourceId: "manual" };
    if (kind === "unvalidated") input.mappings = input.mappings.map(m => ({ ...m, validated: false }));
    if (kind === "conflicting-directions") input.accesses.push(access("12:00:00", "cafeteria", "exit"));
    expect(observeLocations({ ...input, workObservation: null })).toBeNull();
  });
  it("Arthur: sugere intervalo entre duas batidas reais sem escala cadastrada", () => {
    const result = observeIncompleteWork({ ...base(), schedule: null, punches: [punch("10:28:00"), punch("17:07:00")], accesses: [access("12:05:43", "operation", "exit"), access("13:55:11", "operation", "entry")] })!;
    expect(result.restSeconds).toBe(6568);
    expect(result.suggestedMarks?.map(m => m.role)).toEqual(["breakStart", "breakEnd"]);
  });
  it("atribui sequência noturna à entrada sem duplicar batidas na manhã seguinte", () => {
    const punches = [punch("22:00:00"), punch("01:00:00", "2026-10-23"), punch("02:00:00", "2026-10-23"), punch("06:00:00", "2026-10-23")];
    expect(unscheduledObservationWindow(punches, date).punches).toEqual(punches);
    expect(unscheduledObservationWindow(punches, "2026-10-23").punches).toEqual([]);
  });
});
