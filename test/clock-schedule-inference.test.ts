import { describe, expect, it } from "vitest";
import { inferObservedSchedules, type PatternPunch } from "../lib/monitoring/schedule-inference";

const from = "2026-10-01T00:00:00-03:00";
const to = "2026-10-13T00:00:00-03:00";
const dates = ["01", "02", "05", "06", "08", "09", "12"];
const punches = (days = dates, hours = ["08:00", "12:00", "13:00", "17:00"]): PatternPunch[] => days.flatMap(day => hours.map((hour, index) => ({
  id: `day-${day}-${index}`, employeeId: "synthetic-employee", sourceId: "clock-cpf", timestamp: `2026-10-${day}T${hour}:00-03:00`, eligible: true, conflicted: false,
})));
const infer = (events: PatternPunch[]) => inferObservedSchedules(events, from, to)[0];

describe("Horários recorrentes observados nos relógios", () => {
  it("reconhece horário diurno sem transformar dias observados em escala semanal", () => {
    expect(infer(punches())).toMatchObject({ status: "recurring", start: "08:00", end: "17:00", overnight: false, matchingDays: 7, matchingRatio: 1, medianWorkedMinutes: 480, weeklyRosterConfirmed: false, officialRosterApplicationAllowed: false });
    expect(infer(punches()).observedWeekdays).not.toContain(3);
  });
  it("mantém a saída noturna no dia da entrada, com limite completo respeitado", () => {
    const events = ["01", "02", "05", "06", "08", "09", "10"].flatMap(day => ["22:00", "02:00", "03:00", "06:00"].map((hour, index) => ({
      id: `night-${day}-${index}`, employeeId: "night-employee", sourceId: "clock-pis", timestamp: `2026-10-${String(Number(day) + (index ? 1 : 0)).padStart(2, "0")}T${hour}:00-03:00`, eligible: true, conflicted: false,
    })));
    expect(infer(events)).toMatchObject({ status: "recurring", start: "22:00", end: "06:00", overnight: true, matchingDays: 7, medianWorkedMinutes: 420 });
  });
  it("exclui 13/10 parcial e 30/09 fora da declaração de completude", () => {
    const events = [...punches(), ...punches(["13"], ["04:00", "12:00"]).map(e => ({ ...e, id: `partial-${e.id}` })), { ...punches()[0], id: "before-coverage", timestamp: "2026-09-30T04:00:00-03:00" }];
    expect(infer(events)).toEqual(infer(punches()));
  });
  it("preserva os dois relógios como fontes e não apaga repetições na origem", () => {
    const events = punches().map((event, index) => ({ ...event, sourceId: index % 2 ? "clock-pis" : "clock-cpf" }));
    const original = structuredClone(events);
    expect(infer(events).sourceIds).toEqual(["clock-cpf", "clock-pis"]);
    expect(events).toEqual(original);
  });
  it("descarta um dia com marcação ímpar em vez de inventar saída", () => {
    const result = infer(punches().filter(event => event.id !== "day-02-3"));
    expect(result.excludedDays).toContainEqual({ date: "2026-10-02", reason: "INCOMPLETE_OR_AMBIGUOUS_SEQUENCE" });
    expect(result.matchingDates).not.toContain("2026-10-02");
  });
  it("sinaliza turnos variáveis e amostra curta", () => {
    const mixed = [...punches(["01", "05", "08", "12"]), ...punches(["02", "06", "09"], ["14:00", "18:00", "19:00", "23:00"])];
    expect(infer(mixed).status).toBe("variable");
    expect(infer(punches(["01", "02", "05"])).status).toBe("insufficient");
  });
  it("duas batidas recorrentes não autorizam jornada sem intervalo", () => {
    expect(infer(punches(dates, ["08:00", "17:00"]))).toMatchObject({ status: "recurring", medianWorkedMinutes: null, officialRosterApplicationAllowed: false });
  });
  it("identifica possível 12x36 sem confirmar a folga dos dias sem batida", () => {
    expect(infer(punches(["01", "03", "05", "07", "09", "11"], ["07:00", "12:00", "13:00", "19:00"]))).toMatchObject({ status: "recurring", start: "07:00", end: "19:00", observedCadence: "possible_12x36", weeklyRosterConfirmed: false, officialRosterApplicationAllowed: false });
  });
  it("muitos dias ambíguos impedem classificar poucas sequências limpas como recorrência", () => {
    const clean = punches(["01", "03", "05", "07", "09", "11"]);
    const incomplete = punches(["02", "04", "06", "08", "10", "12"], ["08:00", "12:00", "13:00"]);
    expect(infer([...clean, ...incomplete]).status).not.toBe("recurring");
  });
  it("não usa eventos conflitantes ou não elegíveis na sugestão", () => {
    const events = punches().map(event => event.id.startsWith("day-02-") ? { ...event, conflicted: true } : event);
    expect(infer(events).observationDates).not.toContain("2026-10-02");
  });
  it("recusa joins duplicados, timestamp inválido e período não suportado", () => {
    expect(() => infer([...punches(), punches()[0]])).toThrow("DUPLICATE_PUNCH_ID");
    expect(() => infer([{ ...punches()[0], timestamp: "invalid" }])).toThrow("INVALID_PUNCH_TIMESTAMP");
    expect(() => inferObservedSchedules([], from, from)).toThrow("INVALID_COMPLETE_PERIOD");
    expect(() => inferObservedSchedules([], "2027-10-01T00:00:00-03:00", "2027-10-13T00:00:00-03:00")).toThrow("UNSUPPORTED_PATTERN_TIMEZONE_PERIOD");
  });
  it("produz resultado determinístico com entrada desordenada", () => {
    expect(infer([...punches()].reverse())).toEqual(infer(punches()));
  });
});
