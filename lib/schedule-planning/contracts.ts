import { z } from "zod";
import { validDate } from "@/lib/data/daily-call-dates";
const date = z.string().refine(validDate, "Data inválida");
const id = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const reason = z.string().trim().min(5).max(1000);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const schedulePayloadSchema = z.object({ name: z.string().trim().min(1).max(200), start: time, end: time, days: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(values => new Set(values).size === values.length), allowNoBreak: z.boolean(), pairing: z.enum(["alternating", "explicit"]), coffeeWindows: z.array(z.object({ start: time, end: time })).max(5).default([]) }).strict();
export const vacationPolicySchema = z.object({ minimumTenureDays: z.number().int().min(0).max(3650), durationDays: z.number().int().min(1).max(60), noticeDays: z.number().int().min(0).max(365), maximumAbsentPercent: z.number().min(0).max(100), minimumAvailable: z.number().int().min(0).max(5000), includeRequested: z.boolean() }).strict();
const common = { id: id.optional(), expectedUpdatedAt: timestamp.optional(), name: z.string().trim().min(1).max(200), scope: z.enum(["global", "unit", "manager", "person"]), target: id.nullable(), validFrom: date, validTo: date.nullable(), reason };
export const planningSaveSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("template"), payload: schedulePayloadSchema }).strict(),
  z.object({ ...common, kind: z.literal("calendar"), payload: z.object({ working: z.boolean(), templateId: id.optional(), expectedTemplateUpdatedAt: timestamp.optional() }).strict() }).strict(),
  z.object({ ...common, kind: z.literal("vacation_policy"), payload: vacationPolicySchema }).strict(),
]).superRefine((value, context) => {
  const invalid = (message: string) => context.addIssue({ code: "custom", message });
  if (Boolean(value.id) !== Boolean(value.expectedUpdatedAt)) invalid("Atualização exige a versão consultada");
  if ((value.scope === "global") !== (value.target === null)) invalid("Selecione o destino do escopo");
  if (value.validTo && value.validTo < value.validFrom) invalid("Vigência inválida");
  if (value.kind === "template" && value.scope !== "global") invalid("Modelo deve ter escopo geral");
  if (value.kind === "vacation_policy" && value.scope === "person") invalid("Política deve ser geral, por unidade ou por gestor");
  if (value.kind === "calendar") {
    if (!value.validTo || Date.parse(value.validTo) - Date.parse(value.validFrom) > 30 * 86400000) invalid("Calendário permite até 31 dias por registro");
    if (value.payload.working && (!value.payload.templateId || !value.payload.expectedTemplateUpdatedAt)) invalid("Dia trabalhado exige um modelo consultado");
  }
});
export type PlanningSave = z.infer<typeof planningSaveSchema>;
export const planningVersionSchema = z.object({ id, expectedUpdatedAt: timestamp, reason }).strict();
export const planningAssignSchema = z.object({ templateId: id, expectedTemplateUpdatedAt: timestamp, employeeIds: z.array(id).min(1).max(500).refine(values => new Set(values).size === values.length), expectedRosterVersion: z.string().min(1), validFrom: date, validTo: date, reason }).strict().refine(value => value.validTo >= value.validFrom && Date.parse(value.validTo) - Date.parse(value.validFrom) <= 366 * 86400000, "Período máximo: 367 dias");
const suggestionShape = { employeeId: id, policyId: id, start: date, end: date };
export const planningSuggestSchema = z.object(suggestionShape).strict().refine(value => value.end >= value.start && Date.parse(value.end) - Date.parse(value.start) <= 89 * 86400000, "Consulta máxima: 90 dias");
export const planningAcceptSchema = z.object({ ...suggestionShape, expectedVersion: z.string().min(1), selectedStart: date, reason }).strict().refine(value => value.end >= value.start && Date.parse(value.end) - Date.parse(value.start) <= 89 * 86400000, "Consulta máxima: 90 dias");
export const planningSchemas = { list: z.object({}).strict(), save: planningSaveSchema, archive: planningVersionSchema, restore: planningVersionSchema, assign: planningAssignSchema, suggest: planningSuggestSchema, accept_suggestion: planningAcceptSchema };
export type PlanningAction = keyof typeof planningSchemas;
export const planningEnvelopeSchema = z.object({ action: z.enum(["list", "save", "archive", "restore", "assign", "suggest", "accept_suggestion"]), data: z.unknown() }).strict();
export const planningRecordSchema = z.object({ id, kind: z.enum(["template", "calendar", "vacation_policy"]), name: z.string(), scope: z.enum(["global", "unit", "manager", "person"]), target: id.nullable(), memberCount: z.number().int().nonnegative(), validFrom: date, validTo: date.nullable(), payload: z.record(z.unknown()), active: z.boolean(), createdAt: timestamp, updatedAt: timestamp });
export type PlanningRecord = z.infer<typeof planningRecordSchema>;
export const planningSnapshotSchema = z.object({ records: z.array(planningRecordSchema), rosterVersion: z.string(), canManage: z.boolean(), canPropose: z.boolean(), options: z.object({ units: z.array(z.object({ id, name: z.string() })), managers: z.array(z.object({ id, name: z.string() })), employees: z.array(z.object({ id, name: z.string(), employeeNumber: z.string(), managerId: id.nullable(), unitId: id, active: z.boolean(), admissionDate: date.nullable(), situation: z.string() })) }) });
export type PlanningSnapshot = z.infer<typeof planningSnapshotSchema>;
export const suggestionResultSchema = z.object({ version: z.string(), suggestions: z.array(z.object({ startDate: date, endDate: date, teamSize: z.number().int(), peakPlannedAbsent: z.number().int(), minimumOutsidePlannedVacation: z.number().int() })), blockers: z.array(z.string()), policy: planningRecordSchema, teamSize: z.number().int(), notes: z.array(z.string()) });
export type SuggestionResult = z.infer<typeof suggestionResultSchema>;
