import { z } from "zod";
import { attendanceHistorySnapshotSchema } from "./attendance-history-contracts";
import { defaultScheduleSnapshotSchema } from "./standard-schedules";
import { DEFAULT_REPETITION_POLICY, preparePunches } from "./domain/events";

type Day = z.infer<typeof attendanceHistorySnapshotSchema>["days"][number];
type Reference = z.infer<typeof defaultScheduleSnapshotSchema>["setting"];
const inputSchema = z.object({
  settings: z.array(z.object({ kind: z.string(), target: z.string(), valid_from: z.string(), valid_to: z.string().nullable().optional(), revoked_at: z.string().nullable(), payload: z.unknown() })),
  corrections: z.array(z.object({ date: z.string() })).default([]),
  events: z.array(z.object({ id: z.string(), sourceId: z.string(), eligible: z.boolean(), conflicted: z.boolean(), payload: z.object({ type: z.string(), timestamp: z.string(), eligible: z.boolean() }) })),
});
const nightSchedule = z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) });
const shiftDate = (date: string, amount: number) => new Date(Date.parse(`${date}T12:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10);
const localAt = (date: string, time: string) => Date.parse(`${date}T${time}:00-03:00`);

export function needsPeriodPunchReference(raw: unknown, employeeId: string): boolean {
  const input = inputSchema.parse(raw);
  return input.events.some(event => event.payload.type === "punch")
    && !input.settings.some(setting => setting.kind === "schedule" && setting.target === employeeId && setting.revoked_at === null);
}

/** Display only: preserve raw timestamps, corrections and payroll calculations.
 * Without a roster, only group a bounded overnight sequence with interval marks. */
export function projectPeriodPunchDisplay(raw: unknown, days: Day[], employeeId: string, now: number, reference: Reference = null): Day[] {
  if (!days.length) return days;
  const input = inputSchema.parse(raw);
  const settings = input.settings.filter(setting => setting.kind === "schedule" && setting.target === employeeId && setting.revoked_at === null)
    .sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  const first = settings[0] ?? (reference ? { valid_from: reference.validFrom, valid_to: reference.validTo, payload: reference.payload } : null);
  const suppressed = new Set(days.flatMap(day => day.bankDay?.suppressedIds ?? []));
  const punches = input.events.filter(event => event.payload.type === "punch" && !suppressed.has(event.id) && Date.parse(event.payload.timestamp) <= now);
  const corrected = new Set(input.corrections.map(row => row.date));
  const destinations = new Map<string, string>();
  const incoming = new Map<string, Day["displayMarks"]>();
  const available = new Map(days.map(day => [day.date, day]));
  for (let date = shiftDate(days[0].date, -1); date <= days.at(-1)!.date; date = shiftDate(date, 1)) {
    const next = shiftDate(date, 1);
    if (corrected.has(date) || corrected.has(next) || available.get(date)?.bankDay?.slots.length) continue;
    const effective = settings.filter(setting => setting.valid_from <= date && (!setting.valid_to || setting.valid_to >= date)).at(-1);
    const hint = effective ?? (first && (!first.valid_to || first.valid_to >= date) && (!settings.length || date < first.valid_from) ? first : null);
    const parsed = nightSchedule.safeParse(hint?.payload);
    if (hint && (!parsed.success || parsed.data.end >= parsed.data.start)) continue;
    const schedule = parsed.success ? parsed.data : null;
    const start = schedule ? localAt(date, schedule.start) - 3 * 3_600_000 : localAt(date, "18:00");
    const midnight = localAt(next, "00:00");
    const end = schedule ? localAt(next, schedule.end) + 3 * 3_600_000 : localAt(next, "12:00");
    if (available.get(next)?.bankDay?.slots.some(mark => mark.at !== null && mark.at >= start && mark.at <= end)) continue;
    const sequence = punches.filter(event => {
      const at = Date.parse(event.payload.timestamp);
      return at >= start && at <= end;
    });
    if (sequence.some(event => !event.eligible || !event.payload.eligible || event.conflicted)) continue;
    const prepared = preparePunches(sequence.map(event => ({ id: event.id, sourceId: event.sourceId, personId: employeeId, at: Date.parse(event.payload.timestamp), precision: "second" as const })), DEFAULT_REPETITION_POLICY);
    const marks = prepared.events;
    if (prepared.issues.length || marks.length < 2 || marks.length > 6 || marks[0].at >= midnight || marks.at(-1)!.at < midnight || marks.at(-1)!.at - marks[0].at > 18 * 3_600_000) continue;
    if (!schedule && (marks.length < 3 || marks.some((mark, index) => index > 0 && mark.at - marks[index - 1].at > 8 * 3_600_000))) continue;
    // A mark must belong to only one observed journey.
    if (marks.some(mark => destinations.has(mark.id))) continue;
    incoming.set(date, marks.map(mark => ({ at: mark.at })));
    for (const mark of marks) destinations.set(mark.id, date);
  }
  return days.map(day => {
    const original = day.bankDay?.slots.length ? day.bankDay.slots : day.bankDay?.punches ?? [];
    const moved = day.bankDay?.punches.some(mark => destinations.has(mark.id) && destinations.get(mark.id) !== day.date);
    const grouped = incoming.get(day.date);
    if (!moved && !grouped) return day;
    const retained = original.filter(mark => !("id" in mark) || !destinations.has(mark.id));
    const displayMarks = [...retained, ...(grouped ?? [])].sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
    return { ...day, displayMarks, displayReason: "Batidas noturnas agrupadas na data da entrada; horários originais preservados, sem alteração da apuração" };
  });
}
