import { z } from "zod";
import { workforceSituations } from "@/lib/workforce";
import { isStrictMonitoringIdentifier } from "@/lib/monitoring/identifiers";
import { isAwaySituation } from "@/lib/employee-lifecycle";

export const administrationEntities = ["unit", "manager", "employee", "vacation", "department", "job", "category"] as const;
export type AdministrationEntity = (typeof administrationEntities)[number];
export type AdministrationAction = "list" | "save" | "archive" | "restore";
export const vacationStatuses = ["draft", "requested", "approved", "cancelled"] as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value, "Data inválida");
const nullableText = (max: number) => z.string().trim().max(max).nullable().default(null);
const mutation = { id: z.string().uuid().optional(), expectedUpdatedAt: z.string().datetime({ offset: true }).optional(), reason: z.string().trim().min(5).max(1000) };
const versioned = <T extends { id?: string; expectedUpdatedAt?: string }>(value: T) => Boolean(value.id) === Boolean(value.expectedUpdatedAt);
export const unitInputSchema = z.object({ ...mutation, code: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(200) }).strict().refine(versioned, "Atualização exige a versão consultada");
export const catalogInputSchema = z.object({ ...mutation, name: z.string().trim().min(1).max(200) }).strict().refine(versioned, "Atualização exige a versão consultada");
export const managerInputSchema = z.object({ ...mutation, name: z.string().trim().min(1).max(200), referenceUnitId: z.string().uuid().nullable().default(null) }).strict().refine(versioned, "Atualização exige a versão consultada");
// Omission preserves a stored identifier for clients opened before this release.
// Clearing a document is explicit (null), never a side effect of schema defaults.
const identifier = (kind: "cpf" | "pis") => z.string().trim().refine(value => isStrictMonitoringIdentifier(value, kind), `${kind.toUpperCase()} inválido; informe os 11 dígitos`).nullable().optional();
export const employeeInputSchema = z.object({ ...mutation, employeeNumber: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(200), unitId: z.string().uuid(), managerId: z.string().uuid().nullable().default(null), department: nullableText(200), role: nullableText(200), situation: z.enum(workforceSituations), category: nullableText(200), admissionDate: date.nullable().default(null), movement: nullableText(200), workdayHours: z.number().positive().max(24), observation: nullableText(1000), cpf: identifier("cpf"), pis: identifier("pis"), terminationDate: date.nullable().default(null), situationFrom: date.nullable().default(null), expectedReturnDate: date.nullable().default(null) }).strict().refine(versioned, "Atualização exige a versão consultada").superRefine((value, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (value.situation === "DESLIGADO" && !value.terminationDate) issue("terminationDate", "Informe a data de desligamento");
  if (value.terminationDate && (value.situation !== "DESLIGADO" || (value.admissionDate && value.terminationDate < value.admissionDate))) issue("terminationDate", "Revise a situação e a data de admissão");
  if (isAwaySituation(value.situation)) {
    if (!value.situationFrom) issue("situationFrom", "Informe o início do afastamento");
    if (!value.expectedReturnDate) issue("expectedReturnDate", "Informe o retorno previsto");
  }
  if (value.situationFrom && value.admissionDate && value.situationFrom < value.admissionDate) issue("situationFrom", "Não pode ser anterior à admissão");
  if (value.expectedReturnDate && (!isAwaySituation(value.situation) || (value.situationFrom && value.expectedReturnDate < value.situationFrom))) issue("expectedReturnDate", "Revise o período do afastamento");
});
export const vacationInputSchema = z.object({ ...mutation, employeeId: z.string().uuid(), acquisitionStart: date.nullable().default(null), acquisitionEnd: date.nullable().default(null), startDate: date, endDate: date, status: z.enum(vacationStatuses), observation: nullableText(1000) }).strict().refine(versioned, "Atualização exige a versão consultada").refine(value => value.endDate >= value.startDate, "Período inválido").refine(value => (value.acquisitionStart === null && value.acquisitionEnd === null) || Boolean(value.acquisitionStart && value.acquisitionEnd && value.acquisitionEnd >= value.acquisitionStart), "Período aquisitivo inválido");
export const archiveInputSchema = z.object({ id: z.string().uuid(), expectedUpdatedAt: z.string().datetime({ offset: true }), reason: z.string().trim().min(5).max(1000) }).strict();
export const administrationListSchema = z.object({ query: z.string().trim().max(100).default(""), includeArchived: z.boolean().default(false), offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(500).default(100), managerId: z.string().uuid().optional(), employeeId: z.string().uuid().optional(), status: z.enum(vacationStatuses).optional(), situation: z.enum(workforceSituations).optional() }).strict();
export const administrationEnvelopeSchema = z.object({ entity: z.enum(administrationEntities), action: z.enum(["list", "save", "archive", "restore"]), data: z.unknown().default({}) }).strict();
export const saveSchemas = { unit: unitInputSchema, manager: managerInputSchema, employee: employeeInputSchema, vacation: vacationInputSchema, department: catalogInputSchema, job: catalogInputSchema, category: catalogInputSchema };
export type UnitInput = z.infer<typeof unitInputSchema>;
export type ManagerInput = z.infer<typeof managerInputSchema>;
export type EmployeeInput = z.infer<typeof employeeInputSchema>;
export type VacationInput = z.infer<typeof vacationInputSchema>;
type VersionedRow = { id: string; updatedAt: string; createdAt: string };
export type AdministrationUnit = VersionedRow & { code: string; name: string; active: boolean };
export type AdministrationManager = VersionedRow & { name: string; referenceUnitId: string | null; active: boolean };
export type AdministrationEmployee = VersionedRow & Omit<EmployeeInput, keyof typeof mutation> & { activeInSystem: boolean; defaultSchedule?: { name?: string; start?: string; end?: string } | null; statusSignal?: { kind: "return_suggested" | "return_overdue" | "dates_missing"; evidence: { firstDate?: string; normalDays?: number }; evaluatedAt: string } | null };
export type AdministrationVacation = VersionedRow & Omit<VacationInput, keyof typeof mutation> & { archivedAt: string | null; createdBy: string; approvedBy: string | null; approvedAt: string | null; employeeName: string; employeeNumber: string; managerId: string | null; unitId: string; canEdit: boolean };
export type AdministrationCatalog = VersionedRow & { name: string; active: boolean; aliases: string[] };
export type AdministrationRows = { unit: AdministrationUnit; manager: AdministrationManager; employee: AdministrationEmployee; vacation: AdministrationVacation; department: AdministrationCatalog; job: AdministrationCatalog; category: AdministrationCatalog };
export type AdministrationSnapshot<E extends AdministrationEntity = AdministrationEntity> = {
  datasetVersion: string;
  entity: E; rows: AdministrationRows[E][]; total: number;
  options: { units: Array<{ id: string; code: string; name: string; active: boolean }>; managers: Array<{ id: string; name: string; active: boolean }>; employees: Array<{ id: string; name: string; employeeNumber: string; managerId: string | null; unitId: string; activeInSystem: boolean; canPropose?: boolean }>; catalogs?: Array<AdministrationCatalog & { kind: "department" | "job" | "category" }> };
  permissions: { canManageRegisters: boolean; canApproveVacation: boolean; canProposeVacation: boolean };
};
