import type { MappedAccess } from "./events";
import type { AccessSequence, AccessSequenceFinding, Journey, PunchEvent } from "./types";

/** User-approved maximum. This is not a measured device offset. */
export const ACCESS_SEQUENCE_TOLERANCE_MS = 5 * 60_000;
const REVIEW_WINDOW_MS = 30 * 60_000;

/** Reconcile only validated operation readers against confirmed work boundaries.
 * A shared analytical instant expresses order, never a fabricated clock reading.
 */
export function reconcileAccessSequence(accesses: readonly MappedAccess[], punches: readonly PunchEvent[], journey: Journey): { events: MappedAccess[]; sequence: AccessSequence } {
  const findings: AccessSequenceFinding[] = [];
  const retained = new Set(journey.retainedPunchIds);
  const ordered = punches.filter(p => retained.has(p.id)).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const transitions = accesses.filter(a => a.mapping.area === "operation");
  for (let index = 0; index < ordered.length; index++) {
    const punch = ordered[index];
    const direction = index % 2 === 0 ? "entry" : "exit";
    const role = punch.role ?? (index === 0 ? "start" : index === ordered.length - 1 && index % 2 === 1 ? "end" : index % 2 === 0 ? "breakEnd" : "breakStart");
    const nearby = transitions.filter(a => a.mapping.direction === direction && Math.abs(a.event.at - punch.at) <= REVIEW_WINDOW_MS);
    const inverted = nearby.filter(a => direction === "entry" ? a.event.at > punch.at : a.event.at < punch.at)
      .sort((a, b) => Math.abs(a.event.at - punch.at) - Math.abs(b.event.at - punch.at) || a.event.id.localeCompare(b.event.id));
    const candidate = inverted[0];
    if (!candidate) continue;
    // A closer correctly ordered passage already explains this punch.
    const distance = Math.abs(candidate.event.at - punch.at);
    if (nearby.some(a => (direction === "entry" ? a.event.at <= punch.at : a.event.at >= punch.at) && Math.abs(a.event.at - punch.at) < distance)) continue;
    const from = Math.min(candidate.event.at, punch.at);
    const to = Math.max(candidate.event.at, punch.at);
    const otherTransition = accesses.some(a => a.event.id !== candidate.event.id && a.effects.operation && a.event.at >= from && a.event.at <= to);
    const competingPassage = nearby.some(a => a.event.id !== candidate.event.id && Math.abs(a.event.at - punch.at) <= Math.max(distance, ACCESS_SEQUENCE_TOLERANCE_MS));
    const competingPunch = ordered.some(p => p.id !== punch.id && Math.abs(p.at - candidate.event.at) <= ACCESS_SEQUENCE_TOLERANCE_MS);
    const reason: AccessSequenceFinding["reason"] = journey.status !== "complete" ? "journeyUnconfirmed"
      : candidate.event.provenance?.origin === "manual" ? "manualAccess"
        : distance > ACCESS_SEQUENCE_TOLERANCE_MS ? "outsideTolerance"
          : otherTransition || competingPassage || competingPunch ? "ambiguous" : "aligned";
    findings.push({eventId: candidate.event.id, punchEventId: punch.id, pointId: candidate.event.pointId, direction, role,
      originalAt: candidate.event.at, punchAt: punch.at, analyticalAt: reason === "aligned" ? punch.at : null, differenceMs: distance, reason});
  }
  // One access cannot explain two work boundaries, even if only one was aligned.
  for (const finding of findings) if (finding.reason === "aligned" && findings.some(other => other !== finding && other.eventId === finding.eventId)) {
    finding.reason = "ambiguous"; finding.analyticalAt = null;
  }
  const aligned = new Map(findings.filter(f => f.analyticalAt !== null).map(f => [f.eventId, f.analyticalAt!]));
  return {sequence: {toleranceMs: ACCESS_SEQUENCE_TOLERANCE_MS, findings},
    events: accesses.map(a => aligned.has(a.event.id) ? {...a, event: {...a.event, at: aligned.get(a.event.id)!}} : a)
      .sort((a, b) => a.event.at - b.event.at || a.event.id.localeCompare(b.event.id))};
}
