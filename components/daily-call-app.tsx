"use client";

import { useState } from "react";
import { CalendarRange, CheckCircle2, Download, Maximize2, Minimize2, RefreshCw, Users } from "lucide-react";
import { Toaster } from "sonner";
import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";
import { AttendanceLegend } from "./attendance-legend";
import { DailyCallFilters } from "./daily-call-filters";
import { DailyCallMetrics } from "./daily-call-metrics";
import { DailyCallShortcuts } from "./daily-call-shortcuts";
import { DailyCallPending } from "./daily-call-pending";
import { DailyCallBatch } from "./daily-call-batch";
import { EmployeeDrawer } from "./employee-drawer";
import { EmptyState, ErrorState, LoadingSkeleton } from "./interface-states";
import { ManagerGroup } from "./manager-group";
import { PeriodGrid } from "./period-grid";
import { TodayTable } from "./today-table";
import { ViewModeSelector } from "./view-mode-selector";
import { Checkbox } from "@/components/ui/checkbox";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDailyCall } from "@/hooks/use-daily-call";
import { useDailyCallPreferences } from "@/hooks/use-daily-call-preferences";
import type { DailyCallSnapshot } from "@/lib/daily-call-types";
import type { AuthenticatedProfile } from "@/lib/auth/types";
import { cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv";
import { exportDailyCall } from "@/lib/daily-call-export";
import { useBoardFullscreen } from "@/hooks/use-board-fullscreen";
import { payrollPeriodForMonth } from "@/lib/payroll-period";

type Props = { profile: AuthenticatedProfile; initialDate: string; initialSnapshot: DailyCallSnapshot | null };

export function DailyCallApp({ profile, initialDate, initialSnapshot }: Props) {
  const daily = useDailyCall(initialDate, initialSnapshot);
  const preferences = useDailyCallPreferences(profile.id);
  const { expanded, region, toggle } = useBoardFullscreen();
  const period = payrollPeriodForMonth(daily.filters.endDate.slice(0, 7));
  const [mobileOpen, setMobileOpen] = useState(false);
  const canWrite = profile.papel_usuario === "ADMIN" || profile.papel_usuario === "RH" || profile.papel_usuario === "GESTOR";
  const isManager = profile.papel_usuario === "GESTOR";
  const unitOptions = [...new Set(daily.employees.map((employee) => employee.unit))].sort((a, b) => a.localeCompare(b, "pt-BR"));

  function exportVisibleCall() {
    const start = preferences.viewMode === "period" ? daily.filters.startDate : daily.selectedDate;
    const end = preferences.viewMode === "period" ? daily.filters.endDate : daily.selectedDate;
    downloadCsv(exportDailyCall(daily.filteredEmployees, start, end), `chamada-diaria-${start}-${end}.csv`);
  }

  function renderContent() {
    if (daily.loading || preferences.loading) return <LoadingSkeleton />;
    if (daily.error) return <ErrorState onRetry={daily.refresh} />;
    if (isManager && !profile.gestor_id && !daily.employees.length) return <div className="p-8 text-center text-sm text-slate-600">Seu usuário ainda não está vinculado a um gestor do quadro.</div>;
    if (!daily.employees.length) return <EmptyState />;
    if (!daily.filteredEmployees.length) return <EmptyState filtered />;
    if (preferences.viewMode === "period") {
      return <PeriodGrid key={profile.id} employees={daily.filteredEmployees} managerGroups={daily.groupByManager ? daily.managerGroups : undefined} startDate={daily.filters.startDate} endDate={daily.filters.endDate} onSelect={daily.setSelectedEmployee} readOnly={!canWrite} onSave={canWrite ? daily.saveAttendance : undefined} isSaving={daily.isSaving} fillHeight={expanded} columnsCollapsed={preferences.columnsCollapsed} onColumnsCollapsedChange={preferences.setColumnsCollapsed} />;
    }
    if (daily.groupByManager) {
      return <div data-testid="manager-groups">{daily.managerGroups.map(([manager, employees]) => <ManagerGroup key={manager} manager={manager} employees={employees} date={daily.selectedDate} onSelect={daily.setSelectedEmployee} readOnly={!canWrite} onSave={canWrite ? daily.saveAttendance : undefined} isSaving={daily.isSaving} />)}</div>;
    }
    return <TodayTable employees={daily.filteredEmployees} date={daily.selectedDate} onSelect={daily.setSelectedEmployee} readOnly={!canWrite} onSave={canWrite ? daily.saveAttendance : undefined} isSaving={daily.isSaving} />;
  }

  return <TooltipProvider delayDuration={250}>
    <main className="min-h-screen bg-[#f5f7fa] text-slate-900">
      <AppSidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} role={profile.papel_usuario} activeLabel="Chamada Diária" />
      <section className="lg:pl-18">
        <AppHeader onMobileOpen={() => setMobileOpen(true)} profile={profile} />
        <div className="mx-auto max-w-[1720px] space-y-4 p-3 sm:p-4 md:p-5">
          <header className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
            <div><p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Operação de pessoas</p><h1 className="text-2xl font-bold tracking-tight md:text-[28px]">Chamada Diária</h1><p className="mt-1 text-sm text-slate-500">Controle diário de presença, compensações e banco de horas.</p></div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600"><CalendarRange size={14} /><span className="sr-only">Data da chamada</span><input aria-label="Data da chamada" type="date" value={daily.selectedDate} onChange={(event) => daily.changeDate(event.target.value)} className="bg-transparent outline-none" /></label>
              <span role="status" aria-live="polite" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-500"><CheckCircle2 size={14} />{daily.loading ? "Atualizando dados…" : daily.error ? "Falha na sincronização" : "Dados carregados"}{daily.lastSuccessfulAt ? ` · Última consulta: ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }).format(new Date(daily.lastSuccessfulAt))}` : ""}</span>
              <button onClick={exportVisibleCall} disabled={daily.loading || daily.error || !daily.filteredEmployees.length} title="Exportar colaboradores filtrados e o período da visualização" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-40"><Download size={14} />Exportar CSV</button>
              <button onClick={daily.refresh} disabled={daily.loading} className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-70"><RefreshCw size={14} className={daily.loading ? "animate-spin" : ""} />Atualizar</button>
            </div>
          </header>
          <DailyCallFilters payrollPeriods={daily.payrollPeriods} filters={daily.filters} managerOptions={daily.managerOptions} unitOptions={unitOptions} hideManagerFilter={isManager && !profile.visualizar_todos_gestores} activeCount={daily.activeFilterCount} updateFilter={daily.updateFilter} clearFilters={daily.clearFilters} onPeriodChange={daily.changePayrollPeriod} />
          <DailyCallMetrics metrics={daily.metrics} />
          {canWrite ? <DailyCallBatch employees={daily.filteredEmployees.filter(employee => employee.canWrite !== false)} date={daily.selectedDate} onChanged={daily.refresh} disabled={daily.loading || daily.error} /> : null}
          <DailyCallPending start={daily.filters.startDate} end={daily.filters.endDate} canWrite={canWrite} writableManagerId={isManager ? profile.gestor_id : undefined} onChanged={daily.refresh} refreshToken={daily.mutationVersion} />
          <section ref={region} aria-label="Lista da chamada" data-fullscreen={expanded} className={cn("overflow-hidden border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/4%)]", expanded ? "fixed inset-0 z-[45] flex h-dvh flex-col" : "rounded-xl")}>
            <div className="flex shrink-0 flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between"><div className="flex flex-wrap items-center gap-3"><ViewModeSelector value={preferences.viewMode} onChange={preferences.setViewMode} /><span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Users size={14} aria-hidden="true" />{daily.filteredEmployees.length} de {daily.employees.length} colaboradores</span>{preferences.saving ? <span role="status" className="text-xs text-slate-500">Salvando visualização…</span> : null}</div><div className="flex flex-wrap items-center justify-end gap-3"><label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-slate-600"><Checkbox checked={daily.groupByManager} onCheckedChange={(checked) => daily.setGroupByManager(Boolean(checked))} />Agrupar por gestor</label><button type="button" aria-pressed={expanded} onClick={toggle} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600">{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}{expanded ? "Sair da tela cheia" : "Tela cheia"}</button></div></div>
            <div className={cn("shrink-0", expanded && "max-h-[45dvh] overflow-y-auto")}><DailyCallShortcuts viewMode={preferences.viewMode} selectedDate={daily.selectedDate} filters={daily.filters} payrollPeriods={daily.payrollPeriods} employees={daily.employees} managerOptions={daily.managerOptions} hideManagerFilter={isManager && !profile.visualizar_todos_gestores} changeDate={daily.changeDate} changePayrollPeriod={daily.changePayrollPeriod} updateFilter={daily.updateFilter} /></div>
            {preferences.error ? <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{preferences.error}<button type="button" onClick={preferences.retry} className="min-h-9 rounded border border-amber-300 px-2 font-semibold focus-visible:outline-2 focus-visible:outline-amber-700">Tentar novamente</button></div> : null}
            {expanded ? <p className="shrink-0 border-b px-3 py-1 text-xs text-slate-500">Chamada Diária · {period.label} · {period.startDate.split("-").reverse().join("/")} a {period.endDate.split("-").reverse().join("/")} · Esc para sair</p> : null}
            <div className={cn(expanded && "min-h-0 flex-1", expanded && (preferences.viewMode === "period" ? "overflow-hidden" : "overflow-auto"))}>{renderContent()}</div>
            <AttendanceLegend />
          </section>
          <footer className="flex flex-col justify-between gap-2 pb-3 text-xs text-slate-400 sm:flex-row"><span>{canWrite ? "Lançamentos atribuídos ao usuário autenticado e salvos no Supabase." : "Consulta em modo somente leitura."}</span><span className="inline-flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-500" />Acesso {profile.papel_usuario}</span></footer>
        </div>
      </section>
      <EmployeeDrawer employee={daily.selectedEmployee} date={daily.selectedDate} canManageAttachments={canWrite} onClose={() => daily.setSelectedEmployee(null)} />
      <Toaster position="bottom-right" richColors closeButton />
    </main>
  </TooltipProvider>;
}
