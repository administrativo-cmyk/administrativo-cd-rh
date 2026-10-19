import { durationMs, intersectIntervals } from "./intervals";
import { isEffective } from "./eligibility";
import type { Issue, Journey, JourneyCalculationInput, MealCount, Metric, PairedVisit, PunchEvent } from "./types";

/** Counts evidenced visits, never invents a break or changes payroll intervals. */
export function mealsWithoutRest(input: JourneyCalculationInput, journey: Journey, punches: readonly PunchEvent[], visits: readonly PairedVisit[], cafeteria: Metric, pairIssues: readonly Issue[]): MealCount {
  const eligibility = cafeteria.eligibility;
  const unavailable: MealCount = { count: null, quality: eligibility.state === "excluded" ? "excluded" : "unavailable", eligibility, visits: [] };
  if (eligibility.state !== "eligible") return unavailable;
  // Two confirmed boundary marks may evidence a meal between them even while work duration remains ambiguous.
  const twoBoundaries = punches.length === 2 && journey.status !== "inconsistent" && Boolean(input.schedule)
    && (input.punchCollectionComplete === true || journey.issues.some(issue => issue.code === "TWO_PUNCHES_AMBIGUOUS")
      && input.evidence.startConfirmed && input.evidence.endConfirmed && input.evidence.startCoverageConfirmed);
  if (!twoBoundaries && (!input.evidence.startConfirmed || !input.evidence.endConfirmed || !input.evidence.startCoverageConfirmed)) return unavailable;
  if (journey.status !== "complete" && !twoBoundaries) return unavailable;
  const work = twoBoundaries ? [{ start: punches[0].at, end: punches[1].at }] : journey.work;
  const counted = visits.filter(visit => {
    const length = visit.end - visit.start;
    return length > 0 && durationMs(intersectIntervals([visit], work)) === length
      && durationMs(intersectIntervals([visit], journey.rest)) === 0
      && durationMs(intersectIntervals([visit], input.coffeeWindows ?? [])) < length;
  });
  const completeMapping = (["entry", "exit"] as const).every(direction => input.mappings.some(mapping => mapping.area === "cafeteria" && mapping.direction === direction && mapping.validated && mapping.eventClasses.length > 0 && isEffective(mapping,input.operationalDate)));
  const coverage = input.coverage.filter(item => item.area === "cafeteria" && item.declaredComplete && item.evidence.trim());
  const completeCoverage = completeMapping && pairIssues.length === 0 && durationMs(intersectIntervals(coverage,work)) === durationMs(work);
  if (!counted.length && !completeCoverage) return unavailable;
  return { count: counted.length, quality: journey.status === "complete" && completeCoverage ? "complete" : "partial", eligibility,
    visits: counted.map(({ start, end, entryEventId, exitEventId }) => ({ start, end, entryEventId, exitEventId })) };
}
