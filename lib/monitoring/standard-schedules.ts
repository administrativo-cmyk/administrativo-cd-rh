import { z } from "zod";
import { dateSchema, weeklyRestSchema } from "./contracts";

const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const defaultSchedulePayloadSchema = z.object({
  name: z.string().trim().min(1).max(200), start: clock, end: clock,
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length),
  lunchMinutes: z.literal(60), weeklyRosterConfirmed: z.boolean(), estimated: z.boolean(),
  cycle: z.object({ kind: z.literal("12x36"), anchorDate: dateSchema }).strict().optional(),
  weeklyRest: weeklyRestSchema.optional(),
  monthlySundayOff: z.boolean().optional(), monthlySundayOffDates: z.array(dateSchema).max(120).optional(),
  allowNoBreak: z.literal(false), pairing: z.literal("alternating"), coffeeWindows: z.array(z.never()).max(0),
}).strict().refine(p => !p.estimated || !p.weeklyRosterConfirmed, "Horário estimado exige conferência da escala")
  .refine(p => !p.cycle || p.weeklyRosterConfirmed, "Confirme a data de plantão do ciclo 12×36")
  .refine(p => !p.monthlySundayOffDates || (p.monthlySundayOffDates.every(d=>new Date(`${d}T12:00:00Z`).getUTCDay()===0) && new Set(p.monthlySundayOffDates.map(d=>d.slice(0,7))).size===p.monthlySundayOffDates.length), "Informe um único domingo de folga por mês")
  .refine(p => !p.weeklyRest || (!p.cycle && (p.weeklyRest.kind === "day" ? !isNightSchedule(p) : isNightSchedule(p))), "Folga deve corresponder ao turno; 12×36 mantém seu próprio ciclo")
  .refine(p => durationMinutes(p.start, p.end) > p.lunchMinutes, "Jornada deve superar o intervalo");
export type DefaultSchedulePayload = z.infer<typeof defaultSchedulePayloadSchema>;
export const defaultScheduleSaveSchema = z.object({ employeeId: z.string().uuid(), date: dateSchema,
  expectedVersion: z.string().min(1).max(200), validFrom: dateSchema,
  reason: z.string().trim().min(5).max(1000), payload: defaultSchedulePayloadSchema }).strict();
export const defaultScheduleSnapshotSchema = z.object({ employeeId: z.string().uuid(), version: z.string(), canEdit: z.boolean(),
  setting: z.object({ id: z.string().uuid(), validFrom: dateSchema, validTo: dateSchema.nullable(), updatedAt: z.string(), payload: z.record(z.unknown()) }).nullable() });
export type DefaultScheduleSnapshot = z.infer<typeof defaultScheduleSnapshotSchema>;
export { ALL_DAYS, STANDARD_SCHEDULES, scheduledOn, rosterState, durationMinutes } from "./schedule-standards";
import { durationMinutes, isNightSchedule, standardPayload as buildStandardPayload } from "./schedule-standards";
export const standardPayload = (id: string): DefaultSchedulePayload => buildStandardPayload(id);
