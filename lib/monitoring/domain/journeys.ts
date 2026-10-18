import { assertInstant, durationMs, normalizeIntervals } from "./intervals";
import type { Journey, JourneyCalculationInput, PunchEvent } from "./types";

/** Caller supplies the operational journey window from a confirmed schedule or reconciliation. */
export function reconstructJourney(input: JourneyCalculationInput, punches: readonly PunchEvent[]): Journey {
  const result: Journey = { status: "empty", work: [], rest: [], provisionalWork: [], firstEntry: null, lastExit: null, retainedPunchIds: punches.map((punch) => punch.id), issues: [] };
  if (!punches.length) return result;
  const { evidence, schedule } = input;
  if (schedule) {
    assertInstant(schedule.expectedStart);
    assertInstant(schedule.expectedEnd);
    if (schedule.expectedEnd <= schedule.expectedStart) throw new Error("INVALID_SCHEDULE");
  }
  if (punches.some((punch, index) => index > 0 && punch.at === punches[index - 1].at)) {
    result.status = "inconsistent";
    result.issues.push({ code: "SIMULTANEOUS_PUNCHES", eventIds: punches.map((punch) => punch.id) });
    return result;
  }
  const first = punches[0];
  const final = punches.at(-1)!;
  const typed = punches.every((punch) => punch.role !== undefined);
  const startConfirmed = evidence.startConfirmed && (first.role === "start" || (!first.role && schedule?.pairing === "alternating"));
  if (!startConfirmed) {
    result.status = "partial";
    result.issues.push({ code: "JOURNEY_START_UNCONFIRMED", eventIds: [first.id] });
    return result;
  }
  result.firstEntry = first.at;
  const maxSpan = schedule?.maxSpanMs ?? 24 * 60 * 60 * 1000;
  if (final.at - first.at > maxSpan) {
    result.status = "inconsistent";
    result.issues.push({ code: "JOURNEY_EXCEEDS_MAX_SPAN", eventIds: [first.id, final.id] });
    return result;
  }
  if (!typed && punches.some((punch) => punch.role !== undefined)) {
    result.status = "inconsistent";
    result.issues.push({ code: "MIXED_PUNCH_ROLES", eventIds: punches.map((punch) => punch.id) });
    return result;
  }
  if (!typed && schedule?.pairing !== "alternating") {
    result.status = "partial";
    result.issues.push({ code: "PAIRING_RULE_MISSING", eventIds: punches.map((punch) => punch.id) });
    return result;
  }
  if (typed) {
    for (let i = 0; i < punches.length; i += 1) {
      const expected = i === 0 ? "start" : i % 2 === 0 ? "breakEnd" : i === punches.length - 1 && evidence.endConfirmed ? "end" : "breakStart";
      if (punches[i].role !== expected) {
        result.status = "inconsistent";
        result.issues.push({ code: "INCOMPATIBLE_PUNCH_ROLES", eventIds: [punches[i].id] });
        return result;
      }
    }
  }
  // Two untyped marks alone cannot prove a full shift with no official break.
  if (punches.length === 2 && !typed && !schedule?.allowNoBreak && evidence.endConfirmed) {
    result.status = "partial";
    result.issues.push({ code: "TWO_PUNCHES_AMBIGUOUS", eventIds: [first.id, final.id] });
    return result;
  }
  for (let i = 0; i + 1 < punches.length; i += 1) {
    const interval = { start: punches[i].at, end: punches[i + 1].at };
    if (i % 2 === 0) result.work.push(interval);
    else result.rest.push(interval);
  }
  const closed = punches.length % 2 === 0 && evidence.endConfirmed && (!typed || final.role === "end");
  if (closed) {
    result.status = "complete";
    result.lastExit = final.at;
  } else {
    result.status = "partial";
    result.issues.push({ code: "JOURNEY_END_UNCONFIRMED", eventIds: [final.id] });
    if (evidence.ongoingConfirmed && evidence.punchCoverageUntil !== undefined && punches.length % 2 === 1) {
      const until = Math.min(input.referenceAt, evidence.punchCoverageUntil, first.at + maxSpan);
      assertInstant(until);
      if (until > final.at) {
        result.provisionalWork = [{ start: final.at, end: until }];
        result.work = normalizeIntervals([...result.work, ...result.provisionalWork]);
        result.status = "ongoing";
      }
    }
  }
  if (!durationMs(result.work)) result.issues.push({ code: "WORK_DURATION_UNAVAILABLE", eventIds: [] });
  return result;
}

export interface JourneyWindow { id: string; operationalDate: string; start: number; end: number }

/** Overlapping candidate windows remain ambiguous; unmatched punches remain pending. */
export function assignPunchesToJourneys(punches: readonly PunchEvent[], windows: readonly JourneyWindow[]): { assignments: Record<string, PunchEvent[]>; unassigned: PunchEvent[]; ambiguous: PunchEvent[] } {
  const assignments: Record<string, PunchEvent[]> = Object.fromEntries(windows.map((window) => [window.id, []]));
  const unassigned: PunchEvent[] = [];
  const ambiguous: PunchEvent[] = [];
  for (const punch of punches) {
    const matches = windows.filter((window) => punch.at >= window.start && punch.at < window.end);
    if (matches.length === 1) assignments[matches[0].id].push(punch);
    else if (matches.length > 1) ambiguous.push(punch);
    else unassigned.push(punch);
  }
  return { assignments, unassigned, ambiguous };
}
