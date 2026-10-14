"use client";

import { BriefcaseBusiness, Building2, CalendarDays, Clock3, Hash, UserRound, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatWorkforceBalance, formatWorkforceDate } from "@/lib/workforce-format";
import { situationLabels, type WorkforceEmployee } from "@/lib/workforce";

function Info({ icon: Icon, label, value }: { icon: typeof Hash; label: string; value: string }) {
  return <div className="flex gap-2.5"><Icon size={16} className="mt-0.5 shrink-0 text-slate-400" /><div className="min-w-0"><span className="block text-xs text-slate-500">{label}</span><b className="block break-words text-sm font-medium leading-snug">{value}</b></div></div>;
}

export function WorkforceDrawer({ employee, onClose }: { employee: WorkforceEmployee | null; onClose: () => void }) {
  if (!employee) return null;
  const jornada = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(employee.workdayHours);
  const balance = formatWorkforceBalance(employee.bankBalanceMinutes);

  return <Sheet open onOpenChange={(open) => !open && onClose()}><SheetContent data-testid="workforce-drawer" showCloseButton={false} className="w-full overflow-y-auto bg-white p-0 sm:max-w-[540px]">
    <SheetClose aria-label="Fechar painel" className="absolute right-4 top-4 z-10 grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100"><X size={17} /></SheetClose>
    <SheetHeader className="border-b border-slate-200 p-5"><div className="flex items-center gap-4 pr-8"><span className="grid h-13 w-13 shrink-0 place-items-center rounded-xl bg-slate-900 text-base font-bold text-white"><UserRound size={24} /></span><div className="min-w-0"><SheetTitle className="truncate text-xl">{employee.name}</SheetTitle><SheetDescription className="truncate">{employee.role ?? "Função não informada"} · {employee.unit}</SheetDescription></div></div></SheetHeader>
    <div className="space-y-5 p-4 sm:p-5">
      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{situationLabels[employee.situation]}</span>
      <section><h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Dados do colaborador</h3><div className="grid gap-3 rounded-xl border border-slate-200 p-3.5 sm:grid-cols-2">
        <Info icon={Hash} label="Matrícula" value={employee.employeeNumber} />
        <Info icon={Building2} label="Unidade / setor" value={`${employee.unit} · ${employee.department ?? "Setor não informado"}`} />
        <Info icon={BriefcaseBusiness} label="Função" value={employee.role ?? "Não informada"} />
        <Info icon={UserRound} label="Gestor" value={employee.manager ?? "Sem gestor definido"} />
        <Info icon={CalendarDays} label="Admissão" value={formatWorkforceDate(employee.admissionDate)} />
        <Info icon={Clock3} label="Jornada" value={`${jornada} h/dia`} />
      </div></section>
      <section><h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Banco de horas</h3><div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs text-slate-500">Saldo da última medição aplicável</p><b className="mt-1 block text-lg">{balance}</b>{employee.bankBalanceDays !== null ? <p className="text-xs text-slate-500">{employee.bankBalanceDays} dia(s) · Medição em {formatWorkforceDate(employee.bankMeasurementDate)}</p> : <p className="text-xs text-slate-500">Nenhuma medição disponível.</p>}</div></section>
    </div>
  </SheetContent></Sheet>;
}
