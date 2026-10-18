import type { Interval } from "./types";

export function assertInstant(value: number): void {
  if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) throw new Error("INVALID_INSTANT");
}

export function assertInterval(interval: Interval): void {
  assertInstant(interval.start);
  assertInstant(interval.end);
  if (interval.end < interval.start) throw new Error("INVALID_INTERVAL");
}

export function normalizeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.map((interval) => {
    assertInterval(interval);
    return { start: interval.start, end: interval.end };
  }).filter((interval) => interval.start < interval.end).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push(interval);
  }
  return merged;
}

export function intersectIntervals(left: readonly Interval[], right: readonly Interval[]): Interval[] {
  const a = normalizeIntervals(left);
  const b = normalizeIntervals(right);
  const result: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (start < end) result.push({ start, end });
    if (a[i].end < b[j].end) i += 1;
    else j += 1;
  }
  return result;
}

export function subtractIntervals(left: readonly Interval[], right: readonly Interval[]): Interval[] {
  const a = normalizeIntervals(left);
  const b = normalizeIntervals(right);
  const result: Interval[] = [];
  for (const interval of a) {
    let cursor = interval.start;
    for (const remove of b) {
      if (remove.end <= cursor) continue;
      if (remove.start >= interval.end) break;
      if (remove.start > cursor) result.push({ start: cursor, end: Math.min(remove.start, interval.end) });
      cursor = Math.max(cursor, remove.end);
      if (cursor >= interval.end) break;
    }
    if (cursor < interval.end) result.push({ start: cursor, end: interval.end });
  }
  return result;
}

export function durationMs(intervals: readonly Interval[]): number {
  return normalizeIntervals(intervals).reduce((total, interval) => total + interval.end - interval.start, 0);
}

export function covers(intervals: readonly Interval[], interval: Interval): boolean {
  return durationMs(intersectIntervals(intervals, [interval])) === interval.end - interval.start;
}

export function operationalDateAt(at: number): string {
  assertInstant(at);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function assertOperationalDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("INVALID_OPERATIONAL_DATE");
}
