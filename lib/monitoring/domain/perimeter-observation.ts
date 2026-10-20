import { isEffective } from "./eligibility";
import { normalizeAccessLabel } from "./events";
import type { AccessEvent, AccessPointMapping, Area, Issue, JourneyCalculation, Metric } from "./types";

/** The principal entrance is an access log, not a measured entry/exit boundary. */
export const MONITORED_AREAS: readonly Area[] = ["operation", "cafeteria"];
export const PERIMETER_OBSERVATION_REASON = "Entrada principal somente para controle de acesso; tempo fora do CD não é apurado.";

export function unassessedPerimeterMetric(): Metric {
  return {
    milliseconds: null, quality: "excluded", knownMs: 0, unknownMs: 0, coverageRatio: null, intervals: [],
    eligibility: { state: "excluded", policyIds: [], reasons: [PERIMETER_OBSERVATION_REASON] },
  };
}

/** Uses configured area only. Equipment names never imply a topology or a passage. */
export function perimeterObservationEventIds(events: readonly AccessEvent[], mappings: readonly AccessPointMapping[], date: string): Set<string> {
  const areasByPoint = new Map<string, Set<Area>>();
  for (const mapping of mappings) {
    if (!isEffective(mapping, date)) continue;
    const point = normalizeAccessLabel(mapping.pointId);
    const areas = areasByPoint.get(point) ?? new Set<Area>();
    areas.add(mapping.area);
    areasByPoint.set(point, areas);
  }
  return new Set(events.filter(event => {
    const areas = areasByPoint.get(normalizeAccessLabel(event.pointId));
    return areas?.size === 1 && areas.has("perimeter");
  }).map(event => event.id));
}

export function isPerimeterObservationIssue(issue: Issue, observationEventIds: ReadonlySet<string> = new Set()): boolean {
  if (issue.code === "INCOMPLETE_AREA_MAPPING" && issue.detail?.endsWith(": perimeter")) return true;
  if (issue.code === "AREA_COVERAGE_MISSING" && issue.detail === "perimeter") return true;
  return issue.eventIds.length > 0 && issue.eventIds.every(id => observationEventIds.has(id));
}

/** Projection for persisted results; work, punches, bank inputs and original events stay untouched.
 * Event IDs are optional evidence for dropping old reader/pair warnings belonging
 * exclusively to the now observational entrance. Unidentified warnings are retained.
 */
export function projectPerimeterAsObservation(result: JourneyCalculation, observationEventIds: ReadonlySet<string> = new Set()): JourneyCalculation {
  return {
    ...result,
    outsideCd: unassessedPerimeterMetric(),
    location: result.location.filter(interval => interval.area !== "perimeter"),
    betweenOperationExitAndPrincipalEntry: [],
    issues: result.issues.filter(issue => !isPerimeterObservationIssue(issue, observationEventIds)),
  };
}
