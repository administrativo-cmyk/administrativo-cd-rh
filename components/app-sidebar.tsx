"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { CalendarClock, CalendarDays, ChartNoAxesColumn, ChevronRight, CircleHelp, Clock3, LayoutDashboard, Settings, ShieldCheck, Users, X } from "lucide-react";
import type { UserRole } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

type SidebarEntry = [label: string, icon: LucideIcon, href?: string];

const sections: Array<{ label: string; items: SidebarEntry[] }> = [
  { label: "Visão geral", items: [["Dashboards", LayoutDashboard, "/dashboards"], ["Monitoramento", ShieldCheck, "/monitoramento"], ["Banco de Horas", Clock3, "/banco-de-horas"], ["Quadro Atual", Users, "/quadro-atual"], ["Chamada Diária", CalendarDays, "/chamada-diaria"]] },
  { label: "Planejamento", items: [["Sugestão de Férias", CalendarClock, "/planejamento/ferias"], ["Férias por Gestor e Mês", CalendarDays, "/planejamento/calendario"]] },
  { label: "Análises", items: [["Top 20", ChartNoAxesColumn, "/analises/top-20-banco-horas"], ["Top por Gestor", ChartNoAxesColumn, "/analises/top-por-gestor"], ["Afastados e Outros", ShieldCheck, "/analises/afastados-e-outros"], ["Metodologia", CircleHelp, "/analises/metodologia"]] },
];

export function AppSidebar({
  mobileOpen,
  onMobileClose,
  role,
  activeLabel,
}: {
  mobileOpen: boolean;
  onMobileClose: () => void;
  role: UserRole | null;
  activeLabel: string;
}) {
  const showUsers = role === "ADMIN" || role === "RH";

  return <>
    {mobileOpen ? <button aria-label="Fechar menu" className="fixed inset-0 z-40 bg-slate-950/45 lg:hidden" onClick={onMobileClose} /> : null}
    <aside aria-label="Menu lateral automático" className={cn("app-sidebar fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col overflow-x-hidden text-white shadow-2xl lg:z-30 lg:shadow-none", mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0")}><div aria-hidden="true" className="app-sidebar-surface absolute inset-0 -z-10 bg-[#08162d]" />
      <div className="app-sidebar-content flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-500 text-sm font-bold shadow-lg shadow-blue-950/40">CD</span>
        <div className="sidebar-copy min-w-0"><p className="truncate text-[13px] font-bold tracking-wide">ADMINISTRATIVO CD</p><p className="text-[11px] text-slate-400">Gestão de pessoas</p></div>
        <button aria-label="Fechar menu" className="ml-auto rounded-lg p-2 text-slate-300 transition hover:bg-white/10 lg:hidden" onClick={onMobileClose}><X size={18} /></button>
      </div>
      <nav aria-label="Módulos administrativos" className="app-sidebar-content min-h-0 flex-1 overflow-y-auto p-2.5">
        {sections.map((section) => <div key={section.label} className="mb-3 last:mb-0">
          <p className="sidebar-copy px-2.5 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{section.label}</p>
          <div className="space-y-0.5">{section.items.map(([label, Icon, href]) => <SidebarItem key={label} label={label} icon={Icon} href={href} active={label === activeLabel} onClick={onMobileClose} />)}</div>
        </div>)}
        {showUsers ? <div className="mb-3">
          <p className="sidebar-copy px-2.5 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Administração</p>
          <SidebarItem label="Usuários" icon={Users} href="/usuarios" active={activeLabel === "Usuários"} onClick={onMobileClose} />
          <SidebarItem label="Cadastros" icon={Users} href="/administracao" active={activeLabel === "Cadastros"} onClick={onMobileClose} />
          <SidebarItem label="Escalas e calendário" icon={CalendarDays} href="/planejamento/escalas" active={activeLabel === "Escalas e calendário"} onClick={onMobileClose} />
          <SidebarItem label="Histórico de alterações" icon={Clock3} href="/administracao/auditoria" active={activeLabel === "Histórico de alterações"} onClick={onMobileClose} />
        </div> : null}
      </nav>
      <div className="app-sidebar-content shrink-0 border-t border-white/10 p-2.5"><SidebarItem label="Configurações" icon={Settings} href="/configuracoes" active={activeLabel === "Configurações"} onClick={onMobileClose} /></div>
    </aside>
  </>;
}

function SidebarItem({ label, icon: Icon, href, active = false, onClick }: { label: string; icon: LucideIcon; href?: string; active?: boolean; onClick?: () => void }) {
  const className = cn("group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-white", active ? "bg-blue-500 text-white shadow-sm shadow-blue-950/30" : "text-slate-300 hover:bg-white/8 hover:text-white");
  const content = <><Icon size={17} className="shrink-0" /><span className="sidebar-copy truncate">{label}</span>{active ? <ChevronRight size={14} className="sidebar-copy ml-auto" /> : null}</>;
  const item = href
    ? <Link aria-label={label} aria-current={active ? "page" : undefined} href={href} onClick={onClick} className={className}>{content}</Link>
    : <button aria-label={label} aria-current={active ? "page" : undefined} onClick={onClick} className={className}>{content}</button>;

  return item;
}
