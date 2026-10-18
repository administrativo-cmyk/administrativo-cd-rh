"use client";

import { EmployeeAvatar } from "@/components/employee-avatar";

import { BriefcaseBusiness, Building2, CalendarDays, Clock3, Hash, UserRound, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatWorkforceDate } from "@/lib/workforce-format";
import { formatSignedMinutes } from "@/lib/domain/bank-hours";
import { classifyTimeBank, timeBankStatusLabel } from "@/lib/time-bank-selectors";
import type { TimeBankEmployee } from "@/lib/time-bank";
import { situationLabels } from "@/lib/workforce";

function Info({ icon: Icon, label, value }: { icon: typeof Hash; label: string; value: string }) {
  return <div className="flex gap-2.5"><Icon size={16} className="mt-0.5 shrink-0 text-slate-400" /><div className="min-w-0"><span className="block text-xs text-slate-500">{label}</span><b className="block break-words text-sm font-medium leading-snug">{value}</b></div></div>;
}

export function formatBankDays(value: number | null): string {
  if (value === null) return "-";
  return `${value > 0 ? "+" : ""}${value} ${Math.abs(value) === 1 ? "dia" : "dias"}`;
}

export function TimeBankDrawer({ employee, onClose }: { employee: TimeBankEmployee | null; onClose: () => void }) {
  if (!employee) return null;
  const measured = employee.measuredMinutes !== null;
  const workdayMinutes = Math.round(employee.workdayHours * 60);
  const classification = classifyTimeBank(employee).replace("_", " ");

  return <Sheet open onOpenChange={(open) => !open && onClose()}><SheetContent data-testid="time-bank-drawer" showCloseButton={false} className="w-full overflow-y-auto bg-white p-0 sm:max-w-[540px]">
    <SheetClose aria-label="Fechar painel" className="absolute right-4 top-4 z-10 grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100"><X size={17} /></SheetClose>
    <SheetHeader className="border-b border-slate-200 p-5"><div className="flex items-center gap-4 pr-8"><EmployeeAvatar name={employee.name} employeeId={employee.id} size={52} /><div className="min-w-0"><SheetTitle className="truncate text-xl">{employee.name}</SheetTitle><SheetDescription className="truncate">{employee.role ?? "Função não informada"} · {employee.unit}</SheetDescription></div></div></SheetHeader>
    <div className="space-y-5 p-4 sm:p-5">
      <section><h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Dados do colaborador</h3><div className="grid gap-3 rounded-xl border border-slate-200 p-3.5 sm:grid-cols-2">
        <Info icon={Hash} label="Matrícula" value={employee.employeeNumber} />
        <Info icon={Building2} label="Unidade / setor" value={`${employee.unit} · ${employee.department ?? "Setor não informado"}`} />
        <Info icon={BriefcaseBusiness} label="Função" value={employee.role ?? "Não informada"} />
        <Info icon={UserRound} label="Gestor" value={employee.manager ?? "Sem gestor definido"} />
        <Info icon={CalendarDays} label="Situação" value={situationLabels[employee.situation]} />
        <Info icon={Clock3} label="Jornada individual" value={formatSignedMinutes(workdayMinutes).replace(/^\+/, "") + " por dia"} />
      </div></section>
      <section><h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Banco de horas · somente leitura</h3><div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs text-slate-500">Saldo medido</span><b className="mt-1 block text-lg">{measured ? formatSignedMinutes(employee.measuredMinutes!) : "Sem extrato"}</b><small className="text-slate-500">{classification}</small></div>
        <div className="rounded-xl bg-blue-50 p-3"><span className="text-xs text-slate-500">Saldo atual em dias</span><b className="mt-1 block text-lg text-blue-900">{formatBankDays(employee.effectiveDays)}</b><small className="text-blue-700">{timeBankStatusLabel(employee)}</small></div>
      </div><div className="mt-2 grid gap-3 rounded-xl border border-slate-200 p-3.5 sm:grid-cols-2">
        <Info icon={CalendarDays} label="Medição em" value={formatWorkforceDate(employee.measurementDate)} />
        <Info icon={CalendarDays} label="Ciclo vigente desde" value={formatWorkforceDate(employee.effectiveFrom)} />
        <Info icon={Clock3} label="Dias equivalentes medidos" value={formatBankDays(employee.measuredDays)} />
        <Info icon={Clock3} label="Lançamentos G no ciclo" value={measured ? String(employee.usedCompensationDays) : "-"} />
        <Info icon={Clock3} label="A compensar hoje" value={measured ? `${employee.pendingCompensationDays} dia(s)` : "-"} />
        <Info icon={Clock3} label="A repor" value={measured ? `${employee.replacementDays} dia(s)` : "-"} />
      </div><p className="mt-2 text-xs text-slate-500">O saldo medido permanece histórico. Os dias atuais consideram os lançamentos G do ciclo até hoje.</p></section>
    </div>
  </SheetContent></Sheet>;
}
