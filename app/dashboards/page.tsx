import type { Metadata } from "next";
import Link from "@/components/navigation-link";
import { ArrowUpRight, CalendarCheck2, Clock3, ShieldCheck, Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { dashboardCatalog } from "@/components/dashboards/catalog";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";

export const metadata: Metadata = { title: "Dashboards | Administrativo CD" };

const icons = { monitoring: ShieldCheck, attendance: CalendarCheck2, balance: Clock3, workforce: Users };

export default async function DashboardsPage() {
  const profile = await requireApprovedProfile();
  return <AppShell profile={profile} title="Dashboards" activeLabel="Dashboards">
    <div className="mx-auto max-w-[1440px] space-y-6">
      <header className="max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-widest text-blue-700">Gestão de pessoas</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Dashboards</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-600">Escolha a área que deseja acompanhar. Cada painel apresenta seus indicadores, filtros e critérios de leitura.</p>
      </header>
      <nav aria-label="Escolher dashboard" className="grid gap-4 md:grid-cols-2">
        {dashboardCatalog.map((dashboard) => {
          const Icon = icons[dashboard.icon];
          return <Link key={dashboard.key} href={`/dashboards/${dashboard.key}`} className="group flex min-h-60 flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-blue-400 hover:bg-blue-50/40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 sm:p-6">
            <span className="flex items-center justify-between gap-3"><span className="grid h-12 w-12 place-items-center rounded-lg bg-blue-50 text-blue-700"><Icon aria-hidden="true" size={24} /></span><ArrowUpRight aria-hidden="true" size={20} className="text-slate-400 group-hover:text-blue-700" /></span>
            <h2 className="mt-5 text-xl font-semibold text-slate-950">{dashboard.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{dashboard.description}</p>
            <span className="mt-auto pt-5 text-sm font-semibold text-blue-700">Abrir dashboard<span className="sr-only"> de {dashboard.title}</span></span>
          </Link>;
        })}
      </nav>
    </div>
  </AppShell>;
}
