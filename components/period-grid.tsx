"use client";
import { attendanceWithinEmployment } from "@/lib/employee-lifecycle";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Minus, MonitorUp, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { AttendanceStatusPicker } from "./attendance-status-picker";
import { BankHoursBadge } from "./bank-hours-badge";
import type { AttendanceCode, Employee } from "@/lib/daily-call-types";
import { EmployeeAvatar } from "./employee-avatar";
import { validPeriod } from "@/lib/data/daily-call-dates";
import { cn } from "@/lib/utils";
import { PeriodPunchRow } from "./period-punch-row";

type Props = { employees: Employee[]; startDate: string; endDate: string; onSelect: (employee: Employee) => void;
  managerGroups?: Array<[string, Employee[]]>;
  readOnly?: boolean; onSave?: (employee: Employee, date: string, status: AttendanceCode | null, observation: string | null) => Promise<boolean>;
  isSaving?: (employee: Employee, date: string) => boolean;
  fillHeight?: boolean;
  columnsCollapsed?: boolean;
  onColumnsCollapsedChange?: (collapsed: boolean) => void;
};
const stickyColumns = [
  { label: "Matrícula", left: 0, width: 88 }, { label: "Colaborador", left: 88, width: 210 }, { label: "Gestor", left: 298, width: 118 },
  { label: "Férias previstas", left: 416, width: 124 }, { label: "BH em dias", left: 540, width: 78 }, { label: "A compensar / repor", left: 618, width: 130 }, { label: "Situação", left: 748, width: 108 },
] as const;

export const PeriodGrid = memo(function PeriodGrid({ employees, managerGroups, startDate, endDate, onSelect, readOnly = true, onSave, isSaving, fillHeight = false, columnsCollapsed, onColumnsCollapsedChange }: Props) {
  const dates = useMemo(() => dateRange(startDate, endDate), [startDate, endDate]);
  const [expandedEmployees, setExpandedEmployees] = useState<Set<string>>(() => new Set());
  const expandableEmployees = useMemo(() => dates.length ? (managerGroups ? managerGroups.flatMap(([, rows]) => rows) : employees).filter(employee => employee.databaseId) : [], [employees, managerGroups, dates.length]);
  const allExpanded = expandableEmployees.length > 0 && expandableEmployees.every(employee => expandedEmployees.has(employee.id));
  const punchColumnWidth = expandableEmployees.some(employee => expandedEmployees.has(employee.id)) ? 40 : 28;
  const toggleEmployee = useCallback((id: string) => setExpandedEmployees(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  function toggleAllEmployees() {
    setExpandedEmployees(current => {
      const next = new Set(current);
      for (const employee of expandableEmployees) { if (allExpanded) next.delete(employee.id); else next.add(employee.id); }
      return next;
    });
  }
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const collapsed = columnsCollapsed ?? localCollapsed;
  const setCollapsed = (next: boolean) => { setLocalCollapsed(next); onColumnsCollapsedChange?.(next); };
  const tableId = useId();
  const toggleButton = useRef<HTMLButtonElement>(null);
  const retainFocus = useRef(false);
  useEffect(() => { if (retainFocus.current) toggleButton.current?.focus({ preventScroll: true }); }, [collapsed]);
  const toggleColumns = <button ref={toggleButton} type="button" aria-label={collapsed ? "Mostrar colunas de dados" : "Recolher colunas de dados"} title={collapsed ? "Mostrar matrícula, gestor, férias, banco de horas e situação" : "Manter somente colaborador e dias"} aria-expanded={!collapsed} aria-controls={tableId} onClick={() => { retainFocus.current = true; setCollapsed(!collapsed); }} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600">{collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}</button>;
  const collaboratorHeading = <span className="flex min-w-0 items-center gap-1"><button type="button" aria-label={allExpanded ? "Recolher batidas de todos os colaboradores" : "Expandir batidas de todos os colaboradores"} title={allExpanded ? "Recolher todos os pontos da lista" : "Expandir todos os pontos da lista"} aria-expanded={allExpanded} aria-controls={tableId} disabled={!expandableEmployees.length} onClick={toggleAllEmployees} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-blue-100 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600">{allExpanded ? <Minus size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}</button><span className="min-w-0 flex-1">Colaborador</span>{collapsed ? toggleColumns : null}</span>;
  return <section data-testid="period-grid" data-columns-collapsed={collapsed} style={{ "--period-collaborator-width": "clamp(160px, 16vw, 220px)" } as CSSProperties} className={cn(fillHeight && "flex h-full min-h-0 flex-col")}>
    <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-blue-50/60 px-3 py-2 text-xs text-blue-800 md:hidden"><MonitorUp size={15} className="shrink-0" />Deslize horizontalmente. A grade de período é mais confortável em telas maiores.</div>
    <div className={cn("overflow-auto overscroll-contain bg-white", fillHeight ? "min-h-0 flex-1" : "max-h-[min(620px,calc(100vh-190px))]")} tabIndex={0} aria-label="Grade de chamada por período">
      <table id={tableId} className="w-full table-fixed border-separate border-spacing-0 text-left text-xs" style={{ minWidth: collapsed ? `calc(var(--period-collaborator-width) + ${dates.length} * ${punchColumnWidth}px)` : 856 + dates.length * 48 }}>
        <colgroup>{collapsed ? <col style={{ width: "var(--period-collaborator-width)" }} /> : stickyColumns.map(column => <col key={column.label} style={{ width: column.width }} />)}{dates.map(date => <col key={date} />)}</colgroup>
        <thead className="sticky top-0 z-50 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr>
          {collapsed ? <StickyHead left={0} width="var(--period-collaborator-width)" divider>{collaboratorHeading}</StickyHead> : stickyColumns.map((column, index) => <StickyHead key={column.label} {...column} divider={index === stickyColumns.length - 1}>{column.label === "Colaborador" ? collaboratorHeading : column.label === "Situação" ? <span className="flex items-center justify-between gap-1"><span>{column.label}</span>{toggleColumns}</span> : column.label}</StickyHead>)}
          {dates.map(date => <th key={date} scope="col" title={date.split("-").reverse().join("/")} className="overflow-hidden border-b border-r border-slate-200 bg-slate-50 px-0.5 py-2.5 text-center font-semibold"><span className="block text-[9px] font-medium tracking-normal text-slate-400">{weekday(date)}</span>{date.slice(-2)}</th>)}
        </tr></thead>
        {(managerGroups ?? [["", employees] as [string, Employee[]]]).map(([manager, rows]) => <tbody key={manager} aria-label={manager ? `Equipe de ${manager}` : undefined}>
          {manager ? <tr><th scope="rowgroup" colSpan={(collapsed ? 1 : stickyColumns.length) + dates.length} className="border-b border-slate-200 bg-slate-100 py-2 text-sm font-semibold text-slate-800"><span className="sticky left-0 inline-flex max-w-[min(100%,80vw)] items-center gap-2 px-3"><span className="truncate">{manager}</span><span className="shrink-0 text-xs font-normal text-slate-600">{rows.length} {rows.length === 1 ? "colaborador" : "colaboradores"}</span></span></th></tr> : null}
          {rows.map(employee => <PeriodRow key={employee.id} employee={employee} dates={dates} collapsed={collapsed} expanded={expandedEmployees.has(employee.id)} onToggle={toggleEmployee} onSelect={onSelect} readOnly={readOnly} onSave={onSave} isSaving={isSaving} />)}
        </tbody>)}
      </table>
    </div>
  </section>;
});

const PeriodRow = memo(function PeriodRow({ employee, dates, collapsed, expanded, onToggle, onSelect, readOnly, onSave, isSaving }: { employee: Employee; dates: string[]; collapsed: boolean; expanded: boolean; onToggle: (id: string) => void; onSelect: Props["onSelect"]; readOnly: boolean; onSave?: Props["onSave"]; isSaving?: Props["isSaving"] }) {
  const punchRowId = useId();
  return <><tr className="group hover:bg-blue-50/40">
    {!collapsed ? <StickyCell left={0} width={88} className="font-mono text-slate-500">{employee.id}</StickyCell> : null}
    <StickyCell left={collapsed ? 0 : 88} width={collapsed ? "var(--period-collaborator-width)" : 210} divider={collapsed} className="!px-1"><div className="flex min-w-0 items-center gap-1"><button type="button" aria-label={`${expanded ? "Recolher" : "Expandir"} batidas de ${employee.name}`} aria-expanded={expanded} aria-controls={expanded ? punchRowId : undefined} disabled={!employee.databaseId || dates.length === 0} title={employee.databaseId ? `${expanded ? "Recolher" : "Ver"} batidas do período` : "Cadastro ainda não sincronizado"} onClick={() => onToggle(employee.id)} className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-600 hover:bg-blue-100 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-blue-600">{expanded ? <Minus size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}</button><EmployeeAvatar name={employee.name} employeeId={employee.databaseId} size={28} /><button type="button" aria-label={`Abrir detalhes de ${employee.name}`} onClick={() => onSelect(employee)} title={employee.name} className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-2 focus-visible:outline-blue-600"><span className="min-w-0 flex-1"><b className="block truncate text-xs group-hover:text-blue-600">{employee.name}</b>{employee.situation === "Novo admitido" ? <small className="text-[9px] font-bold text-emerald-700">NOVO ADMITIDO</small> : null}</span></button></div></StickyCell>
    {!collapsed ? <><StickyCell left={298} width={118}>{employee.manager}</StickyCell><StickyCell left={416} width={124}>{employee.plannedVacation}</StickyCell><StickyCell left={540} width={78} className={employee.bankDays !== null && employee.bankDays > 0 ? "text-rose-600" : employee.bankDays !== null && employee.bankDays < 0 ? "text-blue-600" : "text-slate-600"}>{employee.bankDays === null ? "Sem extrato" : `${employee.bankDays}d`}</StickyCell><StickyCell left={618} width={130}><BankHoursBadge employee={employee} compact display="pending" /></StickyCell><StickyCell left={748} width={108} divider>{employee.situation}</StickyCell></> : null}
    {dates.map(date => <td key={date} className={cn("border-b border-r border-slate-100 text-center", collapsed ? "px-px py-1" : "p-1")}><AttendanceStatusPicker compact fitCell={collapsed} label={`${employee.name}, dia ${date.slice(-2)}`} value={employee.attendance[date]} origin={employee.attendanceSources?.[date]} readOnly={readOnly || employee.canWrite === false || employee.activeInSystem === false || employee.attendanceSources?.[date] === "lifecycle" || !attendanceWithinEmployment(employee, date)} saving={isSaving?.(employee, date) ?? false} onChange={code => void onSave?.(employee, date, code, employee.observations[date] ?? null)} onClear={() => void onSave?.(employee, date, null, null)} /></td>)}
  </tr>{expanded && employee.databaseId ? <PeriodPunchRow id={punchRowId} employeeId={employee.databaseId} employeeName={employee.name} dates={dates} collapsed={collapsed} /> : null}</>;
});

function StickyHead({ left, width, divider = false, children }: { left: number; width: number | string; divider?: boolean; children: ReactNode }) { return <th scope="col" className={`sticky z-[60] border-b border-r border-slate-200 bg-slate-50 px-2.5 py-2.5 font-semibold ${divider ? "shadow-[4px_0_8px_-5px_rgb(15_23_42/55%)]" : ""}`} style={{ left, width }}>{children}</th>; }
function StickyCell({ left, width, divider = false, className = "", children }: { left: number; width: number | string; divider?: boolean; className?: string; children: ReactNode }) { return <td className={`sticky z-30 overflow-hidden border-b border-r border-slate-100 bg-white px-2.5 py-2.5 group-hover:bg-blue-50 ${divider ? "shadow-[4px_0_8px_-5px_rgb(15_23_42/50%)]" : ""} ${className}`} style={{ left, width }}>{children}</td>; }

export function dateRange(start: string, end: string) {
  if (!validPeriod(start, end)) return [];
  const dates: string[] = [];
  const endTime = Date.parse(`${end}T12:00:00Z`);
  for (let time = Date.parse(`${start}T12:00:00Z`); time <= endTime; time += 86_400_000) dates.push(new Date(time).toISOString().slice(0, 10));
  return dates;
}
const weekdayFormatter = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" });
function weekday(date: string) { return weekdayFormatter.format(new Date(`${date}T12:00:00Z`)).replace(".", ""); }
