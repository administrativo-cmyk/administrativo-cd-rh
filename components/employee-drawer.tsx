"use client";

import { EmployeeSchedule } from "@/components/employee-schedule";
import { EmployeeAvatar } from "@/components/employee-avatar";

import { BriefcaseBusiness, Building2, CalendarDays, Clock3, Hash, MessageSquareText, UserRound, X } from "lucide-react";
import { AttendanceStatusPicker } from "./attendance-status-picker";
import { BankHoursBadge } from "./bank-hours-badge";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AttendanceCode, Employee } from "@/lib/daily-call-types";
import { attendanceMeta, getBankHoursSummary } from "@/lib/daily-call-rules";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import { DailyCallAttachments } from "./daily-call-attachments";

type Props = { employee: Employee | null; onClose: () => void; date?: string; canManageAttachments?: boolean; onAttendance?: (id: string, date: string, code: AttendanceCode) => void };

export function EmployeeDrawer({ employee, onClose, date = todayInSaoPaulo(), canManageAttachments = false }: Props) {
  if (!employee) return null;
  const bank = getBankHoursSummary(employee);
  const recentDates = Object.keys(employee.attendance).filter((item) => item <= date).sort().slice(-6).reverse();
  const measured = bank.situation !== "Sem extrato";
  return <Sheet open onOpenChange={(open) => !open && onClose()}><SheetContent data-testid="employee-drawer" showCloseButton={false} className="w-full overflow-y-auto bg-white p-0 sm:max-w-[540px]"><SheetClose aria-label="Fechar painel" className="absolute right-4 top-4 z-10 grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100"><X size={17} /></SheetClose><SheetHeader className="border-b border-slate-200 p-5"><div className="flex items-center gap-4 pr-8"><EmployeeAvatar name={employee.name} employeeId={employee.databaseId} size={52} /><div className="min-w-0"><SheetTitle className="truncate text-xl">{employee.name}</SheetTitle><SheetDescription className="truncate">{employee.role} · {employee.unit}</SheetDescription></div></div></SheetHeader><div className="space-y-5 p-4 sm:p-5"><div className="flex flex-wrap items-center gap-2"><SituationBadge situation={employee.situation} /><BankHoursBadge employee={employee} /></div>
    <section><h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Dados do colaborador</h3><div className="grid gap-3 rounded-xl border border-slate-200 p-3.5 sm:grid-cols-2"><Info icon={Hash} label="Matrícula" value={employee.id} /><Info icon={Building2} label="Unidade / setor" value={`${employee.unit} · ${employee.department}`} /><Info icon={BriefcaseBusiness} label="Função" value={employee.role} /><Info icon={UserRound} label="Gestor" value={employee.manager} /><Info icon={CalendarDays} label="Admissão" value={formatDate(employee.admissionDate)} /><Info icon={CalendarDays} label="Férias previstas" value={employee.plannedVacation} /></div></section>
    {employee.databaseId ? <EmployeeSchedule key={`${employee.databaseId}:${date}`} employeeId={employee.databaseId} date={date} /> : null}
    <section><h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Banco de horas</h3><div className="grid grid-cols-3 gap-2"><MiniMetric label="Saldo BH" value={bank.balanceHours} /><MiniMetric label="A compensar" value={measured ? `${bank.pendingCompensationDays}d` : "—"} tone={bank.pendingCompensationDays > 0 ? "rose" : undefined} /><MiniMetric label="A repor" value={measured ? `${bank.replacementDays}d` : "—"} tone={bank.replacementDays > 0 ? "blue" : undefined} /></div>{employee.realBank ? <p className="mt-2 text-xs text-slate-500">Medição: {formatDate(employee.realBank.measurementDate)} · Jornada: {employee.realBank.workdayHours}h/dia</p> : null}</section>
    {employee.observations[date] ? <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5"><h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-800"><MessageSquareText size={14} />Observação da data</h3><p className="mt-1.5 text-sm text-slate-700">{employee.observations[date]}</p></section> : null}
    <section><h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Histórico recente</h3><div className="divide-y divide-slate-100 rounded-xl border border-slate-200">{recentDates.length ? recentDates.map((item) => { const code = employee.attendance[item]; return <div key={item} className="flex items-center gap-3 p-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-50 text-slate-500"><Clock3 size={16} /></span><div className="min-w-0 flex-1"><b className="block text-sm">{formatDate(item)}</b><span className="block truncate text-xs text-slate-500">{attendanceMeta[code].label}</span></div><AttendanceStatusPicker compact label={`Status de ${formatDate(item)}`} value={code} origin={employee.attendanceSources?.[item]} readOnly /></div>; }) : <p className="p-4 text-sm text-slate-500">Nenhuma chamada lançada neste período.</p>}</div></section>
    {employee.databaseId && canManageAttachments ? <DailyCallAttachments key={`${employee.databaseId}:${date}`} employeeId={employee.databaseId} date={date} canWrite /> : null}
  </div></SheetContent></Sheet>;
}

function Info({ icon: Icon, label, value }: { icon: typeof Hash; label: string; value: string }) { return <div className="flex gap-2.5"><Icon size={16} className="mt-0.5 shrink-0 text-slate-400" /><div className="min-w-0"><span className="block text-xs text-slate-500">{label}</span><b className="block text-sm font-medium leading-snug">{value}</b></div></div>; }
function MiniMetric({ label, value, tone }: { label: string; value: string; tone?: "rose" | "blue" }) { return <div className={`rounded-xl p-3 ${tone === "rose" ? "bg-rose-50 text-rose-700" : tone === "blue" ? "bg-blue-50 text-blue-700" : "bg-slate-50"}`}><span className="block text-[9px] font-bold uppercase tracking-wide opacity-70">{label}</span><b className="mt-1 block text-lg">{value}</b></div>; }
function SituationBadge({ situation }: { situation: Employee["situation"] }) { return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${situation === "Novo admitido" ? "bg-emerald-50 text-emerald-700" : situation === "Férias" ? "bg-cyan-50 text-cyan-700" : situation === "Afastado" ? "bg-fuchsia-50 text-fuchsia-700" : "bg-slate-100 text-slate-700"}`}>{situation}</span>; }
function formatDate(date: string) { if (!date) return "Não informada"; return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); }
