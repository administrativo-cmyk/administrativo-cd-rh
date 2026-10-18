import { safeCsvCell } from "@/lib/monitoring/export";
import type { DashboardSnapshot } from "./contracts";

export function dashboardCsv(snapshot: Omit<DashboardSnapshot, "domain"> & { domain: string }): string {
  const lines: unknown[][] = [
    [snapshot.title], ["Domínio", snapshot.domain], ["Início", snapshot.start], ["Fim", snapshot.end],
    ["Consultado em", snapshot.queriedAt], ["Fuso", "America/Sao_Paulo"],
    ...(snapshot.datasetVersion ? [["Versão dos dados", snapshot.datasetVersion]] : []),
    ...snapshot.notes.map((note) => ["Nota", note]), [],
    ["Indicador", "Valor", "Formato", "Numerador", "Denominador", "Definição"],
    ...snapshot.metrics.map((metric) => [metric.label, metric.value, metric.format, metric.numerator ?? "", metric.denominator ?? "", metric.description]), [],
    snapshot.table.columns.map((column) => column.format ? `${column.label} (${column.format})` : column.label),
    ...snapshot.table.rows.map((row) => snapshot.table.columns.map((column) => row[column.key] ?? null)),
  ];
  return "\uFEFF" + lines.map((row) => row.map(safeCsvCell).join(";")).join("\r\n");
}
