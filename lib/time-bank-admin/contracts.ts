import { z } from "zod";
import { validDate } from "@/lib/data/daily-call-dates";
const date = z.string().refine(validDate, "Data inválida");
const timestamp = z.string().datetime({ offset: true });
const reason = z.string().trim().min(5).max(1000);
export const measurementSchema = z.object({
  id: z.string().uuid(), employeeId: z.string().uuid(), employeeName: z.string(), employeeNumber: z.string(), unit: z.string(),
  measurementDate: date, effectiveFrom: date, workdayHours: z.number().positive().max(24), balanceMinutes: z.number().int(),
  source: z.string().nullable(), importBatchId: z.string().uuid().nullable(), createdAt: timestamp, updatedAt: timestamp, cancelledAt: timestamp.nullable(),
});
export type BankMeasurement = z.infer<typeof measurementSchema>;
export const bankAdminSnapshotSchema = z.object({ rows: z.array(measurementSchema), total: z.number().int().nonnegative(), employees: z.array(z.object({ id: z.string().uuid(), name: z.string(), employeeNumber: z.string(), unit: z.string(), active: z.boolean() })) });
export type BankAdminSnapshot = z.infer<typeof bankAdminSnapshotSchema>;
export const bankAdminListSchema = z.object({ query: z.string().trim().max(100).default(""), state: z.enum(["active", "cancelled", "all"]).default("active"), employeeId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).max(100000).default(0) }).strict();
export type BankAdminFilters = z.infer<typeof bankAdminListSchema>;
export const bankMeasurementInputSchema = z.object({ id: z.string().uuid().optional(), expectedUpdatedAt: timestamp.optional(), employeeId: z.string().uuid(), measurementDate: date, effectiveFrom: date,
  workdayHours: z.number().positive().max(24).refine((value) => Math.round(value * 60) >= 1 && Math.abs(value * 10000 - Math.round(value * 10000)) < 1e-7, "Informe até quatro casas decimais e pelo menos um minuto de jornada"),
  balanceMinutes: z.number().int().min(-10000000).max(10000000), source: z.string().trim().max(200).nullable().default(null), reason,
}).strict().refine((value) => Boolean(value.id) === Boolean(value.expectedUpdatedAt), "Versão obrigatória para editar");
export const bankVersionedInputSchema = z.object({ id: z.string().uuid(), expectedUpdatedAt: timestamp, reason }).strict();
export const bankHistoryInputSchema = z.object({ id: z.string().uuid() }).strict();
export const bankAdminEnvelopeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), data: bankMeasurementInputSchema }),
  z.object({ action: z.literal("cancel"), data: bankVersionedInputSchema }),
  z.object({ action: z.literal("restore"), data: bankVersionedInputSchema }),
]);
export type BankAdminMutation = z.infer<typeof bankAdminEnvelopeSchema>;
export const bankAdminMutationResultSchema = z.object({ record: measurementSchema, queued: z.number().int().nonnegative(), changed: z.literal(true) });
export const bankHistorySchema = z.object({ rows: z.array(z.object({ id: z.string(), action: z.enum(["create", "update", "cancel", "restore"]), reason: z.string(), actorName: z.string(), createdAt: timestamp, before: measurementSchema.nullable(), after: measurementSchema })) });
export type BankHistory = z.infer<typeof bankHistorySchema>;
