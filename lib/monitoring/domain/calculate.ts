import { isEffective, resolveEligibility } from "./eligibility";
import { DEFAULT_REPETITION_POLICY, prepareAccess, preparePunches, RULE_VERSION, type MappedAccess } from "./events";
import { assertInstant, assertInterval, assertOperationalDate, durationMs, intersectIntervals, normalizeIntervals, operationalDateAt } from "./intervals";
import { reconstructJourney } from "./journeys";
import { reconcileAccessSequence } from "./access-sequence";
import { mealsWithoutRest } from "./meals";
import { locationTimeline, pairedAreaIntervals, stateIntervals } from "./location";
import { MONITORED_AREAS, perimeterObservationEventIds, unassessedPerimeterMetric } from "./perimeter-observation";
import type { Eligibility, Indicator, Interval, JourneyCalculation, JourneyCalculationInput, Lateness, Metric, PairedVisit } from "./types";

function metric(intervals: Interval[], knownMs: number, workMs: number | null, eligibility: Eligibility, completeJourney: boolean): Metric {
  const unknownMs = Math.max(0, (workMs ?? 0) - knownMs);
  const unavailable = eligibility.state === "pending" || workMs === null || knownMs === 0;
  return {
    milliseconds: eligibility.state === "excluded" || unavailable ? null : durationMs(intervals),
    quality: eligibility.state === "excluded" ? "excluded" : unavailable ? "unavailable" : unknownMs === 0 && completeJourney ? "complete" : "partial",
    knownMs, unknownMs, coverageRatio: workMs && workMs > 0 ? knownMs / workMs : null, intervals, eligibility,
  };
}

function calculateLateness(input: JourneyCalculationInput, firstEntry: number | null, eligibility: Eligibility): Lateness {
  const base: Lateness = { quality: "unavailable", reason: null, totalMs: null, excessMs: null, over15Minutes: null, operationalMonth: input.operationalDate.slice(0, 7), eligibility };
  if (eligibility.state !== "eligible") return { ...base, quality: eligibility.state === "excluded" ? "excluded" : "unavailable", reason: eligibility.reasons.join("; ") };
  if (!input.schedule) return { ...base, reason: "Horário previsto não cadastrado" };
  if (!input.evidence.startCoverageConfirmed || !input.evidence.startConfirmed || firstEntry === null) return { ...base, reason: "Início não confirmado; atraso não apurável" };
  const totalMs = Math.max(0, firstEntry - input.schedule.expectedStart);
  return { ...base, quality: "complete", totalMs, excessMs: Math.max(0, totalMs - 900_000), over15Minutes: totalMs > 900_000 };
}

function lowerBound(events: readonly MappedAccess[], at: number, inclusive: boolean): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (events[middle].event.at < at || (inclusive && events[middle].event.at === at)) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Pure deterministic calculation. No persistence, host timezone, clock reads or source guessing. */
export function calculateJourney(input: JourneyCalculationInput): JourneyCalculation {
  assertOperationalDate(input.operationalDate);
  assertInterval(input.observationWindow);
  assertInstant(input.referenceAt);
  if (input.referenceAt < input.observationWindow.end) throw new Error("OBSERVATION_AFTER_REFERENCE");
  if (input.schedule && operationalDateAt(input.schedule.expectedStart) !== input.operationalDate) throw new Error("SCHEDULE_OPERATIONAL_DATE_MISMATCH");
  const policy = { ...DEFAULT_REPETITION_POLICY, ...input.repetitionPolicy };
  for (const window of [policy.punchWindowMs, policy.accessWindowMs, input.initialLookbackMs ?? 12 * 3_600_000]) if (!Number.isSafeInteger(window) || window < 0) throw new Error("INVALID_REPETITION_OR_LOOKBACK_WINDOW");
  for (const coverage of input.coverage) assertInterval(coverage);
  for (const coffee of input.coffeeWindows ?? []) assertInterval(coffee);
  const preparedPunches = preparePunches(input.punchEvents.filter((event) => event.personId === input.personId), policy);
  const observationalEvents = perimeterObservationEventIds(input.accessEvents, input.mappings, input.operationalDate);
  const preparedAccess = prepareAccess(input.accessEvents.filter(event => !observationalEvents.has(event.id)), input.mappings, input.operationalDate, input.personId, policy);
  const incompleteAreas = MONITORED_AREAS.filter((area) => ["entry", "exit"].some((direction) => !input.mappings.some((mapping) => mapping.area === area && mapping.direction === direction && mapping.validated && mapping.eventClasses.length > 0 && isEffective(mapping, input.operationalDate))));
  const coverage = input.coverage.map((item) => incompleteAreas.includes(item.area) ? { ...item, declaredComplete: false } : item);
  const journey = reconstructJourney(input, preparedPunches.events);
  // Unresolved accidental-mark candidates cannot silently create a one-minute official break.
  if (preparedPunches.issues.some((issue) => issue.code === "PUNCH_REPETITION_CANDIDATE")) {
    journey.status = "inconsistent";
    journey.work = [];
    journey.rest = [];
    journey.provisionalWork = [];
    journey.issues.push({ code: "PUNCH_REPETITION_REVIEW_REQUIRED", eventIds: preparedPunches.issues.flatMap((issue) => issue.eventIds) });
  }
  const reconciled = reconcileAccessSequence(preparedAccess.events, preparedPunches.events, journey);
  preparedAccess.events = reconciled.events;
  const workMs = journey.work.length ? durationMs(journey.work) : journey.status === "complete" ? 0 : null;
  if (journey.work.some((interval) => interval.start < input.observationWindow.start || interval.end > input.observationWindow.end)) throw new Error("WORK_OUTSIDE_OBSERVATION_WINDOW");
  const initialReferenceAt = journey.firstEntry ?? input.schedule?.expectedStart ?? input.observationWindow.start;
  const location = locationTimeline(preparedAccess.events, coverage, input.observationWindow, input.initialLookbackMs ?? 12 * 3_600_000, initialReferenceAt, MONITORED_AREAS);
  const cafeteriaPairs = pairedAreaIntervals(preparedAccess.events, coverage, "cafeteria", "inside", input.observationWindow);
  const policies = input.indicatorPolicies ?? [];
  const snapshots = input.groupSnapshots ?? [];
  const eligibility = (indicator: Indicator) => resolveEligibility(input.personId, indicator, input.operationalDate, snapshots, policies);
  const insideOperation = stateIntervals(location.intervals, "operation", "inside", journey.work);
  const outsideOperation = stateIntervals(location.intervals, "operation", "outside", journey.work);
  const knownOperation = durationMs([...insideOperation, ...outsideOperation]);
  const cafeteriaWork = intersectIntervals(cafeteriaPairs.pairs, journey.work);
  const outsideCafeteria = stateIntervals(location.intervals, "cafeteria", "outside", journey.work);
  const completeJourney = journey.status === "complete";
  const cafeteriaEligibility = eligibility("cafeteria");
  const operationTransitions = preparedAccess.events.filter((event) => event.mapping.area === "operation"
    && event.event.at >= initialReferenceAt - (input.initialLookbackMs ?? 12 * 3_600_000)
    && event.event.at <= input.observationWindow.end
    && coverage.some((item) => item.area === "operation" && item.declaredComplete && item.evidence.trim()
      && item.sourceIds.includes(event.event.sourceId) && item.start <= event.event.at && event.event.at <= item.end));
  const operationEntries = operationTransitions.filter((event) => event.mapping.direction === "entry");
  const cafeteriaVisits: PairedVisit[] = cafeteriaPairs.pairs.map((pair) => {
    const work = intersectIntervals([pair], journey.work);
    const workDuration = durationMs(work);
    const previousTransition = operationTransitions[lowerBound(operationTransitions, pair.start, true) - 1];
    const previousOperationEntry = lowerBound(operationEntries, pair.start, false) > 0;
    const nextOperationEntry = operationEntries[lowerBound(operationEntries, pair.end, false)];
    const fromOperation = previousOperationEntry && previousTransition?.mapping.direction === "exit";
    const sequenceEventIds = [preparedPunches.events.find((event) => event.at === journey.firstEntry)?.id,
      fromOperation ? previousTransition.event.id : undefined, pair.entry.event.id, pair.exit.event.id, nextOperationEntry?.event.id].filter((id): id is string => Boolean(id));
    return {
      start: pair.start, end: pair.end, entryEventId: pair.entry.event.id, exitEventId: pair.exit.event.id, workMs: workDuration,
      coffeeMs: durationMs(intersectIntervals(work, input.coffeeWindows ?? [])), sequenceEventIds,
      classification: journey.firstEntry !== null && pair.end <= journey.firstEntry ? "beforePunch"
        : workDuration === 0 && durationMs(intersectIntervals([pair], journey.rest)) === pair.end - pair.start ? "duringRest"
          : workDuration > 0 && fromOperation ? "fromOperation" : workDuration > 0 && !previousOperationEntry ? "withoutPriorOperation" : "other",
    };
  });
  const operationOutsideObserved = normalizeIntervals(location.intervals.filter((interval) => interval.area === "operation" && interval.state === "outside"));
  const firstOperationEntry = operationTransitions.find((event) => event.mapping.direction === "entry")?.event.at;
  const outsideOperationEpisodes = operationOutsideObserved.map((interval) => ({ ...interval,
    kind: firstOperationEntry === undefined || interval.start < firstOperationEntry ? "lateOperationEntry" as const : "departure" as const,
    workMs: durationMs(intersectIntervals([interval], journey.work)),
  })).filter((episode) => episode.workMs > 0);
  const cafeteriaMetric = metric(cafeteriaWork, durationMs([...cafeteriaWork, ...outsideCafeteria]), workMs, cafeteriaEligibility, completeJourney);
  const observedCafeteriaOutside = stateIntervals(location.intervals, "cafeteria", "outside", [input.observationWindow]);
  const observedKnown = durationMs([...cafeteriaPairs.pairs, ...observedCafeteriaOutside]);
  const issues = [...preparedPunches.issues, ...preparedAccess.issues, ...journey.issues, ...location.issues, ...cafeteriaPairs.issues];
  for (const finding of reconciled.sequence.findings) issues.push({code: finding.reason === "aligned" ? "ACCESS_SEQUENCE_ALIGNED" : "ACCESS_SEQUENCE_REVIEW_REQUIRED", eventIds: [finding.eventId, finding.punchEventId]});
  for (const area of incompleteAreas) issues.push({ code: "INCOMPLETE_AREA_MAPPING", eventIds: [], detail: `Mapa incompleto de entrada/saída: ${area}` });
  for (const area of MONITORED_AREAS) {
    if (!incompleteAreas.includes(area) && !coverage.some((item) => item.area === area && item.declaredComplete
      && item.evidence.trim() && item.sourceIds.length > 0 && item.start < input.observationWindow.end && item.end > input.observationWindow.start)) {
      issues.push({ code: "AREA_COVERAGE_MISSING", eventIds: [], detail: area });
    }
  }
  if (knownOperation < (workMs ?? 0)) issues.push({ code: "OPERATION_LOCATION_UNKNOWN", eventIds: [] });
  if (!input.schedule) issues.push({ code: "SCHEDULE_MISSING", eventIds: [] });
  if (!input.coffeeWindows?.length) issues.push({ code: "COFFEE_WINDOWS_NOT_CONFIGURED", eventIds: [] });
  return {
    personId: input.personId, operationalDate: input.operationalDate, ruleVersion: RULE_VERSION, timezone: "America/Sao_Paulo", accessSequence: reconciled.sequence,
    journey, workMs, restMs: durationMs(journey.rest), location: location.intervals, insideOperationMs: durationMs(insideOperation),
    outsideOperation: metric(outsideOperation, knownOperation, workMs, eligibility("outsideOperation"), completeJourney),
    cafeteria: cafeteriaMetric,
    outsideCd: unassessedPerimeterMetric(),
    coffeeDuringWorkMs: !input.coffeeWindows?.length || cafeteriaMetric.milliseconds === null ? null : durationMs(intersectIntervals(cafeteriaWork, input.coffeeWindows)),
    cafeteriaObservedMs: observedKnown === 0 || cafeteriaEligibility.state !== "eligible" ? null : durationMs(cafeteriaPairs.pairs),
    cafeteriaVisits, mealsWithoutRest: mealsWithoutRest(input, journey, preparedPunches.events, cafeteriaVisits, cafeteriaMetric, cafeteriaPairs.issues), outsideOperationEpisodes, betweenOperationExitAndPrincipalEntry: [],
    lateness: calculateLateness(input, journey.status === "inconsistent" ? null : journey.firstEntry, eligibility("lateness")),
    suppressions: [...preparedPunches.suppressions, ...preparedAccess.suppressions], issues,
  };
}

export interface MonthlyMonitoringAggregate {
  month: string;
  journeys: number;
  lateJourneys: number;
  lateTotalMs: number;
  lateExcessMs: number;
  latenessUnavailable: number;
  metrics: Record<"outsideOperation" | "cafeteria" | "outsideCd", { knownMs: number; eligible: number; excluded: number; pending: number; partial: number; unavailable: number }>;
}

export function aggregateJourneys(results: readonly JourneyCalculation[]): MonthlyMonitoringAggregate[] {
  const unique = new Map<string, JourneyCalculation>();
  for (const result of results) {
    const key = `${result.personId}\u0000${result.operationalDate}`;
    const previous = unique.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(result)) throw new Error("CONFLICTING_JOURNEY_RESULTS");
    unique.set(key, result);
  }
  const months = new Map<string, MonthlyMonitoringAggregate>();
  for (const result of unique.values()) {
    const month = result.operationalDate.slice(0, 7);
    const empty = () => ({ knownMs: 0, eligible: 0, excluded: 0, pending: 0, partial: 0, unavailable: 0 });
    const total = months.get(month) ?? { month, journeys: 0, lateJourneys: 0, lateTotalMs: 0, lateExcessMs: 0, latenessUnavailable: 0, metrics: { outsideOperation: empty(), cafeteria: empty(), outsideCd: empty() } };
    total.journeys += 1;
    if (result.lateness.over15Minutes) total.lateJourneys += 1;
    if (result.lateness.quality === "unavailable") total.latenessUnavailable += 1;
    total.lateTotalMs += result.lateness.totalMs ?? 0;
    total.lateExcessMs += result.lateness.excessMs ?? 0;
    for (const key of ["outsideOperation", "cafeteria", "outsideCd"] as const) {
      const current = result[key];
      total.metrics[key][current.eligibility.state] += 1;
      total.metrics[key].knownMs += current.milliseconds ?? 0;
      if (current.quality === "partial") total.metrics[key].partial += 1;
      if (current.quality === "unavailable") total.metrics[key].unavailable += 1;
    }
    months.set(month, total);
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}
