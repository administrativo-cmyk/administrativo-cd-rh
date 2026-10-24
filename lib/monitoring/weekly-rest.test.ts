import { describe, expect, it } from "vitest";
import { applyWeeklyRest, rosterState, standardPayload } from "./schedule-standards";
import { defaultSchedulePayloadSchema } from "./standard-schedules";
import { projectPeriodPunchDisplay } from "./period-punch-display";
import { reprocessMonitoringSnapshot } from "./reprocess";

const employeeId = "30000000-0000-4000-8000-000000000001";
const now = Date.parse("2026-10-23T12:00:00-03:00");
const times = ["2026-09-30T22:03", "2026-10-01T00:55", "2026-10-01T01:40", "2026-10-01T07:01"];
const fixture = () => ({ version: 1, settings: [], events: times.map((time, index) => ({
  id: `mark-${index}`, sourceId: "rep", eligible: true, conflicted: false,
  payload: { key: `mark-${index}`, type: "punch", timestamp: `${time}:00-03:00`, device: "rep", classification: "authorized", eligible: true, precisionSeconds: 1, identity: null, original: {} },
})) });
function history(raw: unknown, start = "2026-09-30", end = "2026-10-01") {
  return reprocessMonitoringSnapshot(raw, { employeeId, start, end, reason: "Regressão da jornada noturna" }, now)
    .map(day => ({ date: day.date, bankDay: day.summary.bankDay!, correctionVersion: null }));
}

describe("regra definitiva e jornada noturna comum", () => {
  it("agrupa o exemplo 22:03–07:01 na entrada, inclusive na virada do mês sem escala", () => {
    const raw = fixture(), days = history(raw), original = structuredClone({ raw, days });
    expect(days.map(day => day.bankDay.punches.length)).toEqual([1, 3]);
    const display = projectPeriodPunchDisplay(raw, days, employeeId, now);
    expect(display[0].displayMarks?.map(mark => mark.at)).toEqual(raw.events.map(event => Date.parse(event.payload.timestamp)));
    expect(display[1].displayMarks).toEqual([]);
    expect(display.map(day => day.bankDay)).toEqual(days.map(day => day.bankDay));
    expect({ raw, days }).toEqual(original);
    expect(projectPeriodPunchDisplay(raw, history(raw, "2026-09-30", "2026-09-30"), employeeId, now)[0].displayMarks).toHaveLength(4);
    expect(projectPeriodPunchDisplay(raw, history(raw, "2026-10-01", "2026-10-01"), employeeId, now)[0].displayMarks).toEqual([]);
  });

  it("agrupa horário noturno comum e estimado anterior à vigência, sem exigir 12x36", () => {
    const raw = fixture(), days = history(raw);
    const reference = { id: employeeId, validFrom: "2026-10-03", validTo: null, updatedAt: "version", payload: { ...standardPayload("operational-22"), estimated: true, weeklyRosterConfirmed: false } };
    expect(projectPeriodPunchDisplay(raw, days, employeeId, now, reference)[0].displayMarks).toHaveLength(4);
  });

  it.each(["conflict", "correction"])("preserva sequência %s", variant => {
    const raw = fixture();
    if (variant === "conflict") raw.events[1].conflicted = true;
    const days = history(raw);
    const input = variant === "correction" ? { ...raw, corrections: [{ date: "2026-10-01" }] } : raw;
    expect(projectPeriodPunchDisplay(input, days, employeeId, now)).toEqual(days);
  });

  it("agrupa três batidas sem completar horário ausente nem misturar o turno seguinte", () => {
    const raw = fixture(); raw.events.splice(2, 1);
    const days = history(raw), display = projectPeriodPunchDisplay(raw, days, employeeId, now);
    expect(display[0].displayMarks).toHaveLength(3);
    expect(display[1].displayMarks).toEqual([]);
    expect(display.map(day => day.bankDay)).toEqual(days.map(day => day.bankDay));
  });

  it("diurno e vespertino folgam domingo, com restrições adicionais preservadas", () => {
    for (const id of ["operational-06", "operational-10", "operational-14", "administrative", "maintenance"]) {
      expect(rosterState(standardPayload(id), "2026-10-25")).toBe("off");
    }
    expect(standardPayload("administrative").days).toEqual([1, 2, 3, 4, 5]);
  });

  it("noturno confirmado folga sábado, sem domingo mensal genérico", () => {
    const payload = applyWeeklyRest({ ...standardPayload("operational-22"), weeklyRest: { kind: "night" as const } });
    expect(rosterState(payload, "2026-10-24")).toBe("off");
    expect(rosterState(payload, "2026-10-25")).toBe("work");
    expect(payload.monthlySundayOff).toBe(false);
  });

  it("mulheres alternam por 14 dias, inclusive antes da referência e na virada do ano", () => {
    const payload = { days: [0, 1, 2, 3, 4, 5], weeklyRest: { kind: "night-women" as const, sundayOffAnchor: "2026-12-27" } };
    for (const date of ["2026-12-13", "2026-12-27", "2027-01-10"]) expect(rosterState(payload, date)).toBe("off");
    for (const date of ["2026-12-20", "2027-01-03"]) expect(rosterState(payload, date)).toBe("work");
    expect(rosterState({ ...payload, weeklyRest: { kind: "night-women" } }, "2026-12-27")).toBe("pending");
  });

  it("preserva 12x36 e rejeita sábado como referência dominical", () => {
    const payload = { ...standardPayload("app-night"), cycle: { kind: "12x36" as const, anchorDate: "2026-10-03" } };
    expect(applyWeeklyRest(payload)).toEqual(payload);
    expect(rosterState(payload, "2026-10-03")).toBe("work");
    expect(defaultSchedulePayloadSchema.safeParse({ ...standardPayload("operational-22"), weeklyRest: { kind: "night-women", sundayOffAnchor: "2026-10-24" } }).success).toBe(false);
  });
});
