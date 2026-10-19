import { describe, expect, it } from "vitest";
import { reprocessMonitoringSnapshot, reprocessRequestSchema } from "./reprocess";

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

describe("adaptação de snapshot persistido ao motor", () => {
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
