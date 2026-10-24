"use client";
import { attendanceWithinEmployment } from "@/lib/employee-lifecycle";

import { EmployeeAvatar } from "@/components/employee-avatar";

import { MoreHorizontal } from "lucide-react";
import { AttendanceStatusPicker } from "./attendance-status-picker";
import { DailyCallObservation } from "./daily-call-observation";
import { BankHoursBadge } from "./bank-hours-badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { AttendanceCode, Employee } from "@/lib/daily-call-types";
import { cn } from "@/lib/utils";

type Props = { employees: Employee[]; date: string; onSelect: (employee: Employee) => void; readOnly?: boolean;
  onSave?: (employee: Employee, date: string, status: AttendanceCode | null, observation: string | null) => Promise<boolean>;
  isSaving?: (employee: Employee, date: string) => boolean;
};
const columns = ["Matrícula", "Colaborador", "Unidade", "Gestor", "Situação BH", "Saldo BH", "A compensar / repor", "Status", "Observação", "Ações"];

export function TodayTable({ employees, date, onSelect, readOnly = true, onSave, isSaving }: Props) {
  return <>
    <div className="hidden overflow-x-auto md:block" data-testid="today-table"><table className="w-full min-w-[1320px] text-left text-sm"><thead className="sticky top-0 z-20 bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500"><tr><th className="w-10 border-b border-slate-200 px-3 py-2.5"><Checkbox aria-label="Selecionar todos" disabled /></th>{columns.map((heading) => <th key={heading} className="border-b border-slate-200 px-3 py-2.5 font-semibold">{heading}</th>)}</tr></thead><tbody>{employees.map((employee) => <EmployeeRow key={employee.id} employee={employee} date={date} onSelect={onSelect} readOnly={readOnly} onSave={onSave} isSaving={isSaving} />)}</tbody></table></div>
    <div className="divide-y divide-slate-100 md:hidden" data-testid="today-cards">{employees.map((employee) => <MobileCard key={employee.id} employee={employee} date={date} onSelect={onSelect} readOnly={readOnly} onSave={onSave} saving={isSaving?.(employee, date) ?? false} />)}</div>
  </>;
}

function EmployeeRow({ employee, date, onSelect, readOnly, onSave, isSaving }: Omit<Props, "employees"> & { employee: Employee; readOnly: boolean }) {
  const saving = isSaving?.(employee, date) ?? false;
  return <tr className="border-b border-slate-100 transition hover:bg-blue-50/35">
    <td className="px-3 py-2.5"><Checkbox aria-label={`Selecionar ${employee.name}`} disabled /></td>
    <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{employee.id}</td>
    <td className="px-3 py-2.5"><div className="flex items-center gap-2.5"><EmployeeAvatar name={employee.name} employeeId={employee.databaseId} size={32} /><button type="button" onClick={() => onSelect(employee)} className="min-w-0 text-left focus-visible:outline-2 focus-visible:outline-blue-600"><span className="min-w-0"><b className="block whitespace-nowrap font-semibold hover:text-blue-600">{employee.name}</b><span className="flex items-center gap-1.5">{employee.situation !== "Ativo" ? <small className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase", employee.situation === "Novo admitido" ? "bg-emerald-50 text-emerald-700" : "bg-cyan-50 text-cyan-700")}>{employee.situation}</small> : null}<small className="max-w-36 truncate text-slate-400">{employee.role}</small></span></span></button></div></td>
    <td className="whitespace-nowrap px-3 py-2.5">{employee.unit}</td><td className="whitespace-nowrap px-3 py-2.5">{employee.manager}</td>
    <td className="px-3 py-2.5"><BankHoursBadge employee={employee} display="situation" /></td>
    <td className={cn("whitespace-nowrap px-3 py-2.5 font-semibold", employee.bankDays !== null && employee.bankDays > 0 ? "text-rose-600" : employee.bankDays !== null && employee.bankDays < 0 ? "text-blue-600" : "text-slate-600")}>{employee.bankHours ?? "Sem extrato"}</td>
    <td className="px-3 py-2.5"><BankHoursBadge employee={employee} display="pending" /></td>
    <td className="px-3 py-2.5"><AttendanceStatusPicker value={employee.attendance[date]} origin={employee.attendanceSources?.[date]} label={`Status de ${employee.name}`} readOnly={readOnly || employee.canWrite === false || employee.activeInSystem === false || !attendanceWithinEmployment(employee, date)} saving={saving} onChange={(code) => void onSave?.(employee, date, code, employee.observations[date] ?? null)} onClear={() => void onSave?.(employee, date, null, null)} /></td>
    <td className="px-3 py-2.5"><DailyCallObservation label={`Observação de ${employee.name}`} value={employee.observations[date] ?? ""} status={employee.attendance[date]} readOnly={readOnly || employee.canWrite === false || employee.activeInSystem === false || !attendanceWithinEmployment(employee, date)} saving={saving} onSave={(value) => onSave?.(employee, date, employee.attendance[date] ?? null, value) ?? Promise.resolve(false)} /></td>
    <td className="px-3 py-2.5"><button aria-label={`Mais ações para ${employee.name}`} disabled className="grid h-8 w-8 place-items-center rounded-lg text-slate-300"><MoreHorizontal size={17} /></button></td>
  </tr>;
}

export function initials(name: string) { return name.split(" ").map((part) => part[0]).slice(0, 2).join(""); }

function MobileCard({ employee, date, onSelect, readOnly, onSave, saving }: Omit<Props, "employees"> & { employee: Employee; readOnly: boolean; saving: boolean }) {
  return <article className="space-y-3 p-3.5">
    <div className="flex items-start gap-3">
      <EmployeeAvatar name={employee.name} employeeId={employee.databaseId} size={36} />
      <div className="min-w-0 flex-1"><button onClick={() => onSelect(employee)} className="block max-w-full truncate text-left font-semibold hover:text-blue-600">{employee.name}</button><p className="truncate text-xs text-slate-500">{employee.id} · {employee.unit} · {employee.manager}</p></div>
      {employee.situation === "Novo admitido" ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">NOVO</span> : null}
    </div>
    <div className="flex items-center justify-between gap-3"><BankHoursBadge employee={employee} /><AttendanceStatusPicker value={employee.attendance[date]} origin={employee.attendanceSources?.[date]} label={`Status de ${employee.name}`} readOnly={readOnly || employee.canWrite === false || employee.activeInSystem === false || !attendanceWithinEmployment(employee, date)} saving={saving} onChange={(code) => void onSave?.(employee, date, code, employee.observations[date] ?? null)} onClear={() => void onSave?.(employee, date, null, null)} /></div>
    <DailyCallObservation label={`Observação de ${employee.name}`} value={employee.observations[date] ?? ""} status={employee.attendance[date]} readOnly={readOnly || employee.canWrite === false || employee.activeInSystem === false || !attendanceWithinEmployment(employee, date)} saving={saving} onSave={(value) => onSave?.(employee, date, employee.attendance[date] ?? null, value) ?? Promise.resolve(false)} />
  </article>;
}
