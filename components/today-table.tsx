"use client";

import { MessageSquareText, MoreHorizontal } from "lucide-react";
import { AttendanceStatusPicker } from "./attendance-status-picker";
import { BankHoursBadge } from "./bank-hours-badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { Employee } from "@/lib/daily-call-types";
import { cn } from "@/lib/utils";

type Props = { employees: Employee[]; date: string; onSelect: (employee: Employee) => void; readOnly?: boolean };
const columns = ["Matrícula", "Colaborador", "Unidade", "Gestor", "Situação BH", "Saldo BH", "A compensar / repor", "Status", "Observação", "Ações"];

export function TodayTable({ employees, date, onSelect, readOnly = true }: Props) {
  return <>
    <div className="hidden overflow-x-auto md:block" data-testid="today-table"><table className="w-full min-w-[1320px] text-left text-sm"><thead className="sticky top-0 z-20 bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500"><tr><th className="w-10 border-b border-slate-200 px-3 py-2.5"><Checkbox aria-label="Selecionar todos" disabled={readOnly} /></th>{columns.map((heading) => <th key={heading} className="border-b border-slate-200 px-3 py-2.5 font-semibold">{heading}</th>)}</tr></thead><tbody>{employees.map((employee) => <EmployeeRow key={employee.id} employee={employee} date={date} onSelect={onSelect} readOnly={readOnly} />)}</tbody></table></div>
    <div className="divide-y divide-slate-100 md:hidden" data-testid="today-cards">{employees.map((employee) => <article key={employee.id} className="space-y-3 p-3.5"><div className="flex items-start gap-3"><button aria-label={`Abrir detalhes de ${employee.name}`} onClick={() => onSelect(employee)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">{initials(employee.name)}</button><div className="min-w-0 flex-1"><button onClick={() => onSelect(employee)} className="block max-w-full truncate text-left font-semibold hover:text-blue-600">{employee.name}</button><p className="truncate text-xs text-slate-500">{employee.id} · {employee.unit} · {employee.manager}</p></div>{employee.situation === "Novo admitido" ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">NOVO</span> : null}</div><div className="flex items-center justify-between gap-3"><BankHoursBadge employee={employee} /><AttendanceStatusPicker value={employee.attendance[date]} label={`Status de ${employee.name}`} readOnly /></div><input aria-label={`Observação de ${employee.name}`} className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm" placeholder="Sem observação" value={employee.observations[date] ?? ""} readOnly disabled={readOnly} /></article>)}</div>
  </>;
}

function EmployeeRow({ employee, date, onSelect, readOnly }: { employee: Employee; date: string; onSelect: Props["onSelect"]; readOnly: boolean }) {
  return <tr className="border-b border-slate-100 transition hover:bg-blue-50/35">
    <td className="px-3 py-2.5"><Checkbox aria-label={`Selecionar ${employee.name}`} disabled={readOnly} /></td>
    <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{employee.id}</td>
    <td className="px-3 py-2.5"><button onClick={() => onSelect(employee)} className="flex items-center gap-2.5 text-left"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-900 text-[10px] font-bold text-white">{initials(employee.name)}</span><span className="min-w-0"><b className="block whitespace-nowrap font-semibold hover:text-blue-600">{employee.name}</b><span className="flex items-center gap-1.5">{employee.situation !== "Ativo" ? <small className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase", employee.situation === "Novo admitido" ? "bg-emerald-50 text-emerald-700" : "bg-cyan-50 text-cyan-700")}>{employee.situation}</small> : null}<small className="max-w-36 truncate text-slate-400">{employee.role}</small></span></span></button></td>
    <td className="whitespace-nowrap px-3 py-2.5">{employee.unit}</td><td className="whitespace-nowrap px-3 py-2.5">{employee.manager}</td>
    <td className="px-3 py-2.5"><BankHoursBadge employee={employee} display="situation" /></td>
    <td className={cn("whitespace-nowrap px-3 py-2.5 font-semibold", employee.bankDays !== null && employee.bankDays > 0 ? "text-rose-600" : employee.bankDays !== null && employee.bankDays < 0 ? "text-blue-600" : "text-slate-600")}>{employee.bankHours ?? "Sem extrato"}</td>
    <td className="px-3 py-2.5"><BankHoursBadge employee={employee} display="pending" /></td>
    <td className="px-3 py-2.5"><AttendanceStatusPicker value={employee.attendance[date]} label={`Status de ${employee.name}`} readOnly /></td>
    <td className="px-3 py-2.5"><label className="relative block"><MessageSquareText size={14} className="absolute left-2.5 top-2.5 text-slate-400" /><input aria-label={`Observação de ${employee.name}`} className="h-9 w-48 rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-xs" placeholder="Sem observação" value={employee.observations[date] ?? ""} readOnly disabled={readOnly} /></label></td>
    <td className="px-3 py-2.5"><button aria-label={`Mais ações para ${employee.name}`} disabled className="grid h-8 w-8 place-items-center rounded-lg text-slate-300"><MoreHorizontal size={17} /></button></td>
  </tr>;
}

export function initials(name: string) { return name.split(" ").map((part) => part[0]).slice(0, 2).join(""); }
