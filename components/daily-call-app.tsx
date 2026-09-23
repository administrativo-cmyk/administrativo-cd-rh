"use client";

import { useCallback, useState } from "react";
import { CalendarRange, CheckCircle2, Clock3, Download, RefreshCw, SlidersHorizontal, Users } from "lucide-react";
import { toast } from "sonner";
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
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDailyCall } from "@/hooks/use-daily-call";
import type { AttendanceCode, DemoState } from "@/lib/daily-call-types";
import { cn } from "@/lib/utils";

export function DailyCallApp() {
  const daily = useDailyCall();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const setDailyAttendance = daily.setAttendance;

  const handleAttendance = useCallback((employeeId: string, date: string, code: AttendanceCode) => {
    setDailyAttendance(employeeId, date, code);
    toast.success(`Status atualizado para ${code}`, { description: "Alteração local aplicada imediatamente." });
  }, [setDailyAttendance]);

  function simulateUpdate() {
    setUpdating(true);
    window.setTimeout(() => {
      setUpdating(false);
      toast.success("Chamada atualizada com sucesso", { description: "Dados demonstrativos sincronizados às 09:15." });
    }, 500);
  }

  function renderContent() {
    if (daily.demoState === "loading") return <LoadingSkeleton />;
    if (daily.demoState === "error") return <ErrorState onRetry={() => daily.setDemoState("ready")} />;
    if (daily.demoState === "empty") return <EmptyState />;
    if (!daily.filteredEmployees.length) return <EmptyState filtered />;
    if (daily.viewMode === "period") {
      return <PeriodGrid employees={daily.filteredEmployees} startDate={daily.filters.startDate} endDate={daily.filters.endDate} onSelect={daily.setSelectedEmployee} onAttendance={handleAttendance} />;
    }
    if (daily.groupByManager) {
      return <div data-testid="manager-groups">{daily.managerGroups.map(([manager, employees]) => <ManagerGroup key={manager} manager={manager} employees={employees} onSelect={daily.setSelectedEmployee} onAttendance={handleAttendance} onObservation={daily.setObservation} />)}</div>;
    }
    return <TodayTable employees={daily.filteredEmployees} onSelect={daily.setSelectedEmployee} onAttendance={handleAttendance} onObservation={daily.setObservation} />;
  }

  return <TooltipProvider delayDuration={250}>
    <main className="min-h-screen bg-[#f5f7fa] text-slate-900">
      <AppSidebar collapsed={collapsed} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <section className={cn("transition-[padding] duration-200", collapsed ? "lg:pl-18" : "lg:pl-[232px]")}>
        <AppHeader collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} onMobileOpen={() => setMobileOpen(true)} />
        <div className="mx-auto max-w-[1720px] space-y-4 p-3 sm:p-4 md:p-5">
          <header className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Operação de pessoas</p>
              <h1 className="text-2xl font-bold tracking-tight md:text-[28px]">Chamada Diária</h1>
              <p className="mt-1 text-sm text-slate-500">Controle diário de presença, compensações e banco de horas.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600"><CalendarRange size={14} />01 a 30 set. 2026</span>
              <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-500"><Clock3 size={14} />Hoje, 08:42</span>
              <button onClick={() => toast.info("Exportação demonstrativa", { description: "A geração de arquivos será conectada em uma etapa futura." })} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold transition hover:border-slate-300 hover:bg-slate-50"><Download size={14} />Exportar</button>
              <button onClick={simulateUpdate} disabled={updating} className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-70"><RefreshCw size={14} className={updating ? "animate-spin" : ""} />{updating ? "Atualizando..." : "Atualizar"}</button>
            </div>
          </header>

          <DailyCallFilters filters={daily.filters} activeCount={daily.activeFilterCount} updateFilter={daily.updateFilter} clearFilters={daily.clearFilters} />
          <DailyCallMetrics metrics={daily.metrics} />

          <section aria-label="Lista da chamada" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/4%)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-3"><ViewModeSelector value={daily.viewMode} onChange={daily.setViewMode} /><span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Users size={14} />{daily.filteredEmployees.length} de {daily.employees.length} colaboradores</span></div>
              <div className="flex flex-wrap items-center gap-3">
                <label className={cn("flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-600", daily.viewMode === "period" && "pointer-events-none opacity-45")}><Checkbox checked={daily.groupByManager} onCheckedChange={(checked) => daily.setGroupByManager(Boolean(checked))} disabled={daily.viewMode === "period"} />Agrupar por gestor</label>
                <span aria-hidden className="hidden h-5 w-px bg-slate-200 sm:block" />
                <label className="flex items-center gap-2 text-xs text-slate-500"><SlidersHorizontal size={14} /><span className="sr-only">Prévia de estados</span><select aria-label="Simular estado da interface" className="rounded-lg border border-slate-200 bg-white px-2 py-1.5" value={daily.demoState} onChange={(event) => daily.setDemoState(event.target.value as DemoState)}><option value="ready">Estado normal</option><option value="loading">Carregando</option><option value="empty">Tabela vazia</option><option value="error">Erro</option></select></label>
              </div>
            </div>
            {renderContent()}
            <AttendanceLegend />
          </section>
          <footer className="flex flex-col justify-between gap-2 pb-3 text-xs text-slate-400 sm:flex-row"><span>{"Dados fict\u00edcios para demonstra\u00e7\u00e3o \u00b7 Nenhuma informa\u00e7\u00e3o \u00e9 persistida"}</span><span className="inline-flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-500" />Ambiente local</span></footer>
        </div>
      </section>
      <EmployeeDrawer employee={daily.selectedEmployee} onClose={() => daily.setSelectedEmployee(null)} onAttendance={handleAttendance} />
      <Toaster richColors position="top-right" />
    </main>
  </TooltipProvider>;
}
