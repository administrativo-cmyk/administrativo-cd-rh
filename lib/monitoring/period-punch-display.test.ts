import { describe, expect, it } from "vitest";
import { needsPeriodPunchReference, projectPeriodPunchDisplay } from "./period-punch-display";
import { reprocessMonitoringSnapshot } from "./reprocess";

const employeeId = "30000000-0000-4000-8000-000000000001";
const now = Date.parse("2026-10-23T12:00:00-03:00");
const payload = { name: "APP 12x36 noturno", start: "19:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6],
  lunchMinutes: 60, estimated: false, weeklyRosterConfirmed: true, cycle: { kind: "12x36" as const, anchorDate: "2026-10-01" },
  allowNoBreak: false, pairing: "alternating", coffeeWindows: [] };
const setting = { id: employeeId, kind: "schedule", target: employeeId, valid_from: "2026-09-29", valid_to: null,
  payload, reason: "Conferência sintética", created_by: null, created_at: "2026-10-19T12:00:00Z", revoked_at: null };
const reference = { id: employeeId, validFrom: setting.valid_from, validTo: null, updatedAt: setting.created_at, payload };
function fixture(times = ["2026-09-25T18:56", "2026-09-25T20:23", "2026-09-25T21:23", "2026-09-26T07:01"]) {
  return { version: 1, settings: [structuredClone(setting)], events: times.map((time, i) => ({
    id: `mark-${i}`, sourceId: "rep", eligible: true, conflicted: false,
    payload: { key: `mark-${i}`, type: "punch" as const, timestamp: `${time}:00-03:00`, device: "rep", classification: "authorized",
      eligible: true, precisionSeconds: 1, identity: { type: "cpf", value: "synthetic" }, original: {} },
  })) };
}
function history(raw: ReturnType<typeof fixture>, start = "2026-09-25", end = "2026-09-26") {
  return reprocessMonitoringSnapshot(raw, { employeeId, start, end, reason: "Conferência sintética" }, now)
    .map(day => ({ date: day.date, bankDay: day.summary.bankDay!, correctionVersion: null }));
}
const at = (time: string) => Date.parse(`${time}:00-03:00`);

describe("exibição das jornadas 12x36 anteriores à vigência", () => {
  it("reproduz 3+1 antes de 29/09 e agrupa sem alterar apuração ou dados brutos", () => {
    const raw = fixture(), days = history(raw);
    expect(days.map(day => day.bankDay.punches.length)).toEqual([3, 1]);
    const original = structuredClone({ raw, days });
    const projected = projectPeriodPunchDisplay(raw, days, employeeId, now);
    expect(projected[0].displayMarks?.map(mark => mark.at)).toEqual(raw.events.map(event => Date.parse(event.payload.timestamp)));
    expect(projected[1].displayMarks).toEqual([]);
    expect(projected.map(day => day.bankDay)).toEqual(days.map(day => day.bankDay));
    expect(projected.every(day => day.bankDay?.deltaMinutes === null)).toBe(true);
    expect({ raw, days }).toEqual(original);
  });

  it("usa referência autorizada em período inteiramente anterior à escala", () => {
    const raw = fixture(); raw.settings = [];
    expect(needsPeriodPunchReference(raw, employeeId)).toBe(true);
    expect(projectPeriodPunchDisplay(raw, history(raw), employeeId, now, reference)[0].displayMarks).toHaveLength(4);
    expect(projectPeriodPunchDisplay(raw, history(raw), employeeId, now)[0]).not.toHaveProperty("displayMarks");
  });

  it("inclui saída depois do fim consultado e oculta saída da jornada anterior ao início", () => {
    const raw = fixture();
    expect(projectPeriodPunchDisplay(raw, history(raw, "2026-09-25", "2026-09-25"), employeeId, now)[0].displayMarks).toHaveLength(4);
    expect(projectPeriodPunchDisplay(raw, history(raw, "2026-09-26", "2026-09-26"), employeeId, now)[0].displayMarks).toEqual([]);
  });

  it("mantém agrupamento já vigente sem duplicar ou deslocar batidas", () => {
    const raw = fixture(["2026-09-29T19:05", "2026-09-29T20:03", "2026-09-29T21:14", "2026-09-30T07:12"]);
    const days = history(raw, "2026-09-29", "2026-09-30");
    expect(days.map(day => day.bankDay.punches.length)).toEqual([4, 0]);
    const projected = projectPeriodPunchDisplay(raw, days, employeeId, now);
    expect(projected.map(day => day.bankDay)).toEqual(days.map(day => day.bankDay));
    expect(projected[0].displayMarks?.map(mark => mark.at)).toEqual(days[0].bankDay.punches.map(mark => mark.at));
  });

  it.each(["day", "unknown", "otherEmployee", "conflict", "ineligible", "missingEntry", "correction"])("preserva caso %s sem associação presumida", variant => {
    const raw = fixture();
    if (variant === "day") Object.assign(raw.settings[0].payload, { start: "07:00", end: "19:00" });
    if (variant === "unknown") raw.settings = [];
    if (variant === "otherEmployee") raw.settings[0].target = "30000000-0000-4000-8000-000000000002";
    if (variant === "conflict") raw.events[3].conflicted = true;
    if (variant === "ineligible") raw.events[3].eligible = false;
    if (variant === "missingEntry") raw.events = raw.events.slice(3);
    const days = history(raw);
    const input = variant === "correction" ? { ...raw, corrections: [{ date: "2026-09-26" }] } : raw;
    expect(projectPeriodPunchDisplay(input, days, employeeId, now)).toEqual(days);
  });

  it("recupera as batidas reais da lacuna no início da vigência mesmo com próximo turno incompleto", () => {
    const raw = fixture(["2026-09-28T18:44", "2026-09-29T01:05", "2026-09-29T02:07", "2026-09-29T07:00", "2026-09-29T19:00", "2026-09-29T22:00", "2026-09-29T23:00"]);
    const days = history(raw, "2026-09-28", "2026-09-29");
    expect(days[0].bankDay.punches).toHaveLength(1);
    const projected = projectPeriodPunchDisplay(raw, days, employeeId, now);
    expect(projected[0].displayMarks?.map(mark => mark.at)).toEqual(raw.events.slice(0, 4).map(event => Date.parse(event.payload.timestamp)));
    expect(projected[1].bankDay).toEqual(days[1].bankDay);
  });

  it("não reintroduz batidas que a apuração suprimiu", () => {
    const raw = fixture(), days = history(raw);
    days[0].bankDay.suppressedIds = ["mark-1"];
    days[0].bankDay.punches = days[0].bankDay.punches.filter(mark => mark.id !== "mark-1");
    expect(projectPeriodPunchDisplay(raw, days, employeeId, now)[0].displayMarks?.map(mark => mark.at))
      .toEqual([at("2026-09-25T18:56"), at("2026-09-25T21:23"), at("2026-09-26T07:01")]);
  });

  it("agrupa referência noturna estimada sem confirmar banco ou retroagir escala", () => {
    const raw = fixture();
    Object.assign(raw.settings[0].payload, { estimated: true, weeklyRosterConfirmed: false });
    const days = history(raw), projected = projectPeriodPunchDisplay(raw, days, employeeId, now);
    expect(projected[0].displayMarks).toHaveLength(4);
    expect(projected.map(day => day.bankDay)).toEqual(days.map(day => day.bankDay));
  });

  it("respeita duas jornadas consecutivas e não move a entrada noturna seguinte", () => {
    const raw = fixture(["2026-09-25T19:00", "2026-09-26T07:00", "2026-09-26T19:00", "2026-09-27T07:00"]);
    const projected = projectPeriodPunchDisplay(raw, history(raw, "2026-09-25", "2026-09-27"), employeeId, now);
    expect(projected[0].displayMarks?.map(mark => mark.at)).toEqual([at("2026-09-25T19:00"), at("2026-09-26T07:00")]);
    expect(projected[1].displayMarks?.map(mark => mark.at)).toEqual([at("2026-09-26T19:00"), at("2026-09-27T07:00")]);
    expect(projected[2].displayMarks).toEqual([]);
  });
});
