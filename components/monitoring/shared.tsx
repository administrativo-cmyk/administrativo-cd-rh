import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const inputClass = "mt-1 block min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100";
export const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50";
export const primaryClass = cn(buttonClass, "border-blue-700 bg-blue-700 text-white hover:bg-blue-800");
export const qualityLabels: Record<string, string> = { complete: "Completa", partial: "Parcial", unavailable: "Não apurável", pending: "Pendente", excluded: "Excluída por regra", stale: "Recalcular" };
export function duration(seconds: unknown) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "Não apurável";
  const total = Math.round(seconds);
  return `${Math.floor(total / 3600)}h ${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}min${total % 60 ? ` ${total % 60}s` : ""}`;
}
export function instant(value: string | number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(new Date(value).getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}
export function calendarDate(value: string | null) { return value ? value.split("-").reverse().join("/") : "Sem apuração"; }
export function Quality({ value }: { value: string }) {
  return <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", value === "complete" ? "bg-emerald-50 text-emerald-800" : value === "excluded" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-900")}>{qualityLabels[value] ?? value}</span>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block text-xs font-semibold text-slate-600">{label}{children}</label>; }
export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(`${typeof body.error === "string" ? body.error : "Não foi possível concluir a operação."}${typeof body.correlationId === "string" ? ` Referência: ${body.correlationId}` : ""}`);
  return body as T;
}
