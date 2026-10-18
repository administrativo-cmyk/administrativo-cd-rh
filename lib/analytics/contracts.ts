import { z } from "zod";
import { dashboardSnapshotSchema, parseDashboardFilters, type DashboardFilters } from "@/lib/dashboards/contracts";

export const analysisKinds = ["top-20-banco-horas", "top-por-gestor", "afastados-e-outros"] as const;
export const analysisKindSchema = z.enum(analysisKinds);
export type AnalysisKind = z.infer<typeof analysisKindSchema>;
export const analysisSnapshotSchema = dashboardSnapshotSchema.extend({ domain: analysisKindSchema });
export type AnalysisSnapshot = z.infer<typeof analysisSnapshotSchema>;
export type AnalysisFilters = DashboardFilters;

export const analysisCatalog = [
  { key: "top-20-banco-horas", title: "Top 20 · Banco de Horas", description: "Maiores créditos e débitos medidos, com dias a compensar e a repor." },
  { key: "top-por-gestor", title: "Totais por gestor", description: "Crédito, débito e cobertura de extratos de cada equipe, sem anular saldos opostos." },
  { key: "afastados-e-outros", title: "Afastados e outros", description: "Cadastros fora do quadro operacional da Chamada, por situação e vínculo atual." },
] as const;

export function parseAnalysisFilters(kind: AnalysisKind, input: unknown, today: string): AnalysisFilters {
  return parseDashboardFilters(kind === "afastados-e-outros" ? "quadro-atual" : "banco-de-horas", input, today);
}
