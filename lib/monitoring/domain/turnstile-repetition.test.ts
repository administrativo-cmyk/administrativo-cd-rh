import { describe, expect, it } from "vitest";
import {
  calculateJourney, DEFAULT_REPETITION_POLICY, prepareAccess, TURNSTILE_REPETITION_VERSION,
  type AccessEvent, type AccessPointMapping, type Area, type JourneyCalculationInput,
} from "./index";

const date = "2026-10-08";
const personId = "employee";
const at = (time: string, day = date) => Date.parse(`${day}T${time}-03:00`);
const mappings: AccessPointMapping[] = (["operation", "cafeteria", "perimeter"] as const).flatMap(area =>
  (["entry", "exit"] as const).map(direction => ({
    id: `${area}-${direction}`, pointId: `${area}-${direction}`, portalId: area, area, direction,
    validated: true, validFrom: "2026-01-01", eventClasses: ["face"],
  })));
const access = (id: string, time: string, patch: Partial<AccessEvent> = {}): AccessEvent => ({
  id, personId, at: at(time), pointId: "operation-entry", sourceId: "defense", eventClass: "face",
  authorized: true, identified: true, provenance: { sourceId: "defense", fileId: "file", row: 1 }, ...patch,
});
const prepare = (events: AccessEvent[], maps = mappings, accessWindowMs = 10_000) =>
  prepareAccess(events, maps, date, personId, { ...DEFAULT_REPETITION_POLICY, accessWindowMs });
function input(accessEvents: AccessEvent[], patch: Partial<JourneyCalculationInput> = {}): JourneyCalculationInput {
  return {
    personId, operationalDate: date, observationWindow: { start: at("07:00:00"), end: at("18:00:00") },
    referenceAt: at("18:00:00"), accessEvents, mappings,
    punchEvents: ["08:00:00", "12:00:00", "13:00:00", "17:00:00"].map((time, index) => ({
      id: `p${index}`, personId, at: at(time), sourceId: "clock", precision: "second",
    })),
    schedule: { id: "day", expectedStart: at("08:00:00"), expectedEnd: at("17:00:00"), pairing: "alternating", allowNoBreak: false },
    evidence: { startConfirmed: true, endConfirmed: true, startCoverageConfirmed: true },
    coverage: (["operation", "cafeteria", "perimeter"] as Area[]).map(area => ({
      area, start: at("07:00:00"), end: at("18:00:00"), declaredComplete: true, sourceIds: ["defense"], evidence: "Cobertura sintética conferida",
    })), ...patch,
  };
}

describe("leituras consecutivas do torniquete", () => {
  it.each([["10:00:59", 59_000], ["10:00:59.999", 59_999]] as const)("suprime %s preservando original e proveniência", (time, differenceMs) => {
    const events = [access("first", "10:00:00"), access("second", time)];
    const original = structuredClone(events);
    const result = prepare(events);
    expect(result.events.map(item => item.event.id)).toEqual(["first"]);
    expect(result.suppressions).toEqual([{
      eventId: "second", retainedEventId: "first", rule: "access-repetition", ruleVersion: TURNSTILE_REPETITION_VERSION, differenceMs,
    }]);
    expect(events).toEqual(original);
    expect(result.events[0].event.provenance).toEqual(original[0].provenance);
  });
  it("preserva leitura aos 60 segundos mesmo com antiga janela genérica maior", () => {
    const result = prepare([access("first", "10:00:00"), access("second", "10:01:00")], mappings, 120_000);
    expect(result.events).toHaveLength(2);
    expect(result.suppressions).toEqual([]);
  });
  it("mantém primeira âncora e não absorve cadeia de leituras", () => {
    const result = prepare(["10:00:00", "10:00:40", "10:01:20", "10:01:59"].map((time, index) => access(`a${index}`, time)));
    expect(result.events.map(item => item.event.id)).toEqual(["a0", "a2"]);
    expect(result.suppressions.map(item => [item.eventId, item.retainedEventId])).toEqual([["a1", "a0"], ["a3", "a2"]]);
  });
  it("preserva saída e retorno reais em menos de um minuto", () => {
    const result = prepare([
      access("entry", "10:00:00"), access("exit", "10:00:20", { pointId: "operation-exit" }), access("return", "10:00:40"),
    ]);
    expect(result.events).toHaveLength(3);
    expect(result.suppressions).toEqual([]);
  });
  it.each(["source", "reader", "class", "manual"] as const)("não mescla %s diferente nem atravessa sua leitura intermediária", kind => {
    const second = access("other", "10:00:20");
    const maps = structuredClone(mappings);
    if (kind === "source") second.sourceId = "other-defense";
    if (kind === "reader") {
      second.pointId = "other-entry";
      maps.push({ ...maps[0], id: "other-entry", pointId: second.pointId });
    }
    if (kind === "class") { second.eventClass = "card"; maps[0].eventClasses.push("card"); }
    if (kind === "manual") second.provenance = { sourceId: "defense", origin: "manual", justification: "Revisão auditada" };
    expect(prepare([access("first", "10:00:00"), second, access("third", "10:00:40")], maps).suppressions).toEqual([]);
  });
  it("efeito oposto de outra área interrompe âncora do torniquete", () => {
    const maps = mappings.map(mapping => mapping.id === "cafeteria-entry" ? { ...mapping, effects: { operation: "outside" as const } } : mapping);
    const result = prepare([
      access("entry", "10:00:00"), access("meal", "10:00:20", { pointId: "cafeteria-entry" }), access("return", "10:00:40"),
    ], maps);
    expect(result.events).toHaveLength(3);
    expect(result.suppressions).toEqual([]);
  });
  it("não transforma leituras negadas ou não identificadas em localização conhecida", () => {
    const events = [
      access("denied", "08:00:00", { authorized: false }),
      access("anonymous", "08:00:20", { personId: null, identified: false }),
      access("other-person", "08:00:30", { personId: "someone-else" }),
    ];
    const result = calculateJourney(input(events));
    expect(result.outsideOperation).toMatchObject({ quality: "unavailable", milliseconds: null, knownMs: 0 });
    expect(result.suppressions).toEqual([]);
    expect(result.location.filter(interval => interval.area === "operation").every(interval => interval.state === "unknown")).toBe(true);
  });
  it("usa instantes contínuos para duplicidade após meia-noite no turno noturno", () => {
    const events = [access("first", "23:59:40"), access("second", "00:00:20", { at: at("00:00:20", "2026-10-09") })];
    const result = prepare(events);
    expect(result.events.map(item => item.event.id)).toEqual(["first"]);
    expect(result.suppressions[0]).toMatchObject({ eventId: "second", differenceMs: 40_000 });
  });
  it("corrige desconhecido provocado pela repetição sem alterar jornada nem batidas", () => {
    const events = [access("entry", "08:00:00"), access("repeat", "08:00:59"), access("exit", "17:00:00", { pointId: "operation-exit" })];
    const source = input(events);
    const original = structuredClone(source);
    const result = calculateJourney(source);
    const withoutRepeat = calculateJourney(input([events[0], events[2]]));
    expect(result.outsideOperation).toMatchObject({ quality: "complete", unknownMs: 0, milliseconds: 0 });
    expect(result.issues.some(issue => issue.code === "REPEATED_DIRECTION_WITHOUT_PAIR")).toBe(false);
    expect(result.journey).toEqual(withoutRepeat.journey);
    expect(result.workMs).toBe(8 * 3_600_000);
    expect(result.restMs).toBe(3_600_000);
    expect(source).toEqual(original);
  });
  it("mantém desconhecido quando repetição distante indica passagem oposta ausente", () => {
    const result = calculateJourney(input([access("entry", "07:59:00"), access("again", "10:00:00")]));
    expect(result.outsideOperation.unknownMs).toBe(2 * 3_600_000);
    expect(result.issues.some(issue => issue.code === "REPEATED_DIRECTION_WITHOUT_PAIR")).toBe(true);
  });
  it("não amplia a janela genérica do refeitório ou do perímetro", () => {
    for (const area of ["cafeteria", "perimeter"]) {
      const result = prepare([access("first", "10:00:00", { pointId: `${area}-entry` }), access("second", "10:00:59", { pointId: `${area}-entry` })]);
      expect(result.events).toHaveLength(2);
      expect(result.suppressions).toEqual([]);
    }
  });
});

describe("causas verificáveis de localização desconhecida", () => {
  it("identifica falta de mapa do perímetro sem inferir saída pelo torniquete", () => {
    const source = input([access("entry", "07:59:00")], { mappings: mappings.filter(mapping => mapping.id !== "perimeter-exit") });
    const result = calculateJourney(source);
    expect(result.outsideCd).toMatchObject({ milliseconds: null, quality: "unavailable", knownMs: 0 });
    expect(result.issues).toContainEqual({ code: "INCOMPLETE_AREA_MAPPING", eventIds: [], detail: "Mapa incompleto de entrada/saída: perimeter" });
    expect(result.issues.filter(issue => issue.code === "AREA_COVERAGE_MISSING")).toEqual([]);
  });
  it("identifica falta de cobertura apesar dos leitores e acessos existentes", () => {
    const result = calculateJourney(input([access("entry", "07:59:00")], { coverage: [] }));
    expect(result.issues.filter(issue => issue.code === "AREA_COVERAGE_MISSING").map(issue => issue.detail)).toEqual(["operation", "cafeteria", "perimeter"]);
    expect(result.outsideOperation.knownMs).toBe(0);
  });
  it("não informa ausência total quando existe cobertura parcial válida", () => {
    const source = input([access("entry", "07:59:00")]);
    source.coverage = source.coverage.map(item => ({ ...item, end: at("10:00:00") }));
    const result = calculateJourney(source);
    expect(result.issues.some(issue => issue.code === "AREA_COVERAGE_MISSING")).toBe(false);
    expect(result.outsideOperation).toMatchObject({ quality: "partial", knownMs: 2 * 3_600_000, unknownMs: 6 * 3_600_000 });
  });
});
