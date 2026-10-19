/** Recurring clock times describe an observed pattern, not an agreed weekly roster. */
export type PatternPunch = { id: string; employeeId: string; sourceId: string; timestamp: string; eligible: boolean; conflicted: boolean };
type Day = { date: string; first: number; last: number; count: number; workedMinutes: number | null; sourceIds: string[] };
export type ObservedSchedule = {
  employeeId: string; status: "recurring" | "variable" | "insufficient";
  start: string | null; end: string | null; overnight: boolean | null;
  daysObserved: number; matchingDays: number; matchingRatio: number;
  completePresentDays: number; usableDayRatio: number;
  observationDates: string[]; matchingDates: string[]; observedWeekdays: number[];
  cutoffHour: number; medianWorkedMinutes: number | null;
  startSpreadMinutes: number | null; endSpreadMinutes: number | null;
  excludedDays: Array<{ date: string; reason: string }>;
  dailyObservations: Array<{ date: string; start: string; end: string; count: number }>;
  sourceIds: string[]; weeklyRosterConfirmed: false; officialRosterApplicationAllowed: false; estimatedWindowEligible: boolean;
  observedCadence: "possible_12x36" | "near_daily" | "irregular" | "insufficient";
};
const DAY = 86_400_000;
const MINUTE = 60_000;
const OFFSET = -3 * 3_600_000; // Brazil has no daylight-saving transition in this explicitly supported period.
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
const clock = (minute: number) => { const rounded = ((Math.round(minute / 15) * 15) % 1440 + 1440) % 1440; return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`; };
const dateOf = (at: number) => new Date(at).toISOString().slice(0, 10);

export function inferObservedSchedules(punches: PatternPunch[], completeFrom: string, completeToExclusive: string): ObservedSchedule[] {
  const from = Date.parse(completeFrom); const to = Date.parse(completeToExclusive);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 62 * DAY) throw new Error("INVALID_COMPLETE_PERIOD");
  // This version deliberately refuses other time-zone regimes instead of silently shifting a night journey.
  if (!completeFrom.startsWith("2026-") || !completeToExclusive.startsWith("2026-")) throw new Error("UNSUPPORTED_PATTERN_TIMEZONE_PERIOD");
  const people = new Map<string, Array<PatternPunch & { at: number }>>(); const seen = new Set<string>();
  for (const punch of punches) {
    const at = Date.parse(punch.timestamp);
    if (!Number.isFinite(at)) throw new Error("INVALID_PUNCH_TIMESTAMP");
    if (seen.has(punch.id)) throw new Error("DUPLICATE_PUNCH_ID");
    seen.add(punch.id);
    if (!punch.eligible || punch.conflicted || at < from || at >= to) continue;
    const events = people.get(punch.employeeId) ?? []; events.push({ ...punch, at }); people.set(punch.employeeId, events);
  }
  return [...people.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([employeeId, events]) => {
    events.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const candidates = Array.from({ length: 24 }, (_, cutoffHour) => {
      const buckets = new Map<number, typeof events>();
      for (const event of events) { const bucket = Math.floor((event.at + OFFSET - cutoffHour * 3_600_000) / DAY); const list = buckets.get(bucket) ?? []; list.push(event); buckets.set(bucket, list); }
      const days: Day[] = []; const excludedDays: ObservedSchedule["excludedDays"] = [];
      for (const [bucket, list] of buckets) {
        const windowStart = bucket * DAY - OFFSET + cutoffHour * 3_600_000;
        const date = dateOf(bucket * DAY);
        let reason: string | null = null;
        if (windowStart < from || windowStart + DAY > to) reason = "WINDOW_OUTSIDE_COMPLETE_PERIOD";
        else if (list.length < 2 || list.length % 2 || list.length > 6) reason = "INCOMPLETE_OR_AMBIGUOUS_SEQUENCE";
        else if (list.some((event, index) => index > 0 && event.at - list[index - 1].at < 2 * MINUTE)) reason = "REPEATED_OR_SIMULTANEOUS_PUNCHES";
        const span = list[list.length - 1].at - list[0].at;
        if (!reason && (span < 4 * 3_600_000 || span > 14 * 3_600_000)) reason = "IMPLAUSIBLE_PATTERN_SPAN";
        if (reason) { excludedDays.push({ date, reason }); continue; }
        let workedMinutes = 0;
        for (let index = 0; index < list.length; index += 2) workedMinutes += (list[index + 1].at - list[index].at) / MINUTE;
        days.push({ date, first: (list[0].at - windowStart) / MINUTE, last: (list[list.length - 1].at - windowStart) / MINUTE, count: list.length,
          workedMinutes: list.length >= 4 ? workedMinutes : null, sourceIds: [...new Set(list.map(event => event.sourceId))] });
      }
      const clusters = days.map(center => days.filter(day => Math.abs(day.first - center.first) <= 30 && Math.abs(day.last - center.last) <= 45));
      clusters.sort((a, b) => b.length - a.length);
      let best = clusters[0] ?? [];
      for (let iteration = 0; iteration < 2 && best.length; iteration++) {
        const firstMedian = median(best.map(day => day.first));
        const lastMedian = median(best.map(day => day.last));
        best = best.filter(day => Math.abs(day.first - firstMedian) <= 30 && Math.abs(day.last - lastMedian) <= 45);
      }
      const first = best.length ? median(best.map(day => day.first)) : 0;
      const last = best.length ? median(best.map(day => day.last)) : 0;
      const dispersion = best.reduce((sum, day) => sum + Math.abs(day.first - first) + Math.abs(day.last - last), 0) / Math.max(1, best.length);
      const margin = Math.min(first, 1440 - last);
      return { cutoffHour, days, best, excludedDays, first, last, dispersion, margin };
    });
    // Four or more punches provide an interval boundary. Otherwise a 12h/36h rhythm
    // could be split into two short two-punch days merely to increase the day count.
    candidates.sort((a, b) => b.best.filter(day => day.count >= 4).length - a.best.filter(day => day.count >= 4).length
      || b.best.length - a.best.length || b.days.length - a.days.length || a.dispersion - b.dispersion || b.margin - a.margin || a.cutoffHour - b.cutoffHour);
    const selected = candidates[0];
    const ratio = selected.best.length / Math.max(1, selected.days.length);
    const dates = selected.best.map(day => day.date).sort();
    const spanDays = dates.length > 1 ? (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / DAY : 0;
    const completePresentDays = selected.days.length + selected.excludedDays.filter(day => day.reason !== "WINDOW_OUTSIDE_COMPLETE_PERIOD").length;
    const usableDayRatio = selected.days.length / Math.max(1, completePresentDays);
    const recurring = dates.length >= 5 && ratio >= 0.8 && spanDays >= 7 && usableDayRatio >= 0.75;
    const enough = selected.days.length >= 5;
    const matchingWorked = selected.best.flatMap(day => day.workedMinutes === null ? [] : [day.workedMinutes]);
    const start = dates.length ? clock(selected.first + selected.cutoffHour * 60) : null;
    const end = dates.length ? clock(selected.last + selected.cutoffHour * 60) : null;
    const gaps = dates.slice(1).map((date, index) => (Date.parse(date) - Date.parse(dates[index])) / DAY);
    const alternating = gaps.filter(gap => gap === 2).length / Math.max(1, gaps.length);
    const daily = gaps.filter(gap => gap === 1).length / Math.max(1, gaps.length);
    const observedSpan = selected.last - selected.first;
    const observedCadence = !recurring ? "insufficient" : alternating >= 0.8 && observedSpan >= 10.5 * 60 && observedSpan <= 13.5 * 60
      ? "possible_12x36" : daily >= 0.7 ? "near_daily" : "irregular";
    return {
      employeeId, status: recurring ? "recurring" : enough ? "variable" : "insufficient", start, end,
      overnight: start && end ? end <= start : null, daysObserved: selected.days.length, matchingDays: dates.length, matchingRatio: ratio,
      completePresentDays, usableDayRatio,
      observationDates: selected.days.map(day => day.date).sort(), matchingDates: dates,
      observedWeekdays: [...new Set(selected.days.map(day => new Date(`${day.date}T12:00:00Z`).getUTCDay()))].sort(),
      cutoffHour: selected.cutoffHour, medianWorkedMinutes: matchingWorked.length ? median(matchingWorked) : null,
      startSpreadMinutes: dates.length ? Math.max(...selected.best.map(day => day.first)) - Math.min(...selected.best.map(day => day.first)) : null,
      endSpreadMinutes: dates.length ? Math.max(...selected.best.map(day => day.last)) - Math.min(...selected.best.map(day => day.last)) : null,
      dailyObservations: selected.days.map(day => ({ date: day.date, start: clock(day.first + selected.cutoffHour * 60), end: clock(day.last + selected.cutoffHour * 60), count: day.count })),
      excludedDays: selected.excludedDays, sourceIds: [...new Set(events.map(event => event.sourceId))].sort(),
      weeklyRosterConfirmed: false, officialRosterApplicationAllowed: false, estimatedWindowEligible: recurring, observedCadence,
    };
  });
}
