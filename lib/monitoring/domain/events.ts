import { isEffective } from "./eligibility";
import { assertInstant } from "./intervals";
import type { AccessEvent, AccessPointMapping, Area, Issue, LocationState, PunchEvent, RepetitionPolicy, Suppression } from "./types";

export const RULE_VERSION = "monitoring-1.4.0";
export const DEFAULT_REPETITION_POLICY: RepetitionPolicy = {
  version: "repetition-1.0.0", punchWindowMs: 60_000, accessWindowMs: 10_000, suppressUntypedPunches: false,
};
export interface MappedAccess { event: AccessEvent; mapping: AccessPointMapping; effects: Partial<Record<Area, LocationState>> }
export function normalizeAccessLabel(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
}

export function sortedCanonical<T extends { id: string; at: number }>(events: readonly T[], issues: Issue[]): T[] {
  const seen = new Map<string, T>();
  const conflicts = new Set<string>();
  for (const event of events) {
    assertInstant(event.at);
    const previous = seen.get(event.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) conflicts.add(event.id);
    else seen.set(event.id, event);
  }
  for (const id of conflicts) {
    seen.delete(id);
    issues.push({ code: "CANONICAL_EVENT_CONFLICT", eventIds: [id] });
  }
  return [...seen.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

export function preparePunches(events: readonly PunchEvent[], policy: RepetitionPolicy): { events: PunchEvent[]; suppressions: Suppression[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const suppressions: Suppression[] = [];
  const kept: PunchEvent[] = [];
  for (const event of sortedCanonical(events, issues)) {
    const anchor = kept.at(-1);
    // The employee is the logical stream. Equal represented instants from two
    // clocks are one analytical punch; originals and both source IDs stay intact.
    const crossClock = anchor && anchor.personId === event.personId && anchor.sourceId !== event.sourceId
      && (!anchor.role || !event.role || anchor.role === event.role)
      && (anchor.at === event.at || ((anchor.precision === "minute" || event.precision === "minute") && Math.floor(anchor.at / 60_000) === Math.floor(event.at / 60_000)));
    if (crossClock) {
      suppressions.push({ eventId: event.id, retainedEventId: anchor.id, rule: "punch-repetition", ruleVersion: "cross-clock-1.0.0", differenceMs: event.at - anchor.at });
      continue;
    }
    const close = anchor && anchor.personId === event.personId && anchor.sourceId === event.sourceId && event.at - anchor.at <= policy.punchWindowMs;
    const compatible = anchor && ((event.role !== undefined && event.role === anchor.role) || (!event.role && !anchor.role && policy.suppressUntypedPunches));
    if (close && compatible) {
      suppressions.push({ eventId: event.id, retainedEventId: anchor.id, rule: "punch-repetition", ruleVersion: policy.version, differenceMs: event.at - anchor.at });
    } else {
      if (close && !event.role && !anchor.role) issues.push({ code: "PUNCH_REPETITION_CANDIDATE", eventIds: [anchor.id, event.id] });
      kept.push(event);
    }
  }
  return { events: kept, suppressions, issues };
}

export function prepareAccess(events: readonly AccessEvent[], mappings: readonly AccessPointMapping[], date: string, personId: string, policy: RepetitionPolicy): { events: MappedAccess[]; suppressions: Suppression[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const suppressions: Suppression[] = [];
  const kept: MappedAccess[] = [];
  const anchors = new Map<string, MappedAccess>();
  for (const event of sortedCanonical(events, issues)) {
    if (!event.authorized || !event.identified || !event.personId) {
      issues.push({ code: "ACCESS_NOT_ELIGIBLE", eventIds: [event.id] });
      continue;
    }
    if (event.personId !== personId) continue;
    if (event.provenance?.origin === "manual" && !event.provenance.justification?.trim()) {
      issues.push({ code: "MANUAL_EVIDENCE_WITHOUT_JUSTIFICATION", eventIds: [event.id] });
      continue;
    }
    const matches = mappings.filter((mapping) => normalizeAccessLabel(mapping.pointId) === normalizeAccessLabel(event.pointId) && mapping.validated && mapping.eventClasses.some((eventClass) => normalizeAccessLabel(eventClass) === normalizeAccessLabel(event.eventClass)) && isEffective(mapping, date));
    if (matches.length !== 1) {
      issues.push({ code: matches.length ? "MAPPING_CONFLICT" : "UNMAPPED_ACCESS_POINT", eventIds: [event.id] });
      continue;
    }
    const mapping = matches[0];
    const primary = mapping.direction === "entry" ? "inside" : "outside";
    if (mapping.effects?.[mapping.area] && mapping.effects[mapping.area] !== primary) {
      issues.push({ code: "INVALID_TOPOLOGY", eventIds: [event.id] });
      continue;
    }
    const effects = { ...mapping.effects, [mapping.area]: primary };
    // Opposite effects anywhere in the same area invalidate all repetition anchors in that area.
    for (const [key, anchor] of anchors) {
      if (Object.entries(effects).some(([area, state]) => anchor.effects[area as Area] && anchor.effects[area as Area] !== state)) anchors.delete(key);
    }
    const key = `${normalizeAccessLabel(event.pointId)}\u0000${mapping.direction}\u0000${normalizeAccessLabel(event.eventClass)}`;
    const anchor = anchors.get(key);
    if (anchor && event.at - anchor.event.at <= policy.accessWindowMs) {
      suppressions.push({ eventId: event.id, retainedEventId: anchor.event.id, rule: "access-repetition", ruleVersion: policy.version, differenceMs: event.at - anchor.event.at });
      continue;
    }
    const mapped = { event, mapping, effects };
    anchors.set(key, mapped);
    kept.push(mapped);
  }
  return { events: kept, suppressions, issues };
}
