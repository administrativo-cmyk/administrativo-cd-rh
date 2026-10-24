import { assessBankDay, type BankDay } from "./bank-day";
import { z } from "zod";
import { rosterState, durationMinutes } from "./standard-schedules";
import { dateSchema, settingSchema, type MonitoringSetting } from "./contracts";
import { parseLocalTimestamp } from "./ingestion/validation";
import {
  calculateJourney, isEffective, normalizeGroups, RULE_VERSION, preparePunches, DEFAULT_REPETITION_POLICY, projectPerimeterAsObservation,
  type AccessEvent, type AccessPointMapping, type Coverage, type GroupSnapshot, type IndicatorPolicy,
  type JourneyCalculation, type JourneyCalculationInput, type PunchEvent, type Schedule,
} from "./domain";

export const reprocessRequestSchema = z.object({
  employeeId: z.string().uuid(), start: dateSchema, end: dateSchema, reason: z.string().trim().min(5).max(1000),
}).refine((request) => request.end >= request.start && Date.parse(request.end) - Date.parse(request.start) <= 30 * 86_400_000, "Período máximo: 31 dias");
export type ReprocessRequest = z.infer<typeof reprocessRequestSchema>;

const canonicalEventSchema = z.object({
  key: z.string().min(1), type: z.enum(["punch", "access"]), timestamp: z.string().datetime({ offset: true }),
  device: z.string(), classification: z.enum(["authorized", "denied", "alarm", "anonymous", "unknown"]),
  eligible: z.boolean(), precisionSeconds: z.number().positive(),
  identity: z.object({ type: z.enum(["cpf", "pis", "defense"]), value: z.string() }).nullable(),
  original: z.record(z.string()).default({}),
});
const provenanceSchema = z.object({ fileId: z.string().optional(), row: z.number().int().nonnegative().optional(), sourceId: z.string().optional() });
const snapshotSchema = z.object({
  corrections: z.array(z.object({ date: dateSchema, updatedAt: z.string(), reason: z.string(), punches: z.array(z.object({ at: z.string(), evidenceId: z.string().nullable().optional() })).length(4) })).default([]),
  protectedDates: z.array(dateSchema).default([]),
  version: z.number().int().nonnegative(),
  punchSourceIds: z.array(z.string()).default([]),
  calendar: z.array(z.object({ date: dateSchema, state: z.enum(["unchanged", "work", "off"]), id: z.string().optional(), name: z.string().optional() })).max(370).default([]).refine(rows => new Set(rows.map(row => row.date)).size === rows.length, "Calendário duplicado"),
  sources: z.array(z.object({ id: z.string(), kind: z.string(), configuration: z.object({ sourceIdentityConfirmed: z.boolean().optional() }).passthrough() })).default([]),
  events: z.array(z.object({
    id: z.string().min(1), sourceId: z.string().min(1), payload: canonicalEventSchema, eligible: z.boolean(), conflicted: z.boolean(),
    provenance: z.union([provenanceSchema, z.array(provenanceSchema)]).optional(),
  })).max(200_000),
  settings: z.array(z.object({
    id: z.string().min(1), kind: z.string(), target: z.string(), valid_from: dateSchema, valid_to: dateSchema.nullable(),
    payload: z.unknown(), reason: z.string(), created_by: z.string().nullable(), created_at: z.string(), revoked_at: z.string().nullable(),
  })).max(20_000),
});
type RawSnapshot = z.infer<typeof snapshotSchema>;
type Setting = MonitoringSetting & { id: string; author: string };
type ScheduleSetting = Extract<MonitoringSetting, { kind: "schedule" }> & { id: string; author: string };

export interface ReprocessedDay {
  employeeId: string;
  date: string;
  version: number;
  ruleVersion: string;
  result: JourneyCalculation;
  summary: MonitoringResultSummary;
}
export interface MonitoringResultSummary {
  workedSeconds: number | null;
  restSeconds: number;
  outsideSeconds: number | null;
  cafeteriaSeconds: number | null;
  mealsWithoutRest: number | null;
  mealQuality: string;
  outsideQuality: string;
  cafeteriaQuality: string;
  cafeSeconds: number | null;
  outsideCdSeconds: number | null;
  unknownSeconds: number;
  lateSeconds: number | null;
  late: boolean | null;
  quality: "complete" | "partial" | "unavailable" | "excluded";
  coverageRatio: number | null;
  groups: string[];
  exclusions: string[];
  scheduleName: string | null;
  expectedWorkSeconds?: number | null;
  overtimeSeconds?: number | null;
  bankDay?: BankDay;
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
function localInstant(date: string, time: string): number {
  return Date.parse(parseLocalTimestamp(`${date}T${time}:00`, "America/Sao_Paulo"));
}
function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date = shiftDate(date, 1)) dates.push(date);
  return dates;
}
function uniqueSetting(settings: Setting[], kind: MonitoringSetting["kind"], employeeId: string, date: string): Setting | null {
  const matches = settings.filter((setting) => setting.kind === kind && (setting.target === employeeId || (kind === "rule" && setting.target === "global")) && isEffective(setting, date));
  const personal = matches.filter((setting) => setting.target === employeeId);
  const chosen = personal.length ? personal : matches;
  if (chosen.length > 1) throw Object.assign(new Error("MONITORING_CONFIGURATION_CONFLICT"), { code: "MONITORING_CONFIGURATION_CONFLICT" });
  return chosen[0] ?? null;
}
function scheduleFor(settings: Setting[], employeeId: string, date: string, calendar: RawSnapshot["calendar"] = []): ScheduleSetting | null {
  if (calendar.some(day => day.date === date && day.state === "off")) return null;
  const setting = uniqueSetting(settings, "schedule", employeeId, date);
  if (!setting || setting.kind !== "schedule") return null;
  const state = rosterState(setting.payload, date);
  return state === "off" ? null : state === "pending" ? { ...setting, payload: { ...setting.payload, weeklyRosterConfirmed: false } } : setting;
}
function scheduleTimes(setting: ScheduleSetting, date: string): { start: number; end: number } {
  return { start: localInstant(date, setting.payload.start), end: localInstant(setting.payload.end <= setting.payload.start ? shiftDate(date, 1) : date, setting.payload.end) };
}
function attributionFor(settings: Setting[], employeeId: string, date: string, calendar: RawSnapshot["calendar"]): ScheduleSetting | null {
  const regular = scheduleFor(settings, employeeId, date, calendar);
  if (regular) return regular;
  const base = uniqueSetting(settings, "schedule", employeeId, date);
  return base?.kind === "schedule" ? base : null;
}
function windowFor(settings: Setting[], employeeId: string, date: string, setting: ScheduleSetting | null, calendar: RawSnapshot["calendar"] = []): { start: number; end: number } {
  if (!setting) return { start: localInstant(date, "00:00"), end: localInstant(shiftDate(date, 1), "00:00") };
  const current = scheduleTimes(setting, date);
  const previousDate = shiftDate(date, -1);
  const nextDate = shiftDate(date, 1);
  const previous = scheduleTimes(attributionFor(settings, employeeId, previousDate, calendar) ?? setting, previousDate);
  const next = scheduleTimes(attributionFor(settings, employeeId, nextDate, calendar) ?? setting, nextDate);
  if (previous.end > current.start || next.start < current.end) throw Object.assign(new Error("MONITORING_SCHEDULE_OVERLAP"), { code: "MONITORING_SCHEDULE_OVERLAP" });
  return { start: Math.floor((previous.end + current.start) / 2), end: Math.floor((current.end + next.start) / 2) };
}
function seconds(value: number | null): number | null { return value === null ? null : value / 1000; }
function completePunchCollection(snapshot: RawSnapshot, start: number, end: number): boolean {
  const linked = snapshot.sources.filter(source => snapshot.punchSourceIds.includes(source.id));
  return snapshot.punchSourceIds.length > 0 && linked.length === snapshot.punchSourceIds.length && linked.every(source => {
    const coverage = source.configuration.declaredCoverage as { from?: string; to?: string; continuous?: boolean } | undefined;
    return source.kind === "afd" && source.configuration.sourceIdentityConfirmed === true && coverage?.continuous === true
      && Date.parse(coverage.from ?? "") <= start && Date.parse(coverage.to ?? "") >= end;
  });
}
/** Without a roster, require a full 12h collection margin without adjacent-day
 * punches. This conservatively prevents splitting a night shift at midnight. */
function isolatedUnscheduledSequence(snapshot: RawSnapshot, punches: PunchEvent[], window: { start: number; end: number }, referenceAt: number): boolean {
  if (!punches.length) return false;
  const start = punches[0].at - 12 * 3_600_000;
  const end = punches.at(-1)!.at + 12 * 3_600_000;
  return end <= referenceAt && completePunchCollection(snapshot, start, end) && !snapshot.events.some(event => {
    const at = Date.parse(event.payload.timestamp);
    return event.payload.type === "punch" && at > start && at < end && (at < window.start || at >= window.end);
  });
}
function provenanceFor(event: RawSnapshot["events"][number]) {
  const occurrences = (Array.isArray(event.provenance) ? event.provenance : event.provenance ? [event.provenance] : []).map((item) => ({ ...item, sourceId: item.sourceId ?? event.sourceId }));
  return { sourceId: event.sourceId, fileId: occurrences[0]?.fileId, row: occurrences[0]?.row, occurrences };
}

export function summarizeCalculation(result: JourneyCalculation, groups: string[], scheduleName: string | null): MonitoringResultSummary {
  const metrics = [result.outsideOperation, result.cafeteria];
  const hasKnown = result.workMs !== null || metrics.some((metric) => metric.milliseconds !== null) || result.lateness.totalMs !== null;
  const quality = result.outsideOperation.quality === "excluded" ? "excluded" : !hasKnown ? "unavailable" : result.journey.status !== "complete" || metrics.some((metric) => ["partial", "unavailable"].includes(metric.quality)) || result.lateness.quality === "unavailable" ? "partial" : "complete";
  return {
    workedSeconds: seconds(result.workMs), restSeconds: result.restMs / 1000,
    outsideSeconds: seconds(result.outsideOperation.milliseconds), cafeteriaSeconds: seconds(result.cafeteria.milliseconds),
    mealsWithoutRest: result.mealsWithoutRest?.count ?? null, mealQuality: result.mealsWithoutRest?.quality ?? "unavailable",
    outsideQuality: result.outsideOperation.quality, cafeteriaQuality: result.cafeteria.quality,
    cafeSeconds: seconds(result.coffeeDuringWorkMs), outsideCdSeconds: null,
    unknownSeconds: result.outsideOperation.unknownMs / 1000, lateSeconds: seconds(result.lateness.totalMs), late: result.lateness.over15Minutes,
    quality, coverageRatio: result.outsideOperation.coverageRatio, groups,
    exclusions: [...metrics, result.lateness].flatMap((metric) => metric.eligibility.state === "excluded" ? metric.eligibility.reasons : []), scheduleName,
  };
}

/** Query-time compatibility projection. It does not relabel the original rule
 * version or recompute work, corrections, attendance or bank balances.
 */
export function projectMonitoringEntryControlOnly(result: JourneyCalculation, summary: MonitoringResultSummary, observationEventIds: ReadonlySet<string> = new Set()): { result: JourneyCalculation; summary: MonitoringResultSummary } {
  const projected = projectPerimeterAsObservation(result, observationEventIds);
  return { result: projected, summary: { ...summary, ...summarizeCalculation(projected, summary.groups, summary.scheduleName) } };
}

/** Validate the DB envelope at the boundary; never infer trusted evidence from observed timestamps. */
export function reprocessMonitoringSnapshot(raw: unknown, request: ReprocessRequest, referenceAt: number): ReprocessedDay[] {
  reprocessRequestSchema.parse(request);
  if (!Number.isSafeInteger(referenceAt)) throw new Error("INVALID_REFERENCE");
  const snapshot: RawSnapshot = snapshotSchema.parse(raw);
  const settings: Setting[] = snapshot.settings.filter((setting) => setting.revoked_at === null).map((setting) => ({
    ...settingSchema.parse({ kind: setting.kind, target: setting.target, validFrom: setting.valid_from, validTo: setting.valid_to, reason: setting.reason, payload: setting.payload }),
    id: setting.id, author: setting.created_by ?? "migration",
  }));
  const allDates = datesBetween(request.start, request.end);
  return allDates.map((date) => {
    const scheduled = scheduleFor(settings, request.employeeId, date, snapshot.calendar);
    const calendar = snapshot.calendar.find(day => day.date === date);
    const attribution = attributionFor(settings, request.employeeId, date, snapshot.calendar);
    const window = windowFor(settings, request.employeeId, date, attribution, snapshot.calendar);
    if (window.start > referenceAt) throw Object.assign(new Error("MONITORING_FUTURE_PERIOD"), { code: "MONITORING_FUTURE_PERIOD",availableAt:window.start });
    const observationWindow = { start: window.start, end: Math.min(window.end, referenceAt) };
    const active = settings.filter((setting) => isEffective(setting, date));
    const evidenceSetting = uniqueSetting(settings, "evidence", request.employeeId, date);
    const ruleSetting = uniqueSetting(settings, "rule", request.employeeId, date);
    const rule = ruleSetting?.kind === "rule" ? ruleSetting.payload : null;
    const evidencePayload = evidenceSetting?.kind === "evidence" ? evidenceSetting.payload : null;
    const evidence = {
      startConfirmed: evidencePayload?.startConfirmed ?? false, endConfirmed: evidencePayload?.endConfirmed ?? false,
      startCoverageConfirmed: evidencePayload?.startCoverageConfirmed ?? false, ongoingConfirmed: evidencePayload?.ongoingConfirmed ?? false,
      punchCoverageUntil: evidencePayload?.punchCoverageUntil ? Date.parse(evidencePayload.punchCoverageUntil) : undefined,
    };
    const selectedEvents = snapshot.events.filter((event) => Date.parse(event.payload.timestamp) < window.end && Date.parse(event.payload.timestamp) <= referenceAt);
    const punchEvents: PunchEvent[] = selectedEvents.filter((event) => event.payload.type === "punch" && event.eligible && event.payload.eligible && !event.conflicted && Date.parse(event.payload.timestamp) >= window.start).map((event) => ({
      id: event.id, personId: request.employeeId, at: Date.parse(event.payload.timestamp), sourceId: event.sourceId,
      precision: event.payload.precisionSeconds >= 60 ? "minute" : event.payload.precisionSeconds >= 1 ? "second" : "millisecond",
      role: evidencePayload?.punchRoles?.[event.id] ?? evidencePayload?.punchRoles?.[event.payload.key],
      provenance: provenanceFor(event),
    }));
    const accessEvents: AccessEvent[] = selectedEvents.filter((event) => event.payload.type === "access").map((event) => ({
      id: event.id, personId: event.payload.identity ? request.employeeId : null, at: Date.parse(event.payload.timestamp), sourceId: event.sourceId,
      pointId: event.payload.device, eventClass: event.payload.original.eventName || event.payload.classification,
      authorized: event.eligible && event.payload.eligible && event.payload.classification === "authorized" && !event.conflicted,
      identified: event.payload.identity !== null,
      provenance: provenanceFor(event),
    }));
    for (const setting of active) if (setting.kind === "manual_event" && setting.target === request.employeeId) {
      const at = Date.parse(setting.payload.at);
      if (at <= referenceAt) accessEvents.push({ id: `manual:${setting.id}`, personId: request.employeeId, at, sourceId: setting.payload.sourceId, pointId: setting.payload.pointId,
        eventClass: setting.payload.eventClass, authorized: true, identified: true,
        provenance: { sourceId: setting.payload.sourceId, origin: "manual", justification: setting.payload.justification },
      });
    }
    // Full declared collection + an unambiguous alternating sequence is independent
    // evidence. File min/max and the partial export never establish these boundaries.
    const fullCollection = completePunchCollection(snapshot, window.start, window.end);
    const originalPunches = selectedEvents.filter(event => event.payload.type === "punch" && Date.parse(event.payload.timestamp) >= window.start).map(event => ({id:event.id,at:Date.parse(event.payload.timestamp),sourceId:event.sourceId}));
    const correction = snapshot.corrections.find(row => row.date === date);
    if (correction) {
      punchEvents.splice(0, punchEvents.length, ...correction.punches.map((punch, i) => ({
        id: `correction:${date}:${i}:${correction.updatedAt}`, personId: request.employeeId, at: Date.parse(punch.at), sourceId: "rh-correction",
        precision: "second" as const, role: (["start", "breakStart", "breakEnd", "end"] as const)[i],
        provenance: { sourceId: "rh-correction", origin: "manual" as const, justification: correction.reason },
      })));
    }
    const sortedPunches = preparePunches(punchEvents, DEFAULT_REPETITION_POLICY).events;
    const autoBoundaries = (!evidenceSetting || correction) && (fullCollection || correction) && window.end <= referenceAt
      && sortedPunches.length >= 4 && sortedPunches.length <= 6 && sortedPunches.length % 2 === 0
      && sortedPunches.every((p,index)=>index===0 || p.at-sortedPunches[index-1].at >= 120_000)
      && (attribution || correction || isolatedUnscheduledSequence(snapshot, sortedPunches, window, referenceAt))
      && !selectedEvents.some(event=>event.payload.type==="punch" && event.conflicted && Date.parse(event.payload.timestamp)>=window.start);
    if (autoBoundaries) { evidence.startConfirmed=true; evidence.endConfirmed=true; evidence.startCoverageConfirmed=true; }
    const mappings: AccessPointMapping[] = active.flatMap((setting) => setting.kind === "mapping" ? [{ ...setting.payload, id: setting.id, validFrom: setting.validFrom, validTo: setting.validTo }] : []);
    const coverage: Coverage[] = active.flatMap((setting) => setting.kind === "coverage" ? [{ ...setting.payload, start: Date.parse(setting.payload.start), end: Date.parse(setting.payload.end) }] : []);
    const groupSnapshots: GroupSnapshot[] = active.flatMap((setting) => setting.kind === "group_snapshot" && setting.target === request.employeeId ? [{ ...setting.payload, validFrom: setting.validFrom, validTo: setting.validTo }] : []);
    const indicatorPolicies: IndicatorPolicy[] = active.flatMap((setting) => setting.kind === "policy" ? [{ id: setting.id, indicator: setting.payload.indicator, subjectType: setting.payload.scope, subject: setting.target,
      effect: setting.payload.exclude ? "exclude" : "include", reason: setting.reason, author: setting.author, validFrom: setting.validFrom, validTo: setting.validTo }] : []);
    const times = scheduled ? scheduleTimes(scheduled, date) : null;
    const schedule: Schedule | null = scheduled && times ? { id: scheduled.id, expectedStart: times.start, expectedEnd: times.end, pairing: scheduled.payload.pairing, allowNoBreak: scheduled.payload.allowNoBreak, maxSpanMs: (rule?.maxJourneyHours ?? 24) * 3_600_000 } : null;
    const coffeeWindows = scheduled?.payload.coffeeWindows.map((coffee) => {
      const coffeeDate = scheduled.payload.end <= scheduled.payload.start && coffee.start < scheduled.payload.start ? shiftDate(date, 1) : date;
      return { start: localInstant(coffeeDate, coffee.start), end: localInstant(coffee.end <= coffee.start ? shiftDate(coffeeDate, 1) : coffeeDate, coffee.end) };
    });
    const calculationInput: JourneyCalculationInput = {
      personId: request.employeeId, operationalDate: date, observationWindow, referenceAt,
      punchEvents, accessEvents, mappings, coverage, schedule, evidence, coffeeWindows, groupSnapshots, indicatorPolicies,
      punchPairing: autoBoundaries ? attribution?.payload.pairing ?? "alternating" : undefined,
      maxJourneySpanMs: (rule?.maxJourneyHours ?? 24) * 3_600_000,
      punchCollectionComplete: fullCollection && Boolean(scheduled && !scheduled.payload.estimated),
      initialLookbackMs: (rule?.initialLookbackSeconds ?? 43_200) * 1000,
      repetitionPolicy: rule ? { punchWindowMs: rule.punchRepeatSeconds * 1000, accessWindowMs: rule.accessRepeatSeconds * 1000, suppressUntypedPunches: rule.suppressUntypedPunches, version: `${RULE_VERSION}:${ruleSetting!.id}` } : undefined,
    };
    const result = calculateJourney(calculationInput);
    if (autoBoundaries) result.issues.push({code:"JOURNEY_FROM_DECLARED_COMPLETE_AFD",eventIds:punchEvents.map(p=>p.id),detail:"Sequência alternada em coleta integral declarada dos relógios vinculados."});
    if ((scheduled?.payload.estimated || scheduled?.payload.weeklyRosterConfirmed === false) && result.lateness.quality !== "excluded") {
      result.lateness = { ...result.lateness, quality: "unavailable", totalMs: null, excessMs: null, over15Minutes: null,
        reason: "Horário estimado pelo ponto; atraso exige escala confirmada." };
    }
    if (calendar && calendar.state !== "unchanged") result.issues.push({ code: calendar.state === "off" ? "CALENDAR_NON_WORKING_DAY" : "CALENDAR_WORKING_OVERRIDE", eventIds: [], detail: calendar.name });
    const conflictingPunches = (correction ? [] : selectedEvents).filter((event) => event.payload.type === "punch" && event.conflicted && Date.parse(event.payload.timestamp) >= window.start);
    const unconfirmedSources = punchEvents.filter((event) => event.sourceId !== "rh-correction" && !snapshot.sources.some((source) => source.id === event.sourceId && source.kind === "afd" && source.configuration.sourceIdentityConfirmed === true));
    const bankSchedule = attributionFor(settings, request.employeeId, date, snapshot.calendar);
    const bankTimes = bankSchedule ? scheduleTimes(bankSchedule, date) : null;
    const bankDay = assessBankDay({ date, punches: punchEvents, accesses: accessEvents, mappings,
      schedule: bankSchedule && bankTimes && bankSchedule.payload.lunchMinutes !== undefined ? { start: bankTimes.start, end: bankTimes.end, lunchMinutes: bankSchedule.payload.lunchMinutes, confirmed: !bankSchedule.payload.estimated && bankSchedule.payload.weeklyRosterConfirmed !== false && rosterState(bankSchedule.payload, date) !== "pending", ...(!scheduled ? {expectedMinutes:0} : {}) } : null,
      closed: window.end <= referenceAt, collectionComplete: fullCollection || Boolean(correction),
      protected: snapshot.protectedDates.includes(date), conflicted: conflictingPunches.length > 0 || unconfirmedSources.length > 0,
    });
    if (correction || conflictingPunches.length || unconfirmedSources.length) bankDay.originalPunches = originalPunches;
    if (conflictingPunches.length || unconfirmedSources.length) {
      if (conflictingPunches.length) result.issues.push({ code: "CONFLICTED_PUNCH_EVENTS_REQUIRE_REVIEW", eventIds: conflictingPunches.map((event) => event.id) });
      if (unconfirmedSources.length) result.issues.push({ code: "SOURCE_IDENTITY_UNCONFIRMED", eventIds: unconfirmedSources.map((event) => event.id) });
      // A removed conflicting punch can change parity. All dependent intervals must stay unavailable.
      const unavailable = calculateJourney({ ...calculationInput, evidence: { startConfirmed: false, endConfirmed: false, startCoverageConfirmed: false } });
      unavailable.issues.push(...result.issues.filter((issue) => ["CONFLICTED_PUNCH_EVENTS_REQUIRE_REVIEW", "SOURCE_IDENTITY_UNCONFIRMED", "CALENDAR_NON_WORKING_DAY", "CALENDAR_WORKING_OVERRIDE"].includes(issue.code)));
      return { employeeId: request.employeeId, date, version: snapshot.version, ruleVersion: RULE_VERSION, result: unavailable,
        summary: { ...summarizeCalculation(unavailable, groupSnapshots.length === 1 ? normalizeGroups(groupSnapshots[0].groups) : [], scheduled?.payload.name ?? null), bankDay } };
    }
    return { employeeId: request.employeeId, date, version: snapshot.version, ruleVersion: RULE_VERSION, result,
      summary: { bankDay, ...summarizeCalculation(result, groupSnapshots.length === 1 ? normalizeGroups(groupSnapshots[0].groups) : [], scheduled?.payload.name ?? null),
        expectedWorkSeconds: scheduled?.payload.lunchMinutes !== undefined ? (durationMinutes(scheduled.payload.start, scheduled.payload.end)-scheduled.payload.lunchMinutes)*60 : null,
        overtimeSeconds: scheduled && !scheduled.payload.estimated && scheduled.payload.lunchMinutes !== undefined && result.journey.status === "complete" && result.workMs !== null
          ? Math.max(0, result.workMs/1000-(durationMinutes(scheduled.payload.start,scheduled.payload.end)-scheduled.payload.lunchMinutes)*60) : null } };
  });
}

/** Same pure adapter for a queued job. Reference time remains explicit and testable. */
export const buildReprocessResults = reprocessMonitoringSnapshot;
