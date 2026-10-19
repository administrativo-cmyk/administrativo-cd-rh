import { describe, expect, it } from "vitest";
import { assessBankDay } from "./bank-day";
import { preparePunches, DEFAULT_REPETITION_POLICY, type AccessPointMapping, type PunchEvent } from "./domain";
const at = (time: string) => Date.parse(`2026-10-02T${time}:00-03:00`);
const punch = (time: string, i: number, sourceId = i % 2 ? "cpf" : "pis"): PunchEvent => ({ id: String(i), personId: "employee", at: at(time), sourceId, precision: "second" });
const input = (times: string[]) => ({ date: "2026-10-02", punches: times.map((time, i) => punch(time, i)), accesses: [], mappings: [],
  schedule: { start: at("08:00"), end: at("17:00"), lunchMinutes: 60, confirmed: true }, closed: true, collectionComplete: true, protected: false, conflicted: false });
describe("one logical clock and daily bank arithmetic", () => {
  it("pairs interleaved CPF/PIS punches as one day", () => {
    const day = assessBankDay(input(["08:00", "12:00", "13:00", "18:00"]));
    expect(day).toMatchObject({ state: "ready", expectedMinutes: 480, workedMinutes: 540, deltaMinutes: 60 });
    expect(new Set(day.punches.map(p => p.sourceId)).size).toBe(2);
  });
  it("two marks always deduct one hour of lunch, then scheduled shortfall", () => {
    expect(assessBankDay(input(["08:00", "12:00"]))).toMatchObject({ workedMinutes: 180, deltaMinutes: -300, state: "ready" });
    expect(assessBankDay(input(["08:00", "08:30"]))).toMatchObject({ workedMinutes: 0, deltaMinutes: -480 });
  });
  it("three marks keep the inferred missing slot blank and all bank values pending", () => {
    const day = assessBankDay(input(["08:00", "12:00", "17:00"]));
    expect(day.state).toBe("pending"); expect(day.deltaMinutes).toBeNull(); expect(day.missingRole).toBe("breakEnd");
    expect(day.slots[2]).toEqual({ role: "breakEnd", at: null });
  });
  it("proposes only an identified authorized mapped entry, preserving the missing punch", () => {
    const mapping: AccessPointMapping = { id: "mapping", pointId: "Torniquete entrada", portalId: "principal", area: "perimeter", direction: "entry", validated: true, eventClasses: ["Rosto"], validFrom: "2026-01-01" };
    const event = { id: "entry", personId: "employee", at: at("13:00"), pointId: mapping.pointId, sourceId: "defense", eventClass: "Rosto", authorized: true, identified: true };
    const day = assessBankDay({ ...input(["08:00", "12:00", "17:00"]), mappings: [mapping], accesses: [event, { ...event, id: "denied", authorized: false }, { ...event, id: "anonymous", identified: false }] });
    expect(day.suggestions.map(s => s.eventId)).toEqual(["entry"]);
    expect(day.deltaMinutes).toBeNull(); expect(day.slots[2].at).toBeNull();
  });
  it("anchors a missing lunch return to the actual recorded exit plus one hour", () => {
    const mapping: AccessPointMapping = { id:"mapping",pointId:"Torniquete",portalId:"operacao",area:"operation",direction:"entry",validated:true,eventClasses:["Rosto"],validFrom:"2026-01-01" };
    const value=input(["08:00","10:00","18:00"]);value.schedule.end=at("18:00");
    const day=assessBankDay({...value,mappings:[mapping],accesses:[{id:"early-lunch",personId:"employee",at:at("11:00"),pointId:"Torniquete",sourceId:"defense",eventClass:"Rosto",authorized:true,identified:true}]});
    expect(day.missingRole).toBe("breakEnd");expect(day.suggestions.map(s=>s.eventId)).toEqual(["early-lunch"]);expect(day.deltaMinutes).toBeNull();
  });
  it.each(["closed", "collectionComplete"] as const)("blocks incomplete evidence: %s", key => {
    expect(assessBankDay({ ...input(["08:00", "17:00"]), [key]: false }).deltaMinutes).toBeNull();
  });
  it.each(["protected", "conflicted"] as const)("protects %s days", key => {
    expect(assessBankDay({ ...input(["08:00", "17:00"]), [key]: true }).deltaMinutes).toBeNull();
  });
  it("handles a night shift on its entry date", () => {
    const value = input([]); const next = (time: string) => Date.parse(`2026-10-03T${time}:00-03:00`);
    const day = assessBankDay({ ...value, schedule: { start: at("22:00"), end: next("06:20"), lunchMinutes: 60, confirmed: true }, punches: [punch("22:00", 0), { ...punch("06:20", 1), at: next("06:20") }] });
    expect(day).toMatchObject({ state: "ready", expectedMinutes: 440, workedMinutes: 440, deltaMinutes: 0 });
  });
  it("suppresses only equivalent cross-clock instants, retaining adjacent real punches", () => {
    const original = [punch("08:00", 1, "pis"), punch("08:00", 2, "cpf"), punch("12:00", 3, "cpf")];
    const result = preparePunches(original, DEFAULT_REPETITION_POLICY);
    expect(original).toHaveLength(3); expect(result.events).toHaveLength(2); expect(result.suppressions).toHaveLength(1);
    expect(result.suppressions[0].ruleVersion).toBe("cross-clock-1.0.0");
    expect(preparePunches([punch("08:00", 1), punch("08:01", 2)], DEFAULT_REPETITION_POLICY).events).toHaveLength(2);
  });
});
