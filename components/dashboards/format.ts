import type { DashboardFormat } from "@/lib/dashboards/contracts";

const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export function dashboardValue(value: number | null, format: DashboardFormat = "count"): string {
  if (value === null || !Number.isFinite(value)) return "Não apurável";
  if (format === "percent") return `${decimal.format(value)}%`;
  if (format === "days") return `${decimal.format(value)} dia(s)`;
  if (format === "minutes") {
    const minutes = Math.round(Math.abs(value));
    return `${value < 0 ? "−" : ""}${integer.format(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, "0")}min`;
  }
  return integer.format(value);
}

export function dashboardDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").reverse().join("/") : value;
}

export function dashboardInstant(value: string): string {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return "Horário não informado";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }).format(time);
}

export const dashboardInput = "mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 sm:text-sm";
export const dashboardButton = "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
