"use client";

import { memo, useMemo } from "react";
import { MonitorUp } from "lucide-react";
import { AttendanceStatusPicker } from "./attendance-status-picker";
import { BankHoursBadge } from "./bank-hours-badge";
import type { AttendanceCode, Employee } from "@/lib/daily-call-types";
import { initials } from "./today-table";

type Props = { employees: Employee[]; startDate: string; endDate: string; onSelect: (employee: Employee) => void; onAttendance: (id: string, date: string, code: AttendanceCode) => void };
const stickyColumns = [
  { label: "Matrícula", left: 0, width: 88 }, { label: "Colaborador", left: 88, width: 210 }, { label: "Gestor", left: 298, width: 118 },
  { label: "Férias previstas", left: 416, width: 124 }, { label: "BH em dias", left: 540, width: 78 }, { label: "A compensar / repor", left: 618, width: 130 }, { label: "Situação", left: 748, width: 108 },
] as const;

export function PeriodGrid({ employees, startDate, endDate, onSelect, onAttendance }: Props) {
  const dates = useMemo(() => dateRange(startDate, endDate), [startDate, endDate]);
  return <section data-testid="period-grid">
    <div className="flex items-center gap-2 border-b border-slate-200 bg-blue-50/60 px-3 py-2 text-xs text-blue-800 md:hidden"><MonitorUp size={15} className="shrink-0" />Deslize horizontalmente. A grade de período é mais confortável em telas maiores.</div>
    <div className="max-h-[min(620px,calc(100vh-190px))] overflow-auto overscroll-contain bg-white" tabIndex={0} aria-label="Grade de chamada por período"><table className="border-separate border-spacing-0 text-left text-xs"><thead className="sticky top-0 z-50 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr>{stickyColumns.map((column, index) => <StickyHead key={column.label} {...column} divider={index === stickyColumns.length - 1}>{column.label}</StickyHead>)}{dates.map((date) => <th key={date} className="min-w-12 border-b border-r border-slate-200 bg-slate-50 px-1 py-2.5 text-center font-semibold"><span className="block text-[9px] font-medium text-slate-400">{weekday(date)}</span>{date.slice(-2)}</th>)}</tr></thead><tbody>{employees.map((employee) => <PeriodRow key={employee.id} employee={employee} dates={dates} onSelect={onSelect} onAttendance={onAttendance} />)}</tbody></table></div>
  </section>;
}

const PeriodRow = memo(function PeriodRow({ employee, dates, onSelect, onAttendance }: { employee: Employee; dates: string[]; onSelect: (employee: Employee) => void; onAttendance: Props["onAttendance"] }) {
  return <tr className="group hover:bg-blue-50/40"><StickyCell left={0} width={88} className="font-mono text-slate-500">{employee.id}</StickyCell><StickyCell left={88} width={210}><button onClick={() => onSelect(employee)} className="flex items-center gap-2 text-left"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-900 text-[9px] font-bold text-white">{initials(employee.name)}</span><span className="min-w-0"><b className="block max-w-40 truncate text-xs group-hover:text-blue-600">{employee.name}</b>{employee.situation === "Novo admitido" ? <small className="text-[9px] font-bold text-emerald-700">NOVO ADMITIDO</small> : null}</span></button></StickyCell><StickyCell left={298} width={118}>{employee.manager}</StickyCell><StickyCell left={416} width={124}>{employee.plannedVacation}</StickyCell><StickyCell left={540} width={78} className={employee.bankDays > 0 ? "text-rose-600" : employee.bankDays < 0 ? "text-blue-600" : "text-slate-600"}>{employee.bankDays}d</StickyCell><StickyCell left={618} width={130}><BankHoursBadge employee={employee} compact display="pending" /></StickyCell><StickyCell left={748} width={108} divider>{employee.situation}</StickyCell>{dates.map((date) => <td key={date} className="border-b border-r border-slate-100 p-1 text-center"><AttendanceStatusPicker compact label={`${employee.name}, dia ${date.slice(-2)}`} value={employee.attendance[date]} onChange={(code) => onAttendance(employee.id, date, code)} /></td>)}</tr>;
});

function StickyHead({ left, width, divider = false, children }: { left: number; width: number; divider?: boolean; children: React.ReactNode }) { return <th className={`sticky z-[60] border-b border-r border-slate-200 bg-slate-50 px-2.5 py-2.5 font-semibold ${divider ? "shadow-[4px_0_8px_-5px_rgb(15_23_42/55%)]" : ""}`} style={{ left, minWidth: width, width }}>{children}</th>; }
function StickyCell({ left, width, divider = false, className = "", children }: { left: number; width: number; divider?: boolean; className?: string; children: React.ReactNode }) { return <td className={`sticky z-30 border-b border-r border-slate-100 bg-white px-2.5 py-2.5 group-hover:bg-blue-50 ${divider ? "shadow-[4px_0_8px_-5px_rgb(15_23_42/50%)]" : ""} ${className}`} style={{ left, minWidth: width, width }}>{children}</td>; }

export function dateRange(start: string, end: string) {
  const safeStart = start.startsWith("2026-09") ? Number(start.slice(-2)) : 1;
  const safeEnd = end.startsWith("2026-09") ? Number(end.slice(-2)) : 30;
  const from = Math.max(1, Math.min(safeStart, safeEnd));
  const to = Math.min(30, Math.max(safeStart, safeEnd));
  return Array.from({ length: to - from + 1 }, (_, index) => `2026-09-${String(from + index).padStart(2, "0")}`);
}
function weekday(date: string) { return new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)).replace(".", ""); }
