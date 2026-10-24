import { z } from "zod";
import { dateSchema } from "./contracts";
export const historyPeriodSchema = z.object({ employeeId: z.string().uuid(), start: dateSchema, end: dateSchema }).strict()
  .refine(value => value.end >= value.start && Date.parse(value.end) - Date.parse(value.start) <= 30 * 86_400_000, "Consulte até 31 dias");
export const punchCorrectionSchema = z.object({ employeeId: z.string().uuid(), start: dateSchema, end: dateSchema, date: dateSchema,
  expectedUpdatedAt: z.string().datetime({ offset: true }).nullable(), reason: z.string().trim().min(5).max(1000),
  punches: z.array(z.object({ at: z.string().datetime({ offset: true }), evidenceId: z.string().uuid().nullable().optional() }).strict()).length(4),
}).strict().refine(value => value.date >= value.start && value.date <= value.end && value.end >= value.start && Date.parse(value.end) - Date.parse(value.start) <= 30 * 86_400_000);

const role = z.enum(["start", "breakStart", "breakEnd", "end"]);
const punch = z.object({ id: z.string(), at: z.number().finite(), sourceId: z.string(), role: role.optional() });
const displayMark = z.object({ at: z.number().finite().nullable(), role: role.optional() });
export const attendanceHistorySnapshotSchema = z.object({
 days: z.array(z.object({ date: dateSchema, correctionVersion: z.string().nullable(), displayMarks: z.array(displayMark).optional(), displayReason: z.string().optional(), bankDay: z.object({
  state: z.enum(["ready", "pending"]), reason: z.string(), expectedMinutes: z.number().nullable(), workedMinutes: z.number().nullable(), deltaMinutes: z.number().nullable(),
  punches: z.array(punch), originalPunches: z.array(punch).optional(), suppressedIds: z.array(z.string()), missingRole: role.nullable(),
  slots: z.array(z.object({ role, at: z.number().nullable(), eventId: z.string().optional() })),
  suggestions: z.array(z.object({ at: z.number(), eventId: z.string(), pointId: z.string(), direction: z.enum(["entry", "exit"]), differenceMinutes: z.number() })),
 }).nullable() })).max(31), canEdit: z.boolean(),
 bank: z.object({ saldo_minutos: z.number(), aplica_a_partir_de: dateSchema, automatic: z.boolean(), movementMinutes: z.number() }).nullable(),
 correctionHistory: z.array(z.object({ date: dateSchema, at: z.string(), reason: z.string(), actorName: z.string() })),
 archive:z.object({cutoff:dateSchema,used:z.boolean(),records:z.number().int().nonnegative()}).optional(),
});
