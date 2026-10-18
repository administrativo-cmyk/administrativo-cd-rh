import { z } from "zod";

export const auditDomains = { "": "Todos", cadastros: "Cadastros e planejamento", banco_horas: "Banco de Horas", monitoramento: "Monitoramento", chamada: "Chamada Diária", anexos: "Anexos da Chamada", usuarios: "Usuários", workspace: "Preferências e avisos" } as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
export const auditQuerySchema = z.object({
 from: day, to: day, domain: z.enum(["", "cadastros", "banco_horas", "monitoramento", "chamada", "anexos", "usuarios", "workspace"]).default(""),
 query: z.string().trim().max(120).default(""), actor: z.union([z.string().uuid(), z.literal("")]).default(""), action: z.string().trim().max(100).default(""),
 offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(100).default(50), snapshot: z.string().datetime({ offset: true }).optional(),
}).strict().refine(value => value.from <= value.to && Date.parse(value.to) - Date.parse(value.from) <= 366 * 86400000, { message: "Selecione até 366 dias, em ordem crescente.", path: ["to"] });
export type AuditQuery = z.infer<typeof auditQuerySchema>;
export type AuditRecord = { id: string; domain: keyof typeof auditDomains; entity: string; recordId: string; action: string; actorId: string | null; actorName: string | null; createdAt: string; reason: string | null; before: unknown; after: unknown; employeeId: string | null; employeeName: string | null; employeeNumber: string | null };
export type AuditSnapshot = { total: number; offset: number; limit: number; snapshot: string; rows: AuditRecord[] };
export function defaultAuditQuery(today: string): AuditQuery { return auditQuerySchema.parse({ from: new Date(Date.parse(today) - 30 * 86400000).toISOString().slice(0, 10), to: today }); }
export function auditDifferences(before: unknown, after: unknown) {
 const previous = before && typeof before === "object" && !Array.isArray(before) ? before as Record<string, unknown> : { valor: before };
 const next = after && typeof after === "object" && !Array.isArray(after) ? after as Record<string, unknown> : { valor: after };
 return [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort().filter(key => JSON.stringify(previous[key]) !== JSON.stringify(next[key])).map(key => ({ field: key, before: previous[key], after: next[key] }));
}
