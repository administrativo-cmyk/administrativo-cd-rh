"use client";

import type { LucideIcon } from "lucide-react";
import { CalendarClock, CalendarDays, ChartNoAxesColumn, ChevronRight, CircleHelp, Clock3, LayoutDashboard, Settings, ShieldCheck, Users, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const sections: Array<{ label: string; items: Array<[string, LucideIcon]> }> = [
  { label: "Visão geral", items: [["Dashboard", LayoutDashboard], ["Banco de Horas", Clock3], ["Quadro Atual", Users], ["Chamada Diária", CalendarDays]] },
  { label: "Planejamento", items: [["Sugestão de Férias", CalendarClock], ["Férias por Gestor e Mês", CalendarDays]] },
  { label: "Análises", items: [["Top 20", ChartNoAxesColumn], ["Top por Gestor", ChartNoAxesColumn], ["Afastados e Outros", ShieldCheck], ["Metodologia", CircleHelp]] },
];

export function AppSidebar({ collapsed, mobileOpen, onMobileClose }: { collapsed: boolean; mobileOpen: boolean; onMobileClose: () => void }) {
  return <>
    {mobileOpen ? <button aria-label="Fechar menu" className="fixed inset-0 z-40 bg-slate-950/45 lg:hidden" onClick={onMobileClose} /> : null}
    <aside className={cn("fixed inset-y-0 left-0 z-50 flex flex-col bg-[#08162d] text-white shadow-2xl transition-all duration-200 lg:z-30 lg:shadow-none", collapsed ? "lg:w-18" : "lg:w-[232px]", mobileOpen ? "w-[272px] translate-x-0" : "w-[272px] -translate-x-full lg:translate-x-0")}>
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-500 text-sm font-bold shadow-lg shadow-blue-950/40">CD</span>
        <div className={cn("min-w-0", collapsed && "lg:hidden")}><p className="truncate text-[13px] font-bold tracking-wide">ADMINISTRATIVO CD</p><p className="text-[11px] text-slate-400">Gestão de pessoas</p></div>
        <button aria-label="Fechar menu" className="ml-auto rounded-lg p-2 text-slate-300 transition hover:bg-white/10 lg:hidden" onClick={onMobileClose}><X size={18} /></button>
      </div>
      <nav aria-label="Módulos administrativos" className="flex-1 overflow-y-auto p-2.5">
        {sections.map((section) => <div key={section.label} className="mb-3 last:mb-0">
          <p className={cn("px-2.5 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500", collapsed && "lg:sr-only")}>{section.label}</p>
          <div className="space-y-0.5">{section.items.map(([label, Icon]) => <SidebarItem key={label} label={label} icon={Icon} active={label === "Chamada Diária"} collapsed={collapsed} onClick={onMobileClose} />)}</div>
        </div>)}
      </nav>
      <div className="border-t border-white/10 p-2.5"><SidebarItem label="Configurações" icon={Settings} collapsed={collapsed} /></div>
    </aside>
  </>;
}

function SidebarItem({ label, icon: Icon, active = false, collapsed, onClick }: { label: string; icon: LucideIcon; active?: boolean; collapsed: boolean; onClick?: () => void }) {
  const button = <button aria-label={label} aria-current={active ? "page" : undefined} onClick={onClick} className={cn("group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition", active ? "bg-blue-500 text-white shadow-sm shadow-blue-950/30" : "text-slate-300 hover:bg-white/8 hover:text-white", collapsed && "lg:justify-center lg:px-2")}><Icon size={17} className="shrink-0" /><span className={cn("truncate", collapsed && "lg:hidden")}>{label}</span>{active ? <ChevronRight size={14} className={cn("ml-auto", collapsed && "lg:hidden")} /> : null}</button>;
  if (!collapsed) return button;
  return <Tooltip><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipContent side="right">{label}</TooltipContent></Tooltip>;
}
