"use client";

import { useState } from "react";
import { CalendarRange, CheckCircle2, Download, RefreshCw, Users } from "lucide-react";
import { Toaster } from "sonner";
import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";
import { AttendanceLegend } from "./attendance-legend";
import { DailyCallFilters } from "./daily-call-filters";
import { DailyCallMetrics } from "./daily-call-metrics";
import { EmployeeDrawer } from "./employee-drawer";
import { EmptyState, ErrorState, LoadingSkeleton } from "./interface-states";
import { ManagerGroup } from "./manager-group";
import { PeriodGrid } from "./period-grid";
import { TodayTable } from "./today-table";
import { ViewModeSelector } from "./view-mode-selector";
import { Checkbox } from "@/components/ui/checkbox";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDailyCall } from "@/hooks/use-daily-call";
import type { DailyCallSnapshot } from "@/lib/daily-call-types";
import type { AuthenticatedProfile } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

type Props = { profile: AuthenticatedProfile; initialDate: string; initialSnapshot: DailyCallSnapshot | null };

export function DailyCallApp({ profile, initialDate, initialSnapshot }: Props) {
  const daily = useDailyCall(initialDate, initialSnapshot);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const canWrite = profile.papel_usuario === "ADMIN" || profile.papel_usuario === "RH" || profile.papel_usuario === "GESTOR";
  const isManager = profile.papel_usuario === "GESTOR";
  const unitOptions = isManager ? [...new Set(daily.employees.map((employee) => employee.unit))] : undefined;

  function renderContent() {
    if (daily.loading) return <LoadingSkeleton />;
    if (daily.error) return <ErrorState onRetry={daily.refresh} />;
    if (isManager && !profile.gestor_id && !daily.employees.length) return <div className="p-8 text-center text-sm text-slate-600">Seu usuário ainda não está vinculado a um gestor do quadro.</div>;
    if (!daily.employees.length) return <EmptyState />;
    if (!daily.filteredEmployees.length) return <EmptyState filtered />;
    if (daily.viewMode === "period") {
      return <PeriodGrid employees={daily.filteredEmployees} startDate={daily.filters.startDate} endDate={daily.filters.endDate} onSelect={daily.setSelectedEmployee} readOnly={!canWrite} onSave={canWrite ? daily.saveAttendance : undefined} isSaving={daily.isSaving} />;
    }
    if (daily.groupByManager) {
      return <div data-testid="manager-groups">{daily.managerGroups.map(([manager, employees]) => <ManagerGroup key={manager} manager={manager} employees={employees} date={daily.selectedDate} onSelect={daily.setSelectedEmployee} readOnly={!canWrite} onSave={canWrite ? daily.saveAttendance : undefined} isSaving={daily.isSaving} />)}</div>;
    }
    return <TodayTable employees={daily.filteredEmployees} date={daily.selectedDate} onSelect={daily.setSelectedEmployee} readOnly={!canWrite} onSave={canWrite ? daily.saveAttendance : undefined} isSaving={daily.isSaving} />;
  }

  return <TooltipProvider delayDuration={250}>
    <main className="min-h-screen bg-[#f5f7fa] text-slate-900">
      <AppSidebar collapsed={collapsed} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} role={profile.papel_usuario} activeLabel="Chamada Diária" />
      <section className={cn("transition-[padding] duration-200", collapsed ? "lg:pl-18" : "lg:pl-[232px]")}>
        <AppHeader collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} onMobileOpen={() => setMobileOpen(true)} profile={profile} />
        <div className="mx-auto max-w-[1720px] space-y-4 p-3 sm:p-4 md:p-5">
          <header className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
            <div><p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Operação de pessoas</p><h1 className="text-2xl font-bold tracking-tight md:text-[28px]">Chamada Diária</h1><p className="mt-1 text-sm text-slate-500">Controle diário de presença, compensações e banco de horas.</p></div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600"><CalendarRange size={14} /><span className="sr-only">Data da chamada</span><input aria-label="Data da chamada" type="date" value={daily.selectedDate} onChange={(event) => daily.changeDate(event.target.value)} className="bg-transparent outline-none" /></label>
              <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-500"><CheckCircle2 size={14} />Dados sincronizados</span>
              <button disabled title="Exportação não disponível nesta etapa" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-400"><Download size={14} />Exportar</button>
              <button onClick={daily.refresh} disabled={daily.loading} className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-70"><RefreshCw size={14} className={daily.loading ? "animate-spin" : ""} />Atualizar</button>
            </div>
          </header>
          <DailyCallFilters filters={daily.filters} managerOptions={daily.managerOptions} unitOptions={unitOptions} hideManagerFilter={isManager} activeCount={daily.activeFilterCount} updateFilter={daily.updateFilter} clearFilters={daily.clearFilters} />
          <DailyCallMetrics metrics={daily.metrics} />
          <section aria-label="Lista da chamada" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/4%)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-3 lg:flex-row lg:items-center lg:justify-between"><div className="flex flex-wrap items-center gap-3"><ViewModeSelector value={daily.viewMode} onChange={daily.setViewMode} /><span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Users size={14} />{daily.filteredEmployees.length} de {daily.employees.length} colaboradores</span></div><label className={cn("flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-600", daily.viewMode === "period" && "pointer-events-none opacity-45")}><Checkbox checked={daily.groupByManager} onCheckedChange={(checked) => daily.setGroupByManager(Boolean(checked))} disabled={daily.viewMode === "period"} />Agrupar por gestor</label></div>
            {renderContent()}
            <AttendanceLegend />
          </section>
          <footer className="flex flex-col justify-between gap-2 pb-3 text-xs text-slate-400 sm:flex-row"><span>{canWrite ? "Lançamentos atribuídos ao usuário autenticado e salvos no Supabase." : "Consulta em modo somente leitura."}</span><span className="inline-flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-500" />Acesso {profile.papel_usuario}</span></footer>
        </div>
      </section>
      <EmployeeDrawer employee={daily.selectedEmployee} date={daily.selectedDate} onClose={() => daily.setSelectedEmployee(null)} />
      <Toaster position="bottom-right" richColors closeButton />
    </main>
  </TooltipProvider>;
}
