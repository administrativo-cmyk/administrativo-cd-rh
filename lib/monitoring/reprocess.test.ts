import { describe, expect, it } from "vitest";
import { projectMonitoringEntryControlOnly, reprocessMonitoringSnapshot, reprocessRequestSchema, summarizeCalculation } from "./reprocess";
import { perimeterObservationEventIds, type AccessEvent, type AccessPointMapping } from "./domain";

const employeeId = "30000000-0000-4000-8000-000000000001";
const actor = "20000000-0000-4000-8000-000000000001";
const date = "2026-10-05";
const stamp = (time: string, day = date) => `${day}T${time}:00-03:00`;
const request = { employeeId, start: date, end: date, reason: "Validação sintética de regras" };
const reference = Date.parse(stamp("23:59", "2026-10-07"));
function setting(kind: string, target: string, payload: unknown, id = kind) {
  return { id, kind, target, payload, valid_from: "2026-10-01", valid_to: null, reason: "Cadastro confirmado para teste", created_by: actor, created_at: stamp("00:00"), revoked_at: null };
}
function event(type: "punch" | "access", time: string, id: string, device = "rep", day = date) {
  return { id, sourceId: type === "punch" ? "rep" : "defense", eligible: true, conflicted: false,
    provenance: [{ sourceId: type === "punch" ? "rep" : "defense", fileId: "synthetic-file", row: 1 }],
    payload: { key: id, type, timestamp: stamp(time, day), device, classification: "authorized", eligible: true, precisionSeconds: 1,
      identity: { type: type === "punch" ? "cpf" : "defense", value: "SYNTHETIC" }, original: type === "access" ? { eventName: "Desbloqueio por rosto" } : { record: "DO_NOT_EXPOSE" },
    },
  };
}
function snapshot() {
  return { version: 4, sources: [{ id: "rep", kind: "afd", configuration: { sourceIdentityConfirmed: true } }, { id: "defense", kind: "defense-access", configuration: {} }],
    events: [event("punch", "08:00", "p1"), event("punch", "12:00", "p2"), event("punch", "13:00", "p3"), event("punch", "17:00", "p4"), event("access", "07:59", "a1", "Entrada Torniquete"), event("access", "11:50", "a2", "Saida Torniquete"), event("access", "13:10", "a3", "Entrada Torniquete")],
    settings: [
      setting("schedule", employeeId, { name: "Diurno", start: "08:00", end: "17:00", days: [0, 1, 2, 3, 4, 5, 6], allowNoBreak: false, pairing: "alternating", coffeeWindows: [{ start: "08:00", end: "09:00" }] }),
      setting("evidence", employeeId, { startConfirmed: true, endConfirmed: true, startCoverageConfirmed: true }),
      setting("mapping", "Entrada Torniquete", { pointId: "Entrada Torniquete", portalId: "operation", area: "operation", direction: "entry", validated: true, eventClasses: ["Desbloqueio por rosto"], effects: { perimeter: "inside", cafeteria: "outside" } }, "m1"),
      setting("mapping", "Saida Torniquete", { pointId: "Saida Torniquete", portalId: "operation", area: "operation", direction: "exit", validated: true, eventClasses: ["Desbloqueio por rosto"] }, "m2"),
      ...(["cafeteria", "perimeter"] as const).flatMap((area) => (["entry", "exit"] as const).map((direction) => setting("mapping", `${area}-${direction}`, { pointId: `${area}-${direction}`, portalId: area, area, direction, validated: true, eventClasses: ["Desbloqueio por rosto"] }, `mapping-${area}-${direction}`))),
      ...["operation", "cafeteria", "perimeter"].map((area) => setting("coverage", "defense", { area, start: stamp("00:00"), end: stamp("23:59", "2026-10-06"), sourceIds: ["defense"], declaredComplete: true, evidence: "Cobertura sintética confirmada" }, `coverage-${area}`)),
    ],
  };
}

function completeUnscheduledSnapshot() {
  const raw = snapshot();
  raw.settings = raw.settings.filter(row => !["schedule", "evidence"].includes(row.kind));
  return { ...raw, punchSourceIds: ["rep"], sources: [{ id: "rep", kind: "afd", configuration: {
    sourceIdentityConfirmed: true, declaredCoverage: { from: stamp("00:00", "2026-10-01"), to: stamp("00:00", "2026-10-13"), continuous: true },
  } }] };
}

describe("adaptação de snapshot persistido ao motor", () => {
  it("acrescenta duração observada entre duas batidas sem alterar jornada confirmada ou banco", () => {
    const raw = snapshot(); raw.events = raw.events.filter(e => e.payload.type !== "punch" || ["p1", "p4"].includes(e.id));
    const original = structuredClone(raw);
    const day = reprocessMonitoringSnapshot(raw, request, reference)[0];
    expect(day.summary.workedSeconds).toBeNull();
    expect(day.summary.workObservation).toMatchObject({ basis: "turnstile-suggestion", workedSeconds: 7 * 3600 + 40 * 60, restSeconds: 80 * 60 });
    expect(day.summary.bankDay?.deltaMinutes).toBeNull();
    expect(raw).toEqual(original);
  });
  it("apura trabalho e acessos sem escala, mantendo atraso, extra e banco pendentes", () => {
    const raw = completeUnscheduledSnapshot();
    const original = structuredClone(raw);
    const day = reprocessMonitoringSnapshot(raw, request, reference)[0];
    expect(day.result.journey.status).toBe("complete");
    expect(day.summary).toMatchObject({ workedSeconds: 8 * 3600, restSeconds: 3600, outsideSeconds: 20 * 60,
      lateSeconds: null, overtimeSeconds: null, expectedWorkSeconds: null, scheduleName: null, quality: "partial" });
    expect(day.summary.bankDay).toMatchObject({ state: "pending", deltaMinutes: null, reason: "Horário padrão precisa ser confirmado" });
    expect(day.result.issues.some(issue => issue.code === "SCHEDULE_MISSING")).toBe(true);
    expect(raw).toEqual(original);
  });

  it.each([2, 3, 5])("não fecha sequência de %i batidas sem escala", count => {
    const raw = completeUnscheduledSnapshot();
    raw.events = raw.events.filter(row => row.payload.type !== "punch" || ["p1", "p2", "p3", "p4"].slice(0, count).includes(row.id));
    if (count === 5) raw.events.push(event("punch", "18:00", "p5"));
    const day = reprocessMonitoringSnapshot(raw, request, reference)[0];
    expect(day.summary.workedSeconds).toBeNull();
    expect(day.summary.bankDay?.deltaMinutes).toBeNull();
  });

  it("não usa cobertura parcial, relógio ausente ou conflito para fechar jornada sem escala", () => {
    const raw = completeUnscheduledSnapshot();
    raw.sources[0].configuration.declaredCoverage.to = stamp("12:00");
    expect(reprocessMonitoringSnapshot(raw, request, reference)[0].summary.workedSeconds).toBeNull();
    raw.sources[0].configuration.declaredCoverage.to = stamp("00:00", "2026-10-13");
    raw.punchSourceIds.push("second-clock-missing");
    expect(reprocessMonitoringSnapshot(raw, request, reference)[0].summary.workedSeconds).toBeNull();
    raw.punchSourceIds.pop();
    raw.events[1].conflicted = true;
    expect(reprocessMonitoringSnapshot(raw, request, reference)[0].summary.workedSeconds).toBeNull();
  });

  it("preserva revisão explícita que não confirma o início", () => {
    const raw = completeUnscheduledSnapshot();
    raw.settings.push(setting("evidence", employeeId, { startConfirmed: false, endConfirmed: false, startCoverageConfirmed: false }));
    expect(reprocessMonitoringSnapshot(raw, request, reference)[0].summary.workedSeconds).toBeNull();
  });

  it("aguarda a margem real de coleta e preserva duração máxima sem escala", () => {
    const raw = completeUnscheduledSnapshot();
    expect(reprocessMonitoringSnapshot(raw, request, Date.parse(stamp("03:00", "2026-10-06")))[0].summary.workedSeconds).toBeNull();
    raw.settings.push(setting("rule", "global", { punchRepeatSeconds: 60, accessRepeatSeconds: 10, initialLookbackSeconds: 3600, maxJourneyHours: 8, suppressUntypedPunches: false }));
    const day = reprocessMonitoringSnapshot(raw, request, reference)[0];
    expect(day.summary.workedSeconds).toBeNull();
    expect(day.result.issues.some(issue => issue.code === "JOURNEY_EXCEEDS_MAX_SPAN")).toBe(true);
  });

  it("não divide turno noturno sem escala mesmo com quatro batidas após meia-noite", () => {
    const raw = completeUnscheduledSnapshot();
    raw.events = [event("punch", "22:00", "previous", "rep", "2026-10-04"),
      ...["00:00", "02:00", "03:00", "06:00"].map((time, i) => event("punch", time, `night-${i}`))];
    expect(reprocessMonitoringSnapshot(raw, request, reference)[0].summary.workedSeconds).toBeNull();
    // Absence of the neighboring mark only helps when collection also covers the margin.
    raw.events.shift();
    raw.sources[0].configuration.declaredCoverage.from = stamp("00:00");
    expect(reprocessMonitoringSnapshot(raw, request, reference)[0].summary.workedSeconds).toBeNull();
  });

  it("usa escala estimada só para atribuir o dia, sem criar atraso ou débito", () => {
    const raw = completeUnscheduledSnapshot();
    raw.settings.push(setting("schedule", employeeId, { name: "Estimado", start: "08:00", end: "17:00",
      days: [0, 1, 2, 3, 4, 5, 6], lunchMinutes: 60, estimated: true, weeklyRosterConfirmed: false,
      allowNoBreak: false, pairing: "alternating", coffeeWindows: [] }));
    const day = reprocessMonitoringSnapshot(raw, request, reference)[0];
    expect(day.summary.workedSeconds).toBe(8 * 3600);
    expect(day.summary.lateSeconds).toBeNull();
    expect(day.summary.overtimeSeconds).toBeNull();
    expect(day.summary.bankDay?.deltaMinutes).toBeNull();
  });

  it("preserva a atribuição noturna estimada e o pareamento explícito configurado", () => {
    const raw = completeUnscheduledSnapshot();
    const schedule = setting("schedule", employeeId, { name: "Noturno estimado", start: "22:00", end: "06:20",
      days: [0, 1, 2, 3, 4, 5, 6], lunchMinutes: 60, estimated: true, weeklyRosterConfirmed: false,
      allowNoBreak: false, pairing: "alternating", coffeeWindows: [] });
    raw.settings.push(schedule);
    raw.events = [event("punch", "22:00", "n1"), ...["02:00", "03:00", "06:20"].map((time, i) => event("punch", time, `n${i + 2}`, "rep", "2026-10-06"))];
    const day = reprocessMonitoringSnapshot(raw, request, reference)[0];
    expect(day.result.journey).toMatchObject({ status: "complete", firstEntry: Date.parse(stamp("22:00")), lastExit: Date.parse(stamp("06:20", "2026-10-06")) });
    expect(day.summary.workedSeconds).toBe(440 * 60);
    expect(day.summary.lateSeconds).toBeNull();
    expect(day.summary.bankDay?.deltaMinutes).toBeNull();
    schedule.payload = { ...(schedule.payload as object), pairing: "explicit" };
    expect(reprocessMonitoringSnapshot(raw, request, reference)[0].summary.workedSeconds).toBeNull();
  });

  it("conserva como ambígua a sequência sem escala próxima das batidas do próximo dia", () => {
    const raw = completeUnscheduledSnapshot();
    raw.events.push(event("punch", "03:00", "next-night", "rep", "2026-10-06"));
    expect(reprocessMonitoringSnapshot(raw, request, reference)[0].summary.workedSeconds).toBeNull();
  });

  it("entrada principal só registra acesso, sem exigir saída ou cobertura para qualidade completa", () => {
    const raw = snapshot();
    raw.settings = raw.settings.filter(row => !["mapping", "coverage"].includes(row.kind) || (row.payload as { area?: string }).area !== "perimeter");
    raw.settings.push(setting("mapping", "Entrada Principal", { pointId: "Entrada Principal", portalId: "principal", area: "perimeter", direction: "entry", validated: false, eventClasses: ["Desbloqueio por rosto"] }, "principal"));
    raw.events.push(event("access", "10:00", "principal-access", "Entrada Principal"));
    const original = structuredClone(raw);
    const day = reprocessMonitoringSnapshot(raw, request, reference)[0];
    expect(day.result.outsideCd).toMatchObject({ quality: "excluded", milliseconds: null, knownMs: 0, unknownMs: 0, intervals: [] });
    expect(day.result.location.some(interval => interval.area === "perimeter")).toBe(false);
    expect(day.summary).toMatchObject({ quality: "complete", outsideCdSeconds: null, workedSeconds: 480 * 60, restSeconds: 60 * 60 });
    expect(day.result.issues.some(issue => ["INCOMPLETE_AREA_MAPPING", "UNMAPPED_ACCESS_POINT", "AREA_COVERAGE_MISSING", "AREA_PAIR_COVERAGE_MISSING", "OPEN_AREA_PAIR"].includes(issue.code))).toBe(false);
    expect(raw).toEqual(original);
    expect(raw.events.find(row => row.id === "principal-access")).toBeDefined();
  });

  it("não usa entrada principal nem política legada para fabricar presença na operação", () => {
    const raw = snapshot();
    raw.events = raw.events.filter(row => row.payload.type === "punch");
    raw.events.push(event("access", "07:59", "principal-only", "Principal"));
    raw.settings.push(setting("mapping", "Principal", { pointId: "Principal", portalId: "principal", area: "perimeter", direction: "entry", validated: true, eventClasses: ["Desbloqueio por rosto"], effects: { operation: "inside", cafeteria: "outside" } }, "principal"));
    raw.settings.push(setting("policy", employeeId, { indicator: "outsideCd", scope: "person", exclude: false }, "old-policy"));
    const day = reprocessMonitoringSnapshot(raw, request, reference)[0];
    expect(day.result.outsideOperation).toMatchObject({ quality: "unavailable", milliseconds: null, knownMs: 0 });
    expect(day.result.outsideCd).toMatchObject({ quality: "excluded", milliseconds: null });
    expect(day.summary.quality).toBe("partial");
  });

  it("projeta histórico sem alterar jornada, banco, versão original ou eventos", () => {
    const day = reprocessMonitoringSnapshot(snapshot(), request, reference)[0];
    const legacy = {
      ...day.result, ruleVersion: "monitoring-1.4.0",
      outsideCd: { ...day.result.outsideCd, quality: "unavailable" as const, unknownMs: day.result.workMs!, eligibility: { state: "eligible" as const, policyIds: [], reasons: [] } },
      location: [...day.result.location, { ...day.result.location[0], area: "perimeter" as const, state: "unknown" as const }],
      betweenOperationExitAndPrincipalEntry: [{ start: Date.parse(stamp("14:00")), end: Date.parse(stamp("14:20")), exitEventId: "exit", entryEventId: "principal", label: "interval-between-events" as const }],
      issues: [
        { code: "INCOMPLETE_AREA_MAPPING", eventIds: [], detail: "Mapa incompleto de entrada/saída: perimeter" },
        { code: "AREA_COVERAGE_MISSING", eventIds: [], detail: "perimeter" },
        { code: "UNMAPPED_ACCESS_POINT", eventIds: ["principal"] },
        { code: "UNMAPPED_ACCESS_POINT", eventIds: ["other"] },
        { code: "REPEATED_DIRECTION_WITHOUT_PAIR", eventIds: ["principal", "operation"] },
      ],
    };
    const summary = { ...day.summary, quality: "partial" as const, outsideCdSeconds: 1200 };
    const original = structuredClone({ legacy, summary });
    const projected = projectMonitoringEntryControlOnly(legacy, summary, new Set(["principal"]));
    expect(projected.summary).toMatchObject({ quality: "complete", outsideCdSeconds: null, workedSeconds: summary.workedSeconds, restSeconds: summary.restSeconds });
    expect(projected.summary.bankDay).toBe(summary.bankDay);
    expect(projected.result.journey).toBe(legacy.journey);
    expect(projected.result.ruleVersion).toBe("monitoring-1.4.0");
    expect(projected.result.location.some(interval => interval.area === "perimeter")).toBe(false);
    expect(projected.result.betweenOperationExitAndPrincipalEntry).toEqual([]);
    expect(projected.result.issues).toEqual(legacy.issues.slice(3));
    expect({ legacy, summary }).toEqual(original);
  });

  it("qualidade ignora só perímetro; preserva jornada, operação, refeitório e atraso pendentes", () => {
    const result = reprocessMonitoringSnapshot(snapshot(), request, reference)[0].result;
    const oldPerimeter = { ...result.outsideCd, quality: "unavailable" as const, milliseconds: null };
    expect(summarizeCalculation({ ...result, outsideCd: oldPerimeter }, [], null).quality).toBe("complete");
    expect(summarizeCalculation({ ...result, cafeteria: { ...result.cafeteria, quality: "partial" } }, [], null).quality).toBe("partial");
    expect(summarizeCalculation({ ...result, journey: { ...result.journey, status: "ongoing" } }, [], null).quality).toBe("partial");
    expect(summarizeCalculation({ ...result, lateness: { ...result.lateness, quality: "unavailable" } }, [], null).quality).toBe("partial");
    expect(summarizeCalculation({ ...result, outsideOperation: { ...result.outsideOperation, quality: "excluded" } }, [], null).quality).toBe("excluded");
  });

  it("ponto observacional exige mapeamento da área; nome e conflito não são inferidos", () => {
    const event: AccessEvent = { id: "e", personId: employeeId, at: reference, pointId: "Entrada Principal", sourceId: "defense", eventClass: "face", authorized: true, identified: true };
    const map: AccessPointMapping = { id: "m", pointId: event.pointId, portalId: "principal", area: "perimeter", direction: "entry", validated: false, validFrom: date, eventClasses: ["face"] };
    expect(perimeterObservationEventIds([event], [], date).size).toBe(0);
    expect(perimeterObservationEventIds([event], [map], date)).toEqual(new Set(["e"]));
    expect(perimeterObservationEventIds([event], [map, { ...map, id: "other", area: "operation" }], date).size).toBe(0);
  });

  it("aplica repetição do torniquete abaixo de 60s mesmo com regra anterior de 10s e preserva banco", () => {
    const raw = snapshot();
    const schedule = raw.settings.find(row => row.kind === "schedule")!;
    schedule.payload = { ...(schedule.payload as object), lunchMinutes: 60, weeklyRosterConfirmed: true };
    raw.settings.push(setting("rule", "global", { punchRepeatSeconds: 60, accessRepeatSeconds: 10, initialLookbackSeconds: 3600, maxJourneyHours: 18, suppressUntypedPunches: false }));
    const first = raw.events.find(row => row.id === "a1")!;
    first.payload.timestamp = stamp("08:00");
    const confirmed = { ...raw, punchSourceIds: ["rep"], sources: [
      { id: "rep", kind: "afd", configuration: { sourceIdentityConfirmed: true, declaredCoverage: { from: stamp("00:00"), to: stamp("00:00", "2026-10-07"), continuous: true } } },
      ...raw.sources.filter(row => row.id !== "rep"),
    ] };
    const baseline = reprocessMonitoringSnapshot(confirmed, request, reference)[0];
    expect(baseline.summary.bankDay).toMatchObject({ state: "ready", deltaMinutes: 0 });
    raw.events.push({ ...structuredClone(first), id: "a1-repeat", payload: { ...structuredClone(first.payload), key: "a1-repeat", timestamp: `${date}T08:00:59-03:00` } });
    const original = structuredClone(raw);
    const result = reprocessMonitoringSnapshot(confirmed, request, reference)[0];
    expect(result.ruleVersion).toBe("monitoring-1.7.0");
    expect(result.result.suppressions).toContainEqual({ eventId: "a1-repeat", retainedEventId: "a1", rule: "access-repetition", ruleVersion: "turnstile-repetition-1.0.0", differenceMs: 59_000 });
    expect(result.result.outsideOperation).toEqual(baseline.result.outsideOperation);
    expect(result.result.journey).toEqual(baseline.result.journey);
    expect(result.summary.bankDay).toEqual(baseline.summary.bankDay);
    expect(raw).toEqual(original);
  });
  it("unifies clocks, deduplicates equivalent punches and posts only confirmed daily balances", () => {
    const raw = snapshot();
    raw.sources = ["rep", "second"].map(id => ({ id, kind: "afd", configuration: { sourceIdentityConfirmed: true, declaredCoverage: { from: stamp("00:00", "2026-10-01"), to: stamp("00:00", "2026-10-13"), continuous: true } } })) as unknown as typeof raw.sources;
    const schedule = raw.settings.find(row => row.kind === "schedule")!;
    schedule.payload = { ...(schedule.payload as object), lunchMinutes: 60, weeklyRosterConfirmed: true };
    raw.events[1].sourceId = "second"; raw.events[3].sourceId = "second";
    raw.events.push({ ...event("punch", "08:00", "duplicate"), sourceId: "second" });
    const result = reprocessMonitoringSnapshot({ ...raw, punchSourceIds: ["rep", "second"] }, request, reference)[0];
    expect(result.summary.bankDay).toMatchObject({ state: "ready", deltaMinutes: 0, suppressedIds: ["p1"] });
    expect(result.result.journey.retainedPunchIds).toHaveLength(4);
    schedule.payload = { ...(schedule.payload as object), weeklyRosterConfirmed: false };
    expect(reprocessMonitoringSnapshot({ ...raw, punchSourceIds: ["rep", "second"] }, request, reference)[0].summary.bankDay?.deltaMinutes).toBeNull();
  });
  it("uses an audited RH correction while preserving original punches and protecting leave", () => {
    const raw = snapshot(); raw.events = raw.events.filter(row => row.id !== "p3");
    const schedule = raw.settings.find(row => row.kind === "schedule")!;
    schedule.payload = { ...(schedule.payload as object), lunchMinutes: 60 };
    const corrected = { ...raw, corrections: [{ date, updatedAt: stamp("18:00"), reason: "Conferência RH com justificativa", punches: ["08:00", "12:00", "13:00", "17:00"].map(time => ({ at: stamp(time) })) }] };
    const result = reprocessMonitoringSnapshot(corrected, request, reference)[0];
    expect(result.summary.bankDay).toMatchObject({ state: "ready", deltaMinutes: 0 });
    expect(result.summary.bankDay?.originalPunches).toHaveLength(3);
    expect(result.summary.bankDay?.punches.every(punch => punch.sourceId === "rh-correction")).toBe(true);
    expect(reprocessMonitoringSnapshot({ ...corrected, protectedDates: [date] }, request, reference)[0].summary.bankDay?.deltaMinutes).toBeNull();
  });
  it("horário estimado não cria atraso mesmo com início e cobertura confirmados", () => {
    const raw = snapshot();
    const schedule = raw.settings.find(setting => setting.kind === "schedule")!;
    schedule.payload = { ...(schedule.payload as object), estimated: true, weeklyRosterConfirmed: false };
    raw.events[0].payload.timestamp = stamp("08:20");
    const result = reprocessMonitoringSnapshot(raw, request, reference)[0];
    expect(result.result.lateness).toMatchObject({ quality: "unavailable", totalMs: null, excessMs: null, over15Minutes: null });
    expect(result.summary.lateSeconds).toBeNull();
    expect(result.result.lateness.reason).toContain("Horário estimado");
  });

  it("coleta completa declarada de todos os relógios permite jornada, atraso e extra sem inventar almoço",()=>{
    const raw=snapshot() as ReturnType<typeof snapshot>&{punchSourceIds:string[]};raw.punchSourceIds=["rep"];
    raw.sources=[{id:"rep",kind:"afd",configuration:{sourceIdentityConfirmed:true,declaredCoverage:{from:stamp("00:00","2026-10-01"),to:stamp("00:00","2026-10-13"),continuous:true}}}] as unknown as typeof raw.sources;
    raw.settings=raw.settings.filter(s=>s.kind!=="evidence");
    const schedule=raw.settings.find(s=>s.kind==='schedule')!;schedule.payload={...(schedule.payload as object),lunchMinutes:60,estimated:false,weeklyRosterConfirmed:true};
    const result=reprocessMonitoringSnapshot(raw,request,reference)[0];expect(result.result.journey.status).toBe("complete");expect(result.summary.overtimeSeconds).toBe(0);expect(result.summary.expectedWorkSeconds).toBe(8*3600);
    expect(result.result.issues.some(i=>i.code==='JOURNEY_FROM_DECLARED_COMPLETE_AFD')).toBe(true);
    raw.events.find(e=>e.id==="p1")!.payload.timestamp=stamp("08:20");raw.events.find(e=>e.id==="p4")!.payload.timestamp=stamp("18:20");
    const extra=reprocessMonitoringSnapshot(raw,request,reference)[0];expect(extra.summary.lateSeconds).toBe(20*60);expect(extra.summary.overtimeSeconds).toBe(60*60);
    raw.punchSourceIds.push("missing-clock");expect(reprocessMonitoringSnapshot(raw,request,reference)[0].summary.workedSeconds).toBeNull();
    raw.punchSourceIds=["rep"];raw.sources[0].configuration={sourceIdentityConfirmed:true,declaredCoverage:{from:stamp("00:00"),to:stamp("12:00"),continuous:true}} as typeof raw.sources[0]['configuration'];
    expect(reprocessMonitoringSnapshot(raw,request,reference)[0].summary.overtimeSeconds).toBeNull();
  });
  it("converte snapshot confirmado em resultado e resumo coerentes", () => {
    const result = reprocessMonitoringSnapshot(snapshot(), request, reference)[0];
    expect(result.version).toBe(4);
    expect(result.summary.workedSeconds).toBe(480 * 60);
    expect(result.summary.restSeconds).toBe(60 * 60);
    expect(result.summary.outsideSeconds).toBe(20 * 60);
    expect(result.summary.late).toBe(false);
    expect(result.summary.quality).toBe("complete");
    expect(JSON.stringify(result)).not.toContain("DO_NOT_EXPOSE");
    expect(result.result.journey.retainedPunchIds).toEqual(["p1", "p2", "p3", "p4"]);
  });
  it("não transforma min/max de arquivo em cobertura nem confirmação de início", () => {
    const raw = snapshot();
    raw.settings = raw.settings.filter((setting) => !["coverage", "evidence"].includes(setting.kind));
    const result = reprocessMonitoringSnapshot(raw, request, reference)[0];
    expect(result.summary.workedSeconds).toBeNull();
    expect(result.summary.outsideSeconds).toBeNull();
    expect(result.summary.late).toBeNull();
    expect(result.summary.quality).toBe("unavailable");
  });
  it("fonte de relógio não confirmada bloqueia apuração mesmo com evidence true", () => {
    const raw = snapshot();
    raw.sources[0].configuration = { sourceIdentityConfirmed: false };
    const result = reprocessMonitoringSnapshot(raw, request, reference)[0];
    expect(result.summary.workedSeconds).toBeNull();
    expect(result.summary.lateSeconds).toBeNull();
    expect(result.result.issues.some((issue) => issue.code === "SOURCE_IDENTITY_UNCONFIRMED")).toBe(true);
  });
  it("fonte ausente também não prova identidade do equipamento", () => {
    const result = reprocessMonitoringSnapshot({ ...snapshot(), sources: [] }, request, reference)[0];
    expect(result.summary.workedSeconds).toBeNull();
  });
  it("batida em conflito não muda paridade silenciosamente", () => {
    const raw = snapshot();
    raw.events[1].conflicted = true;
    const result = reprocessMonitoringSnapshot(raw, request, reference)[0];
    expect(result.summary.workedSeconds).toBeNull();
    expect(result.result.issues.some((issue) => issue.code === "CONFLICTED_PUNCH_EVENTS_REQUIRE_REVIEW")).toBe(true);
  });
  it("reprocessa intervalo de dias com apurações separadas e sem inventar batidas", () => {
    const days = reprocessMonitoringSnapshot(snapshot(), { ...request, end: "2026-10-06" }, reference);
    expect(days).toHaveLength(2);
    expect(days[0].summary.workedSeconds).toBe(480 * 60);
    expect(days[1].summary.workedSeconds).toBeNull();
  });
  it("reconstrói noite e janela de café após meia-noite no dia correto", () => {
    const raw = snapshot();
    raw.settings[0] = setting("schedule", employeeId, { name: "Noturno", start: "22:00", end: "06:00", days: [0, 1, 2, 3, 4, 5, 6], allowNoBreak: false, pairing: "alternating", coffeeWindows: [{ start: "01:00", end: "01:30" }] });
    raw.events = [event("punch", "22:00", "p1"), event("punch", "02:00", "p2", "rep", "2026-10-06"), event("punch", "03:00", "p3", "rep", "2026-10-06"), event("punch", "06:00", "p4", "rep", "2026-10-06")];
    const result = reprocessMonitoringSnapshot(raw, request, reference)[0];
    expect(result.summary.workedSeconds).toBe(420 * 60);
    expect(result.result.operationalDate).toBe(date);
    expect(result.summary.late).toBe(false);
  });
  it("exclusão por grupo preserva cálculo de atraso", () => {
    const raw = snapshot();
    raw.settings.push(setting("group_snapshot", employeeId, { groups: ["OUTROS", "COZINHA JK"], evidence: "Histórico confirmado" }));
    raw.settings.push(setting("policy", "COZINHA JK", { indicator: "outsideOperation", scope: "group", exclude: true }));
    const result = reprocessMonitoringSnapshot(raw, request, reference)[0];
    expect(result.summary.outsideSeconds).toBeNull();
    expect(result.summary.late).toBe(false);
    expect(result.summary.quality).toBe("excluded");
    expect(result.summary.groups).toContain("COZINHA JK");
    expect(result.summary.exclusions).toHaveLength(1);
  });
  it("evidência só de outra pessoa não é aplicada", () => {
    const raw = snapshot();
    raw.settings[1].target = actor;
    expect(reprocessMonitoringSnapshot(raw, request, reference)[0].summary.workedSeconds).toBeNull();
  });
  it("rejeita sobreposição de configurações e payload externo inválido", () => {
    const raw = snapshot();
    raw.settings.push({ ...raw.settings[0], id: "conflicting-schedule" });
    expect(() => reprocessMonitoringSnapshot(raw, request, reference)).toThrow("MONITORING_CONFIGURATION_CONFLICT");
    expect(() => reprocessMonitoringSnapshot({ version: 1, events: "bad", settings: [] }, request, reference)).toThrow();
  });
  it("limita cada solicitação a 31 dias inclusivos", () => {
    expect(reprocessRequestSchema.safeParse({ ...request, start: "2026-10-01", end: "2026-10-31" }).success).toBe(true);
    expect(reprocessRequestSchema.safeParse({ ...request, start: "2026-10-01", end: "2026-11-01" }).success).toBe(false);
    expect(reprocessRequestSchema.safeParse({ ...request, start: "2026-10-07", end: "2026-10-05" }).success).toBe(false);
  });
});
