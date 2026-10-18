import { z } from "zod";
import { validDate } from "@/lib/data/daily-call-dates";

export const dashboardDomains = ["monitoramento", "chamada-diaria", "banco-de-horas", "quadro-atual"] as const;
export const dashboardDomainSchema = z.enum(dashboardDomains);
export type DashboardDomain = z.infer<typeof dashboardDomainSchema>;
export const dashboardFormatSchema = z.enum(["count", "minutes", "percent", "days"]);
export type DashboardFormat = z.infer<typeof dashboardFormatSchema>;
const date = z.string().refine(validDate, "Data inválida");
export const dashboardFiltersSchema = z.object({
  start: date,
  end: date,
  unit: z.string().max(100).default(""),
  managerId: z.union([z.string().uuid(), z.literal(""), z.literal("none")]).default(""),
  query: z.string().trim().max(100).default(""),
}).strict();
export type DashboardFilters = z.infer<typeof dashboardFiltersSchema>;

export const dashboardMetricSchema = z.object({
  id: z.string(), label: z.string(), value: z.number().finite().nullable(),
  format: dashboardFormatSchema, description: z.string(),
  numerator: z.number().finite().nullable().optional(),
  denominator: z.number().finite().nullable().optional(),
});
export const dashboardSnapshotSchema = z.object({
  domain: dashboardDomainSchema, title: z.string(), description: z.string(),
  queriedAt: z.string(), start: date, end: date,
  datasetVersion: z.string().optional(),
  options: z.object({ units: z.array(z.string()), managers: z.array(z.object({ id: z.string(), name: z.string() })) }),
  metrics: z.array(dashboardMetricSchema),
  charts: z.array(z.object({
    id: z.string(), title: z.string(), description: z.string(), format: dashboardFormatSchema,
    points: z.array(z.object({ label: z.string(), value: z.number().finite().nullable() })),
  })),
  table: z.object({
    columns: z.array(z.object({ key: z.string(), label: z.string(), format: dashboardFormatSchema.optional() })),
    rows: z.array(z.record(z.union([z.string(), z.number().finite(), z.null()]))),
  }),
  notes: z.array(z.string()), operationHref: z.string(),
});
export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>;
export type DashboardMetric = z.infer<typeof dashboardMetricSchema>;

export function defaultDashboardFilters(domain: DashboardDomain, today: string): DashboardFilters {
  return { start: domain === "monitoramento" || domain === "chamada-diaria" ? `${today.slice(0, 7)}-01` : today, end: today, unit: "", managerId: "", query: "" };
}

export function parseDashboardFilters(domain: DashboardDomain, input: unknown, today: string): DashboardFilters {
  const defaults = defaultDashboardFilters(domain, today);
  const filters = dashboardFiltersSchema.parse({ ...defaults, ...(typeof input === "object" && input !== null ? input : {}) });
  // The unused range start cannot prevent a historical bank-balance query.
  if (domain === "banco-de-horas") return { ...filters, start: filters.end };
  if (domain === "quadro-atual") return { ...filters, start: today, end: today };
  if (filters.end < filters.start) throw new Error("DASHBOARD_INVALID_PERIOD");
  const days = (Date.parse(filters.end) - Date.parse(filters.start)) / 86_400_000 + 1;
  if (domain === "chamada-diaria" && days > 31 || domain === "monitoramento" && days > 367) throw new Error("DASHBOARD_INVALID_PERIOD");
  return filters;
}
