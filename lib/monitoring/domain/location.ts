import { covers, intersectIntervals, normalizeIntervals } from "./intervals";
import type { MappedAccess } from "./events";
import type { Area, Coverage, Interval, Issue, LocationInterval, LocationState } from "./types";

export const AREAS: readonly Area[] = ["operation", "cafeteria", "perimeter"];

export function completeCoverage(coverage: readonly Coverage[], area: Area): Interval[] {
  return normalizeIntervals(coverage.filter((item) => item.area === area && item.declaredComplete && item.evidence.trim() && item.sourceIds.length));
}

function eventCovered(event: MappedAccess, coverage: readonly Coverage[], area: Area, through?: number): boolean {
  return coverage.some((item) => item.area === area && item.declaredComplete && item.evidence.trim() && item.sourceIds.includes(event.event.sourceId) && item.start <= event.event.at && (through ?? event.event.at) <= item.end);
}

function coverageSignature(coverage: readonly Coverage[], area: Area, interval: Interval): string {
  return [...new Set(coverage.filter((item) => item.area === area && item.declaredComplete && item.evidence.trim() && item.sourceIds.length
    && item.start <= interval.start && item.end >= interval.end).map((item) => [...new Set(item.sourceIds)].sort().join("\u0000")))].sort().join("\u0001");
}

function pairCoverage(coverage: readonly Coverage[], area: Area, interval: Interval, entrySource: string, exitSource: string): boolean {
  const groups = new Map<string, Interval[]>();
  for (const item of coverage) {
    if (item.area !== area || !item.declaredComplete || !item.evidence.trim() || !item.sourceIds.includes(entrySource) || !item.sourceIds.includes(exitSource)) continue;
    const key = [...new Set(item.sourceIds)].sort().join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].some((intervals) => covers(intervals, interval));
}

export function locationTimeline(events: readonly MappedAccess[], coverage: readonly Coverage[], observationWindow: Interval, lookbackMs: number, initialReferenceAt = observationWindow.start, areas: readonly Area[] = AREAS): { intervals: LocationInterval[]; issues: Issue[] } {
  const intervals: LocationInterval[] = [];
  const issues: Issue[] = [];
  const scanStart = observationWindow.start - lookbackMs;
  for (const area of areas) {
    const complete = completeCoverage(coverage, area);
    const relevant = events.filter((event) => event.effects[area] && event.event.at >= scanStart && event.event.at <= observationWindow.end);
    const boundaries = [...new Set([scanStart, observationWindow.start, observationWindow.end, initialReferenceAt,
      ...coverage.filter((item) => item.area === area).flatMap((interval) => [interval.start, interval.end]), ...relevant.map((event) => event.event.at)])]
      .filter((at) => at >= scanStart && at <= observationWindow.end).sort((a, b) => a - b);
    let state: LocationState = "unknown";
    let evidenceEventIds: string[] = [];
    let evidenceAt: number | null = null;
    let primaryAnchor: MappedAccess | null = null;
    const own: LocationInterval[] = [];
    let eventIndex = 0;
    for (let i = 0; i + 1 < boundaries.length; i += 1) {
      const at = boundaries[i];
      const end = boundaries[i + 1];
      const covered = covers(complete, { start: at, end });
      const previousCovered = i > 0 && covers(complete, { start: boundaries[i - 1], end: at });
      const changedSources = i > 0 && coverageSignature(coverage, area, { start: at, end }) !== coverageSignature(coverage, area, { start: boundaries[i - 1], end: at });
      if (!covered || !previousCovered || changedSources || (at === initialReferenceAt && evidenceAt !== null && evidenceAt < initialReferenceAt - lookbackMs)) {
        state = "unknown"; evidenceEventIds = []; primaryAnchor = null; evidenceAt = null;
      }
      while (eventIndex < relevant.length && relevant[eventIndex].event.at < at) eventIndex += 1;
      const atTime: MappedAccess[] = [];
      while (eventIndex < relevant.length && relevant[eventIndex].event.at === at) {
        const candidate = relevant[eventIndex++];
        if (eventCovered(candidate, coverage, area, end)) atTime.push(candidate);
      }
      if (covered && atTime.length) {
        const states = new Set(atTime.map((event) => event.effects[area]));
        evidenceEventIds = atTime.map((event) => event.event.id);
        evidenceAt = at;
        if (states.size > 1) {
          state = "unknown";
          primaryAnchor = null;
          issues.push({ code: "SIMULTANEOUS_TRANSITION_CONFLICT", eventIds: evidenceEventIds });
        } else {
          const primary = atTime.find((event) => event.mapping.area === area);
          if (primary && primaryAnchor && primary.mapping.direction === primaryAnchor.mapping.direction) {
            issues.push({ code: "REPEATED_DIRECTION_WITHOUT_PAIR", eventIds: [primaryAnchor.event.id, primary.event.id] });
            // A missing opposite passage makes the earlier interval untrustworthy.
            for (const interval of own) if (interval.start >= primaryAnchor.event.at) { interval.state = "unknown"; interval.evidenceEventIds = []; }
          }
          state = atTime[0].effects[area]!;
          if (primary) primaryAnchor = primary;
          else if (primaryAnchor && state !== primaryAnchor.effects[area]) primaryAnchor = null;
        }
      }
      if (at >= observationWindow.start && at < end) own.push({ start: at, end, area, state: covered ? state : "unknown", evidenceEventIds: [...evidenceEventIds] });
    }
    // Keep event boundaries for explanation. These intervals still form a disjoint partition.
    intervals.push(...own);
  }
  return { intervals, issues };
}

export interface AreaPair extends Interval { entry: MappedAccess; exit: MappedAccess }

/** Exact visits require a real entry and exit, valid topology and continuous declared coverage. */
export function pairedAreaIntervals(events: readonly MappedAccess[], coverage: readonly Coverage[], area: Area, desired: "inside" | "outside", scope: Interval): { pairs: AreaPair[]; issues: Issue[] } {
  const relevant = events.filter((event) => event.mapping.area === area && event.event.at >= scope.start && event.event.at <= scope.end);
  const pairs: AreaPair[] = [];
  const issues: Issue[] = [];
  let open: MappedAccess | null = null;
  let ambiguous = false;
  for (let i = 0; i < relevant.length; i += 1) {
    const current = relevant[i];
    const simultaneous: MappedAccess[] = [current];
    let next = i + 1;
    while (relevant[next]?.event.at === current.event.at) simultaneous.push(relevant[next++]);
    if (new Set(simultaneous.map((event) => event.mapping.direction)).size > 1) {
      open = null;
      ambiguous = false;
      issues.push({ code: "SIMULTANEOUS_PAIR_CONFLICT", eventIds: simultaneous.map((event) => event.event.id) });
      while (relevant[i + 1]?.event.at === current.event.at) i += 1;
      continue;
    }
    const enteringDesired = (current.mapping.direction === "entry") === (desired === "inside");
    if (enteringDesired) {
      if (open) ambiguous = true;
      else open = current;
    } else if (open) {
      const interval = { start: open.event.at, end: current.event.at };
      const validCoverage = pairCoverage(coverage, area, interval, open.event.sourceId, current.event.sourceId) && eventCovered(open, coverage, area) && eventCovered(current, coverage, area);
      if (!ambiguous && validCoverage && interval.end > interval.start) pairs.push({ ...interval, entry: open, exit: current });
      else issues.push({ code: ambiguous ? "AMBIGUOUS_AREA_PAIR" : "AREA_PAIR_COVERAGE_MISSING", eventIds: [open.event.id, current.event.id] });
      open = null;
      ambiguous = false;
    }
  }
  if (open) issues.push({ code: "OPEN_AREA_PAIR", eventIds: [open.event.id] });
  return { pairs, issues };
}

export function stateIntervals(timeline: readonly LocationInterval[], area: Area, state: LocationState, work: readonly Interval[]): Interval[] {
  return intersectIntervals(timeline.filter((interval) => interval.area === area && interval.state === state), work);
}
