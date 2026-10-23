import { z } from "zod";
import { bindingSchema } from "./contracts";
const reason = z.string().trim().min(5).max(1000);
const version = z.object({ id: z.string().uuid(), expectedUpdatedAt: z.string().datetime({ offset: true }), reason }).strict();
export const bindingMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), data: bindingSchema }),
  z.object({ action: z.literal("replace"), data: version.extend({ binding: bindingSchema }) }),
  z.object({ action: z.literal("restore"), data: version }),
  z.object({ action: z.literal("revoke"), data: version }),
]);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
export const sourceSaveSchema = z.object({
  id, expectedUpdatedAt: z.string().datetime({ offset: true }).optional(), label: z.string().trim().min(1).max(100),
  kind: z.enum(["afd", "defense-access", "defense-person"]), timeZone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }),
  identityNamespace: id, active: z.boolean(), sourceIdentityConfirmed: z.boolean(),
  declaredCoverage: z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }), continuous: z.boolean() }).refine(value => Date.parse(value.to) > Date.parse(value.from)).nullable().optional(), reason,
}).strict();
export type ManagedSource = { id: string; kind: "afd" | "defense-access" | "defense-person"; timezone: string; identity_namespace: string; label: string | null; active: boolean; configuration_updated_at: string; managed: boolean; configuration: { sourceIdentityConfirmed?: boolean; declaredCoverage?: { from: string; to: string; continuous: boolean } }; heartbeat_at: string | null; worker_state: string | null; last_success_at: string | null; last_error: string | null };
export type ImportKind = "clock" | "bank";
export type ImportField = "employeeNumber" | "name" | "cpf" | "pis" | "measurementDate" | "effectiveFrom" | "workdayHours" | "balanceMinutes";
export const importOptionsSchema = z.object({
  sheet: z.string().max(100).optional(), headerRow: z.number().int().min(1).max(30).default(1), delimiter: z.enum([";", ",", "\t"]).default(";"), encoding: z.enum(["utf8", "latin1"]).default("utf8"),
  dateFormat: z.enum(["iso", "br"]).default("iso"), balanceFormat: z.enum(["minutes", "hoursMinutes", "decimalHours"]).default("hoursMinutes"),
  mapping: z.record(z.enum(["employeeNumber", "name", "cpf", "pis", "measurementDate", "effectiveFrom", "workdayHours", "balanceMinutes"]), z.number().int().min(0).max(99)).default({}),
  defaults: z.object({ reason, sourceId: id.optional(), validFrom: z.string().optional(), validTo: z.string().nullable().optional() }).strict(),
}).strict();
export type ImportOptions = z.infer<typeof importOptionsSchema>;
export type ImportPreview = { id: string; kind: ImportKind; updatedAt: string; expiresAt: string; metadata: { fileName: string; sha256: string }; rows: Array<{ line: number; input: Record<string, string | number>; employeeId: string | null; employeeName: string | null; employeeNumber: string | null; nameCandidates?: Array<{ id: string; name: string; employeeNumber: string; additionalEmployeeNumbers: string[] }>; errors: string[]; state: "ready" | "blocked" | "applied" | "failed"; result: unknown }> };
export type ImportInspection = { sheets: string[]; selectedSheet: string; headers: string[]; sample: Array<{ line: number; cells: string[] }>; rowCount: number };
