import { describe, expect, it } from "vitest";
import {
  aggregateJourneys, assignPunchesToJourneys, calculateJourney, DEFAULT_REPETITION_POLICY, durationMs,
  initialIndicatorPolicies, intersectIntervals, normalizeGroups, normalizeIntervals, operationalDateAt,
  prepareAccess, preparePunches, resolveEligibility, subtractIntervals,
  type AccessEvent, type AccessPointMapping, type Area, type JourneyCalculationInput, type PunchEvent,
} from "./index";

const personId = "30000000-0000-4000-8000-000000000001";
const date = "2026-10-05";
const minute = 60_000;
const at = (time: string, day = date) => Date.parse(`${day}T${time.length === 5 ? `${time}:00` : time}-03:00`);
const mappings: AccessPointMapping[] = ([
  ["operation-entry", "operation", "entry"], ["operation-exit", "operation", "exit"],
  ["cafeteria-entry", "cafeteria", "entry"], ["cafeteria-exit", "cafeteria", "exit"],
  ["perimeter-entry", "perimeter", "entry"], ["perimeter-exit", "perimeter", "exit"],
] as const).map(([id, area, direction]) => ({ id, pointId: id, portalId: area, area, direction, validated: true, validFrom: "2026-01-01", eventClasses: ["face"],
  effects: area === "cafeteria" && direction === "entry" ? { operation: "outside", perimeter: "inside" }
    : area === "operation" && direction === "entry" ? { cafeteria: "outside", perimeter: "inside" }
      : area === "perimeter" && direction === "exit" ? { operation: "outside", cafeteria: "outside" } : {},
}));
function access(pointId: string, time: string, id = `${pointId}-${time}`, day = date): AccessEvent {
  return { id, personId, at: at(time, day), pointId, sourceId: "defense", eventClass: "face", authorized: true, identified: true };
}
function punches(times = ["08:00", "12:00", "13:00", "17:00"], roles = false): PunchEvent[] {
  return times.map((time, index) => ({ id: `p${index + 1}`, personId, at: at(time), sourceId: "rep", precision: "second", role: roles ? index === 0 ? "start" : index === times.length - 1 ? "end" : index % 2 === 1 ? "breakStart" : "breakEnd" : undefined }));
}
function input(patch: Partial<JourneyCalculationInput> = {}): JourneyCalculationInput {
  return {
    personId, operationalDate: date, observationWindow: { start: at("07:00"), end: at("18:00") }, referenceAt: at("18:00"),
    punchEvents: punches(), accessEvents: [access("operation-entry", "07:59")], mappings,
    coverage: (["operation", "cafeteria", "perimeter"] as Area[]).map((area) => ({ area, start: at("07:00"), end: at("18:00"), declaredComplete: true, sourceIds: ["defense"], evidence: "Fixture synthetic complete export" })),
    schedule: { id: "day-shift", expectedStart: at("08:00"), expectedEnd: at("17:00"), pairing: "alternating", allowNoBreak: false },
    evidence: { startConfirmed: true, endConfirmed: true, startCoverageConfirmed: true },
    coffeeWindows: [{ start: at("08:00"), end: at("09:00") }], ...patch,
  };
}

describe("álgebra temporal", () => {
  it("preserva semifechados, união, subtração e precisão em milissegundos", () => {
    expect(normalizeIntervals([{ start: 2, end: 5 }, { start: 0, end: 2 }])).toEqual([{ start: 0, end: 5 }]);
    expect(intersectIntervals([{ start: 0, end: 2 }], [{ start: 2, end: 5 }])).toEqual([]);
    expect(subtractIntervals([{ start: 0, end: 10 }], [{ start: 2, end: 4 }, { start: 6, end: 12 }])).toEqual([{ start: 0, end: 2 }, { start: 4, end: 6 }]);
    expect(durationMs([{ start: 1, end: 1001 }])).toBe(1000);
  });
  it("rejeita instantes não finitos, datas inexistentes e intervalos invertidos", () => {
    expect(() => normalizeIntervals([{ start: NaN, end: 2 }])).toThrow("INVALID_INSTANT");
    expect(() => normalizeIntervals([{ start: 2, end: 1 }])).toThrow("INVALID_INTERVAL");
    expect(() => calculateJourney(input({ operationalDate: "2026-02-30" }))).toThrow("INVALID_OPERATIONAL_DATE");
  });
  it("usa data de São Paulo, independente do fuso do processo", () => {
    expect(operationalDateAt(Date.parse("2026-10-06T01:00:00Z"))).toBe("2026-10-05");
  });
});

describe("jornadas e descanso", () => {
  it("apura 480 minutos trabalhados e 60 de descanso", () => {
    const result = calculateJourney(input());
    expect(result.journey.status).toBe("complete");
    expect(result.workMs).toBe(480 * minute);
    expect(result.restMs).toBe(60 * minute);
    expect(result.outsideOperation.milliseconds).toBe(0);
    expect(result.outsideOperation.quality).toBe("complete");
  });
  it("intersecta saída 11:50–13:10 com W; descanso contribui zero", () => {
    const result = calculateJourney(input({ accessEvents: [access("operation-entry", "07:59"), access("operation-exit", "11:50"), access("operation-entry", "13:10")] }));
    expect(result.outsideOperation.milliseconds).toBe(20 * minute);
    expect(result.outsideOperation.intervals).toHaveLength(2);
    expect(result.outsideOperationEpisodes).toHaveLength(1);
    expect(result.outsideOperationEpisodes[0].workMs).toBe(20 * minute);
  });
  it("preserva seis batidas legítimas e três períodos de trabalho", () => {
    const result = calculateJourney(input({ punchEvents: punches(["08:00", "10:00", "10:15", "12:00", "13:00", "17:00"]) }));
    expect(result.journey.retainedPunchIds).toHaveLength(6);
    expect(result.journey.work).toHaveLength(3);
    expect(result.workMs).toBe(465 * minute);
  });
  it("trata jornada noturna sem separar por dia civil", () => {
    const night = input({ observationWindow: { start: at("21:00"), end: at("07:00", "2026-10-06") }, referenceAt: at("07:00", "2026-10-06"),
      schedule: { id: "night", expectedStart: at("22:00"), expectedEnd: at("06:00", "2026-10-06"), pairing: "alternating", allowNoBreak: false },
      punchEvents: punches(["22:00", "02:00", "03:00", "06:00"]).map((punch, index) => ({ ...punch, at: punch.at + (index ? 86_400_000 : 0) })), accessEvents: [], coverage: [] });
    const result = calculateJourney(night);
    expect(result.workMs).toBe(420 * minute);
    expect(result.operationalDate).toBe(date);
    expect(result.lateness.operationalMonth).toBe("2026-10");
  });
  it.each([0, 1, 2, 3])("preserva %i batidas sem fabricar fechamento", (count) => {
    const result = calculateJourney(input({ punchEvents: punches().slice(0, count), evidence: { startConfirmed: true, endConfirmed: false, startCoverageConfirmed: true } }));
    expect(result.journey.retainedPunchIds).toHaveLength(count);
    expect(result.journey.status).toBe(count === 0 ? "empty" : "partial");
    expect(result.journey.lastExit).toBeNull();
    expect(result.journey.work.every((interval) => interval.end <= at("12:00"))).toBe(true);
  });
  it("duas batidas requerem regra de jornada sem intervalo ou papéis confirmados", () => {
    const denied = calculateJourney(input({ punchEvents: punches(["08:00", "17:00"]) }));
    expect(denied.workMs).toBeNull();
    const allowed = calculateJourney(input({ punchEvents: punches(["08:00", "17:00"]), schedule: { ...input().schedule!, allowNoBreak: true } }));
    expect(allowed.workMs).toBe(540 * minute);
    const explicit = calculateJourney(input({ punchEvents: punches(["08:00", "17:00"], true), schedule: null }));
    expect(explicit.workMs).toBe(540 * minute);
  });
  it("jornada em andamento exige cobertura e limita provisório à referência", () => {
    const result = calculateJourney(input({ punchEvents: punches().slice(0, 3), referenceAt: at("18:00"), evidence: { startConfirmed: true, endConfirmed: false, startCoverageConfirmed: true, ongoingConfirmed: true, punchCoverageUntil: at("14:00") } }));
    expect(result.journey.status).toBe("ongoing");
    expect(result.workMs).toBe(300 * minute);
    expect(result.journey.provisionalWork).toEqual([{ start: at("13:00"), end: at("14:00") }]);
    expect(result.outsideOperation.quality).toBe("partial");
  });
  it("primeira batida de arquivo parcial não se transforma em entrada", () => {
    const result = calculateJourney(input({ punchEvents: punches(["12:00", "13:00", "17:00"]), evidence: { startConfirmed: false, endConfirmed: true, startCoverageConfirmed: false } }));
    expect(result.workMs).toBeNull();
    expect(result.lateness.totalMs).toBeNull();
    expect(result.lateness.reason).toContain("Início não confirmado");
  });
  it("janelas sobrepostas não resolvem jornada pela ordem de chegada", () => {
    const result = assignPunchesToJourneys(punches(), [{ id: "a", operationalDate: date, start: at("07:00"), end: at("14:00") }, { id: "b", operationalDate: date, start: at("11:00"), end: at("18:00") }]);
    expect(result.ambiguous).toHaveLength(2);
    expect(result.assignments.a).toHaveLength(1);
    expect(result.assignments.b).toHaveLength(1);
  });
});

describe("refeitório, café e perímetro", () => {
  it("café 08:10–08:25 integra episódio de 20 minutos sem somar indicadores", () => {
    const result = calculateJourney(input({ accessEvents: [access("operation-entry", "07:59"), access("operation-exit", "08:05"), access("cafeteria-entry", "08:10"), access("cafeteria-exit", "08:25"), access("operation-entry", "08:25")] }));
    expect(result.cafeteria.milliseconds).toBe(15 * minute);
    expect(result.coffeeDuringWorkMs).toBe(15 * minute);
    expect(result.outsideOperation.milliseconds).toBe(20 * minute);
    expect(result.cafeteriaVisits[0].classification).toBe("fromOperation");
    expect(result.cafeteriaVisits[0].sequenceEventIds).toHaveLength(5);
  });
  it("visita anterior ao ponto é preservada e soma zero dentro de W", () => {
    const result = calculateJourney(input({ accessEvents: [access("cafeteria-entry", "07:15"), access("cafeteria-exit", "07:30"), access("operation-entry", "07:59")] }));
    expect(result.cafeteriaObservedMs).toBe(15 * minute);
    expect(result.cafeteria.milliseconds).toBe(0);
    expect(result.cafeteriaVisits[0].classification).toBe("beforePunch");
  });
  it("refeitório no descanso soma zero dentro de W", () => {
    const result = calculateJourney(input({ accessEvents: [access("operation-entry", "07:59"), access("operation-exit", "12:00"), access("cafeteria-entry", "12:05"), access("cafeteria-exit", "12:45"), access("operation-entry", "13:00")] }));
    expect(result.cafeteriaObservedMs).toBe(40 * minute);
    expect(result.cafeteria.milliseconds).toBe(0);
    expect(result.cafeteriaVisits[0].classification).toBe("duringRest");
  });
  it("divide visita que atravessa descanso por interseção", () => {
    const result = calculateJourney(input({ accessEvents: [access("operation-entry", "07:59"), access("operation-exit", "11:45"), access("cafeteria-entry", "11:50"), access("cafeteria-exit", "13:10"), access("operation-entry", "13:15")] }));
    expect(result.cafeteriaObservedMs).toBe(80 * minute);
    expect(result.cafeteria.milliseconds).toBe(20 * minute);
  });
  it("distingue refeitório após abrir ponto sem entrada comprovada na operação", () => {
    const result = calculateJourney(input({ accessEvents: [access("cafeteria-entry", "08:10"), access("cafeteria-exit", "08:25"), access("operation-entry", "08:30")] }));
    expect(result.cafeteriaVisits[0].classification).toBe("withoutPriorOperation");
    expect(result.outsideOperation.unknownMs).toBe(10 * minute);
    expect(result.outsideOperationEpisodes[0].kind).toBe("lateOperationEntry");
  });
  it("saída e entrada identificadas com cobertura apuram 20 minutos fora do CD", () => {
    const result = calculateJourney(input({ accessEvents: [access("operation-entry", "07:59"), access("perimeter-exit", "14:00"), access("perimeter-entry", "14:20")] }));
    expect(result.outsideCd.milliseconds).toBe(20 * minute);
    expect(result.outsideCd.quality).toBe("complete");
  });
  it("torniquete e entrada principal não provam duração fora do CD", () => {
    const original = input();
    const result = calculateJourney(input({ accessEvents: [access("operation-entry", "07:59"), access("operation-exit", "14:00"), access("perimeter-entry", "14:20")], coverage: original.coverage.map((coverage) => coverage.area === "perimeter" ? { ...coverage, declaredComplete: false } : coverage) }));
    expect(result.outsideCd.milliseconds).toBeNull();
    expect(result.betweenOperationExitAndPrincipalEntry[0].end - result.betweenOperationExitAndPrincipalEntry[0].start).toBe(20 * minute);
    expect(result.betweenOperationExitAndPrincipalEntry[0].label).toBe("interval-between-events");
  });
  it("par sem cobertura não produz duração exata", () => {
    const result = calculateJourney(input({ accessEvents: [access("perimeter-exit", "14:00"), access("perimeter-entry", "14:20")], coverage: [] }));
    expect(result.outsideCd.milliseconds).toBeNull();
    expect(result.issues.some((issue) => issue.code === "AREA_PAIR_COVERAGE_MISSING")).toBe(true);
  });
  it("cobertura declarada não substitui mapa ausente da saída do perímetro", () => {
    const result = calculateJourney(input({ mappings: mappings.filter((mapping) => mapping.id !== "perimeter-exit") }));
    expect(result.outsideCd.milliseconds).toBeNull();
    expect(result.outsideCd.unknownMs).toBe(480 * minute);
    expect(result.issues.some((issue) => issue.code === "INCOMPLETE_AREA_MAPPING")).toBe(true);
  });
});

describe("atrasos", () => {
  it.each([["08:15", false, 15 * minute, 0], ["08:16", true, 16 * minute, minute], ["08:15:01", true, 901_000, 1000], ["07:59", false, 0, 0]] as const)("entrada %s respeita limite estrito de 900 segundos", (time, late, total, excess) => {
    const result = calculateJourney(input({ punchEvents: punches([time, "12:00", "13:00", "17:00"]) }));
    expect(result.lateness.over15Minutes).toBe(late);
    expect(result.lateness.totalMs).toBe(total);
    expect(result.lateness.excessMs).toBe(excess);
  });
  it("escala ausente permanece não apurável", () => {
    const result = calculateJourney(input({ schedule: null, punchEvents: punches(undefined, true) }));
    expect(result.lateness.totalMs).toBeNull();
    expect(result.lateness.reason).toBe("Horário previsto não cadastrado");
    expect(result.workMs).toBe(480 * minute);
  });
  it("agregação conta jornada uma vez e atribui mês operacional", () => {
    const result = calculateJourney(input({ punchEvents: punches(["08:16", "12:00", "13:00", "17:00"]) }));
    const totals = aggregateJourneys([result, result]);
    expect(totals[0]).toMatchObject({ month: "2026-10", journeys: 1, lateJourneys: 1, lateTotalMs: 16 * minute, lateExcessMs: minute });
  });
});

describe("repetições e conflitos", () => {
  it("supressão ancorada mantém primeiro evento e não absorve cadeia móvel", () => {
    const events = ["10:00:00", "10:00:08", "10:00:16"].map((time) => access("operation-entry", time));
    const result = prepareAccess(events, mappings, date, personId, DEFAULT_REPETITION_POLICY);
    expect(result.events).toHaveLength(2);
    expect(result.suppressions).toHaveLength(1);
    expect(result.suppressions[0].retainedEventId).toBe(events[0].id);
    expect(events).toHaveLength(3);
  });
  it("preserva direções opostas com 5 segundos de diferença", () => {
    const result = prepareAccess([access("operation-entry", "10:00:00"), access("operation-exit", "10:00:05")], mappings, date, personId, DEFAULT_REPETITION_POLICY);
    expect(result.events).toHaveLength(2);
    expect(result.suppressions).toHaveLength(0);
  });
  it("preserva entrada/saída/entrada 00/04/08 em leitores distintos", () => {
    const result = prepareAccess([access("operation-entry", "10:00:00"), access("operation-exit", "10:00:04"), access("operation-entry", "10:00:08")], mappings, date, personId, DEFAULT_REPETITION_POLICY);
    expect(result.events).toHaveLength(3);
    expect(result.suppressions).toHaveLength(0);
  });
  it("normaliza espaços, acentos e caixa de pontos/classes sem alterar o bruto", () => {
    const source = { ...access("  saída   torniquete ", "10:00"), eventClass: "desbloqueio por RÓSTO" };
    const map: AccessPointMapping = { ...mappings[1], pointId: "Saida Torniquete", eventClasses: ["Desbloqueio por rosto"] };
    const result = prepareAccess([source], [map], date, personId, DEFAULT_REPETITION_POLICY);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event.pointId).toBe("  saída   torniquete ");
  });
  it("suprime batida compatível com papel explícito e mantém proveniência", () => {
    const original = punches(undefined, true);
    const extra = { ...original[0], id: "p-accidental", at: original[0].at + 5000 };
    const result = calculateJourney(input({ punchEvents: [...original, extra] }));
    expect(result.workMs).toBe(480 * minute);
    expect(result.suppressions).toEqual([{ eventId: extra.id, retainedEventId: original[0].id, rule: "punch-repetition", ruleVersion: "repetition-1.0.0", differenceMs: 5000 }]);
  });
  it("proximidade sem papel é pendência por padrão", () => {
    const original = punches();
    const result = calculateJourney(input({ punchEvents: [...original, { ...original[0], id: "candidate", at: original[0].at + 5000 }] }));
    expect(result.journey.status).toBe("inconsistent");
    expect(result.workMs).toBeNull();
    expect(result.suppressions).toHaveLength(0);
  });
  it("configuração explícita permite supressão de ponto sem natureza", () => {
    const original = punches();
    const result = calculateJourney(input({ punchEvents: [...original, { ...original[0], id: "candidate", at: original[0].at + 5000 }], repetitionPolicy: { suppressUntypedPunches: true } }));
    expect(result.workMs).toBe(480 * minute);
    expect(result.suppressions).toHaveLength(1);
  });
  it("não suprime saída e retorno do descanso quando papéis são distintos", () => {
    const original = punches(["08:00", "12:00", "12:00:05", "17:00"], true);
    const result = preparePunches(original, DEFAULT_REPETITION_POLICY);
    expect(result.events).toHaveLength(4);
    expect(result.suppressions).toHaveLength(0);
  });
  it("resultado independe da ordem dos eventos", () => {
    const original = input({ accessEvents: [access("operation-entry", "07:59"), access("operation-exit", "14:00"), access("operation-entry", "14:20")] });
    expect(calculateJourney({ ...original, punchEvents: [...original.punchEvents].reverse(), accessEvents: [...original.accessEvents].reverse() })).toEqual(calculateJourney(original));
  });
  it("eventos simultâneos opostos geram desconhecido, sem ordenar convenientemente", () => {
    const result = calculateJourney(input({ accessEvents: [access("operation-entry", "07:59"), access("operation-exit", "10:00"), access("operation-entry", "10:00")] }));
    expect(result.outsideOperation.unknownMs).toBe(360 * minute);
    expect(result.issues.some((issue) => issue.code === "SIMULTANEOUS_TRANSITION_CONFLICT")).toBe(true);
  });
  it("negados, anônimos, alarmes e origem manual sem justificativa não deslocam pessoa", () => {
    const events: AccessEvent[] = [
      { ...access("operation-exit", "09:00"), authorized: false },
      { ...access("operation-exit", "10:00"), personId: null, identified: false },
      { ...access("operation-exit", "11:00"), eventClass: "alarm" },
      { ...access("operation-exit", "14:00"), provenance: { sourceId: "manual", origin: "manual" } },
    ];
    const result = calculateJourney(input({ accessEvents: [access("operation-entry", "07:59"), ...events] }));
    expect(result.outsideOperation.milliseconds).toBe(0);
    expect(result.issues).toHaveLength(4);
  });
});

describe("qualidade, conservação e elegibilidade", () => {
  it("batida de ponto não prova presença na operação", () => {
    const result = calculateJourney(input({ accessEvents: [] }));
    expect(result.outsideOperation.milliseconds).toBeNull();
    expect(result.outsideOperation.unknownMs).toBe(480 * minute);
    expect(result.insideOperationMs).toBe(0);
  });
  it("âncora anterior precisa de cobertura e respeita janela configurada", () => {
    const result = calculateJourney(input({ observationWindow: { start: at("08:00"), end: at("18:00") }, initialLookbackMs: 30_000 }));
    expect(result.outsideOperation.milliseconds).toBeNull();
    expect(result.outsideOperation.unknownMs).toBe(480 * minute);
  });
  it("janela inicial é relativa à entrada da jornada, não à margem de observação", () => {
    const result = calculateJourney(input({ initialLookbackMs: 30_000 }));
    expect(result.outsideOperation.milliseconds).toBeNull();
    expect(result.outsideOperation.unknownMs).toBe(480 * minute);
  });
  it("janelas de café vazias permanecem não cadastradas", () => {
    const result = calculateJourney(input({ coffeeWindows: [] }));
    expect(result.coffeeDuringWorkMs).toBeNull();
    expect(result.issues.some((issue) => issue.code === "COFFEE_WINDOWS_NOT_CONFIGURED")).toBe(true);
  });
  it("lacuna de cobertura restaura desconhecido até nova âncora", () => {
    const base = input();
    const operation = base.coverage[0];
    const result = calculateJourney({ ...base, coverage: [...base.coverage.slice(1), { ...operation, end: at("10:00") }, { ...operation, start: at("11:00") }] });
    expect(result.insideOperationMs).toBe(120 * minute);
    expect(result.outsideOperation.unknownMs).toBe(360 * minute);
    expect(result.outsideOperation.quality).toBe("partial");
  });
  it("mudança de fontes cobertas não transporta âncora antiga", () => {
    const base = input();
    const operation = base.coverage[0];
    const result = calculateJourney({ ...base, coverage: [...base.coverage.slice(1), { ...operation, end: at("10:00") }, { ...operation, start: at("10:00"), sourceIds: ["other-defense"] }] });
    expect(result.insideOperationMs).toBe(120 * minute);
    expect(result.outsideOperation.unknownMs).toBe(360 * minute);
  });
  it("par não usa união de coberturas declaradas para conjuntos diferentes de fontes", () => {
    const base = input();
    const perimeter = base.coverage[2];
    const result = calculateJourney({ ...base,
      accessEvents: [access("perimeter-exit", "14:00"), { ...access("perimeter-entry", "14:20"), sourceId: "other-defense" }],
      coverage: [...base.coverage.slice(0, 2), { ...perimeter, end: at("14:10") }, { ...perimeter, start: at("14:10"), sourceIds: ["other-defense"] }],
    });
    expect(result.outsideCd.intervals).toEqual([]);
    expect(result.issues.some((issue) => issue.code === "AREA_PAIR_COVERAGE_MISSING")).toBe(true);
  });
  it("normaliza grupos múltiplos e exclusão preserva atraso e eventos", () => {
    expect(normalizeGroups(" CD JK , COZINHA JK,  COZINHA JK ")).toEqual(["CD JK", "COZINHA JK"]);
    expect(normalizeGroups("Todos/CD JK/COZINHA JK, Todos/CD JK/LIDERANÇA JK, COZINHA JK")).toEqual(["COZINHA JK", "LIDERANÇA JK"]);
    const result = calculateJourney(input({ groupSnapshots: [{ groups: "CD JK, COZINHA JK", validFrom: date, evidence: "snapshot confirmed" }], indicatorPolicies: initialIndicatorPolicies(date, "admin") }));
    expect(result.outsideOperation.quality).toBe("excluded");
    expect(result.outsideOperation.milliseconds).toBeNull();
    expect(result.lateness.quality).toBe("complete");
    expect(result.location.length).toBeGreaterThan(0);
  });
  it("não aplica grupo atual retroativamente; exceção individual prevalece", () => {
    const policies = initialIndicatorPolicies("2026-10-01", "admin");
    expect(resolveEligibility(personId, "outsideOperation", date, [{ groups: "COZINHA JK", validFrom: "2026-10-10", evidence: "snapshot" }], policies).state).toBe("pending");
    expect(resolveEligibility(personId, "outsideOperation", date, [{ groups: "COZINHA JK", validFrom: date, evidence: "snapshot" }], [...policies, { id: "exception", subjectType: "person", subject: personId, effect: "include", indicator: "outsideOperation", reason: "Regra individual", author: "admin", validFrom: date, validTo: date }]).state).toBe("eligible");
    expect(resolveEligibility(personId, "outsideOperation", "2026-10-06", [{ groups: "COZINHA JK", validFrom: date, evidence: "snapshot" }], [...policies, { id: "exception", subjectType: "person", subject: personId, effect: "include", indicator: "outsideOperation", reason: "Regra individual", author: "admin", validFrom: date, validTo: date }]).state).toBe("excluded");
  });
  it("conserva exatamente W e mantém dimensões disjuntas em 100 cenários sintéticos", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const events: AccessEvent[] = [];
      for (let j = 0; j < 25; j += 1) {
        const time = at("07:00") + ((seed * 179 + j * 977) % (11 * 3600)) * 1000 + seed;
        events.push({ ...access(j % 2 ? "operation-entry" : "operation-exit", "08:00", `s${seed}-${j}`), at: time });
      }
      const result = calculateJourney(input({ accessEvents: events }));
      const outside = durationMs(result.outsideOperation.intervals);
      expect(result.insideOperationMs + outside + result.outsideOperation.unknownMs).toBe(result.workMs);
      for (const area of ["operation", "cafeteria", "perimeter"] as const) {
        const intervals = result.location.filter((interval) => interval.area === area);
        expect(intervals.every((interval, index) => !index || interval.start >= intervals[index - 1].end)).toBe(true);
      }
      expect(outside).toBeGreaterThanOrEqual(0);
      expect(outside).toBeLessThanOrEqual(result.workMs!);
      expect(durationMs(intersectIntervals(result.outsideOperation.intervals, result.journey.rest))).toBe(0);
    }
  });
  it("processa 12 mil transições sintéticas conservando tempo sem perder direções", () => {
    const events = Array.from({ length: 12_000 }, (_, index) => ({
      ...access(index % 2 === 0 ? "operation-entry" : "operation-exit", "08:00", `volume-${index}`),
      at: at("07:00") + index * 2000,
    }));
    const result = calculateJourney(input({ accessEvents: events }));
    expect(result.suppressions).toHaveLength(0);
    expect(result.insideOperationMs + durationMs(result.outsideOperation.intervals) + result.outsideOperation.unknownMs).toBe(result.workMs);
    expect(result.outsideOperation.milliseconds).toBeGreaterThan(0);
  });
});
