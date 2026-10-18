"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { CalendarClock, CalendarDays, ChartNoAxesColumn, ChevronRight, CircleHelp, Clock3, LayoutDashboard, Settings, ShieldCheck, Users, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { UserRole } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

type SidebarEntry = [label: string, icon: LucideIcon, href?: string];

const sections: Array<{ label: string; items: SidebarEntry[] }> = [
  { label: "Visão geral", items: [["Dashboards", LayoutDashboard, "/dashboards"], ["Monitoramento", ShieldCheck, "/monitoramento"], ["Banco de Horas", Clock3, "/banco-de-horas"], ["Quadro Atual", Users, "/quadro-atual"], ["Chamada Diária", CalendarDays, "/chamada-diaria"]] },
  { label: "Planejamento", items: [["Sugestão de Férias", CalendarClock, "/planejamento/ferias"], ["Férias por Gestor e Mês", CalendarDays, "/planejamento/calendario"]] },
  { label: "Análises", items: [["Top 20", ChartNoAxesColumn, "/analises/top-20-banco-horas"], ["Top por Gestor", ChartNoAxesColumn, "/analises/top-por-gestor"], ["Afastados e Outros", ShieldCheck, "/analises/afastados-e-outros"], ["Metodologia", CircleHelp, "/analises/metodologia"]] },
];

export function AppSidebar({
  collapsed,
  mobileOpen,
  onMobileClose,
  role,
  activeLabel,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
  role: UserRole | null;
  activeLabel: string;
}) {
  const showUsers = role === "ADMIN" || role === "RH";

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
          <div className="space-y-0.5">{section.items.map(([label, Icon, href]) => <SidebarItem key={label} label={label} icon={Icon} href={href} active={label === activeLabel} collapsed={collapsed} onClick={onMobileClose} />)}</div>
        </div>)}
        {showUsers ? <div className="mb-3">
          <p className={cn("px-2.5 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500", collapsed && "lg:sr-only")}>Administração</p>
          <SidebarItem label="Usuários" icon={Users} href="/usuarios" active={activeLabel === "Usuários"} collapsed={collapsed} onClick={onMobileClose} />
          <SidebarItem label="Cadastros" icon={Users} href="/administracao" active={activeLabel === "Cadastros"} collapsed={collapsed} onClick={onMobileClose} />
          <SidebarItem label="Escalas e calendário" icon={CalendarDays} href="/planejamento/escalas" active={activeLabel === "Escalas e calendário"} collapsed={collapsed} onClick={onMobileClose} />
          <SidebarItem label="Histórico de alterações" icon={Clock3} href="/administracao/auditoria" active={activeLabel === "Histórico de alterações"} collapsed={collapsed} onClick={onMobileClose} />
        </div> : null}
      </nav>
      <div className="border-t border-white/10 p-2.5"><SidebarItem label="Configurações" icon={Settings} href="/configuracoes" active={activeLabel === "Configurações"} collapsed={collapsed} onClick={onMobileClose} /></div>
    </aside>
  </>;
}

function SidebarItem({ label, icon: Icon, href, active = false, collapsed, onClick }: { label: string; icon: LucideIcon; href?: string; active?: boolean; collapsed: boolean; onClick?: () => void }) {
  const className = cn("group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition", active ? "bg-blue-500 text-white shadow-sm shadow-blue-950/30" : "text-slate-300 hover:bg-white/8 hover:text-white", collapsed && "lg:justify-center lg:px-2");
  const content = <><Icon size={17} className="shrink-0" /><span className={cn("truncate", collapsed && "lg:hidden")}>{label}</span>{active ? <ChevronRight size={14} className={cn("ml-auto", collapsed && "lg:hidden")} /> : null}</>;
  const item = href
    ? <Link aria-label={label} aria-current={active ? "page" : undefined} href={href} onClick={onClick} className={className}>{content}</Link>
    : <button aria-label={label} aria-current={active ? "page" : undefined} onClick={onClick} className={className}>{content}</button>;

  if (!collapsed) return item;
  return <Tooltip><TooltipTrigger asChild>{item}</TooltipTrigger><TooltipContent side="right">{label}</TooltipContent></Tooltip>;
}
