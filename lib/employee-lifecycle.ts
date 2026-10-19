import type { WorkforceSituation } from "./workforce";

export function isAwaySituation(situation: string): boolean {
  return ["FERIAS", "AFASTADO", "LICENCA_MATERNIDADE", "ACIDENTE_TRABALHO", "OUTRO_AFASTAMENTO"].includes(situation);
}

export const situationColors: Record<WorkforceSituation, string> = {
  ATIVO: "border-emerald-200 bg-emerald-50 text-emerald-900",
  NOVO_ADMITIDO: "border-teal-200 bg-teal-50 text-teal-900",
  FERIAS: "border-blue-200 bg-blue-50 text-blue-900",
  AFASTADO: "border-amber-200 bg-amber-50 text-amber-900",
  DESLIGADO: "border-rose-200 bg-rose-50 text-rose-900",
  AVISO_PREVIO: "border-orange-200 bg-orange-50 text-orange-900",
  LICENCA_MATERNIDADE: "border-violet-200 bg-violet-50 text-violet-900",
  ACIDENTE_TRABALHO: "border-red-200 bg-red-50 text-red-900",
  OUTRO_AFASTAMENTO: "border-slate-300 bg-slate-100 text-slate-900",
};

export function attendanceWithinEmployment(employee: { admissionDate?: string | null; terminationDate?: string | null; situation?: string }, date: string): boolean {
  return (!employee.admissionDate || date >= employee.admissionDate)
    && (!employee.terminationDate || date <= employee.terminationDate)
    && (employee.situation !== "Desligado" || Boolean(employee.terminationDate));
}
