import type { AttendanceCode, AttendanceStatus, AttendanceStatusCode, BankHoursSummary, Employee } from "./daily-call-types";
import { calculateCompensationCycle } from "./domain/bank-hours";

type AttendanceVisual = AttendanceStatus & { className: string };

export const attendanceMeta: Record<AttendanceStatusCode, AttendanceVisual> = {
  P: { code: "P", label: "Presente", shortLabel: "Presente", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  F: { code: "F", label: "Folga", shortLabel: "Folga", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  A: { code: "A", label: "Atestado", shortLabel: "Atestado", className: "bg-orange-50 text-orange-700 ring-orange-200" },
  I: { code: "I", label: "Injustificado", shortLabel: "Injustificado", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  B: { code: "B", label: "Feriado", shortLabel: "Feriado", className: "bg-violet-50 text-violet-700 ring-violet-200" },
  X: { code: "X", label: "Férias", shortLabel: "Férias", className: "bg-cyan-50 text-cyan-700 ring-cyan-200" },
  H: { code: "H", label: "Hora Extra", shortLabel: "H. extra", className: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  G: { code: "G", label: "Abono / Justificado / Compensação", shortLabel: "Compensação", className: "bg-green-100 text-green-800 ring-green-300" },
  D: { code: "D", label: "Desligado", shortLabel: "Desligado", className: "bg-slate-100 text-slate-600 ring-slate-200" },
  AF: { code: "AF", label: "INSS / Afastamento", shortLabel: "Afastamento", className: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200" },
};

export function countUsedCompensations(employee: Pick<Employee, "bankDays" | "attendance">): number {
  return calculateCompensationCycle({
    balanceDays: employee.bankDays,
    effectiveFrom: "0000-01-01",
    attendance: Object.entries(employee.attendance).map(([date, status]) => ({ date, status })),
  }).compensationDaysUsed;
}

export function calculatePendingCompensation(employee: Pick<Employee, "bankDays" | "attendance">): number {
  return calculateCompensationCycle({
    balanceDays: employee.bankDays,
    effectiveFrom: "0000-01-01",
    attendance: Object.entries(employee.attendance).map(([date, status]) => ({ date, status })),
  }).pendingCompensationDays;
}

export function getBankHoursSummary(employee: Pick<Employee, "bankDays" | "bankHours" | "attendance">): BankHoursSummary {
  const pendingCompensationDays = calculatePendingCompensation(employee);
  const replacementDays = employee.bankDays < 0 ? Math.abs(employee.bankDays) : 0;
  return {
    balanceDays: employee.bankDays,
    balanceHours: employee.bankHours,
    pendingCompensationDays,
    replacementDays,
    usedCompensationDays: countUsedCompensations(employee),
    situation: pendingCompensationDays > 0 ? "A compensar" : replacementDays > 0 ? "A repor" : "Em dia",
  };
}

export function applyAttendanceStatus(employee: Employee, date: string, status: AttendanceCode): Employee {
  return { ...employee, attendance: { ...employee.attendance, [date]: status } };
}

export function usedCompensations(employee: Employee): number { return countUsedCompensations(employee); }
export function remainingBankDays(employee: Employee): number {
  const summary = getBankHoursSummary(employee);
  return summary.pendingCompensationDays || -summary.replacementDays;
}
export function bankSituation(employee: Employee) { return getBankHoursSummary(employee).situation; }

export function statusMatches(code: AttendanceStatusCode | undefined, status: string): boolean {
  if (status === "Todos") return true;
  if (!code) return status === "Outros";
  const map: Record<string, AttendanceStatusCode[]> = {
    Presente: ["P"], Folga: ["F"], Atestado: ["A"], Injustificado: ["I"], "Férias": ["X"], INSS: ["AF"], Outros: ["B", "H", "G", "D"],
  };
  return map[status]?.includes(code) ?? true;
}
