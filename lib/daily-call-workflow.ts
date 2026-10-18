import { z } from "zod";
import { attendanceCodes } from "./daily-call-types";
import { validDate, validPeriod } from "./data/daily-call-dates";

const date = z.string().refine(validDate);
const reason = z.string().trim().min(5).max(500);
export const workflowQuerySchema = z.object({
  start: date, end: date,
  managerId: z.union([z.string().uuid(), z.literal("none")]).optional(),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict().refine((input) => validPeriod(input.start, input.end));

export const workflowMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("resolve"), data: z.object({
    employeeId: z.string().uuid(), date, status: z.enum(attendanceCodes),
    observation: z.string().trim().max(500).nullable(),
    expectedUpdatedAt: z.string().datetime({ offset: true }).nullable(),
    expectedDecisionVersion: z.string().min(1).max(256), reason,
  }).strict() }).strict(),
  z.object({ action: z.literal("close"), data: z.object({
    date, managerId: z.string().uuid().nullable(), expectedRevision: z.string().min(1).max(256), reason,
  }).strict() }).strict(),
]);

const countsSchema = z.object({ total: z.number().int().nonnegative(), present: z.number().int().nonnegative(), automaticAbsence: z.number().int().nonnegative(), manual: z.number().int().nonnegative(), pending: z.number().int().nonnegative(), blocked: z.number().int().nonnegative() });
const daySchema = countsSchema.extend({ date, managerId: z.string().uuid().nullable(), managerName: z.string(), closedAt: z.string().nullable().optional() });
const rowSchema = z.object({
  employeeId: z.string().uuid(), name: z.string(), employeeNumber: z.string(),
  managerId: z.string().uuid().nullable(), managerName: z.string(), date,
  status: z.enum(attendanceCodes).nullable(), origin: z.enum(["punch", "automatic_absence", "manual"]).nullable(),
  state: z.enum(["present", "automatic_absence", "manual", "pending_manager", "blocked", "not_expected"]),
  balanceMinutes: z.number().nullable(), blockers: z.array(z.string()), updatedAt: z.string().nullable(),
  observation: z.string().nullable().optional(),
  decisionVersion: z.string(),
});
export const workflowSnapshotSchema = z.object({ revision: z.string(), rows: z.array(rowSchema), counts: countsSchema, days: z.array(daySchema), start: date, end: date });
export const workflowResolveResultSchema = z.object({ changed: z.boolean(), record: z.object({ date, status: z.enum(attendanceCodes), observation: z.string().nullable(), updatedAt: z.string() }).nullable() });
export const workflowCloseResultSchema = z.object({ closed: z.literal(true), date, managerId: z.string().uuid().nullable(), closedAt: z.string(), revision: z.string() });
export type DailyCallWorkflowSnapshot = z.infer<typeof workflowSnapshotSchema>;
export type DailyCallWorkflowRow = z.infer<typeof rowSchema>;
export type DailyCallWorkflowDay = z.infer<typeof daySchema>;
