import type { Metadata } from "next";
import Link from "@/components/navigation-link";
import { ArrowUpRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
import { analysisCatalog } from "@/lib/analytics/contracts";

export const metadata: Metadata = { title: "Análises | Administrativo CD" };
export default async function Page() {
  const profile = await requireApprovedProfile();
  return <AppShell profile={profile} title="Análises" activeLabel="Análises"><div className="mx-auto max-w-[1440px] space-y-6"><header className="max-w-3xl"><p className="text-xs font-bold uppercase tracking-widest text-blue-700">Gestão de pessoas</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Análises</h1><p className="mt-3 text-base leading-relaxed text-slate-600">Consulte saldos, compare a cobertura das equipes e acompanhe situações cadastrais. Cada análise informa sua fonte e base de cálculo.</p></header><nav aria-label="Escolher análise" className="grid gap-4 md:grid-cols-2">{[...analysisCatalog, { key: "metodologia", title: "Metodologia", description: "Fontes, códigos da Chamada, denominadores e limites de interpretação dos indicadores." }].map((entry) => <Link key={entry.key} href={`/analises/${entry.key}`} className="group flex min-h-48 flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-400 hover:bg-blue-50/40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 sm:p-6"><div className="flex items-start justify-between gap-3"><h2 className="text-xl font-semibold text-slate-950">{entry.title}</h2><ArrowUpRight aria-hidden="true" size={20} className="shrink-0 text-blue-700" /></div><p className="mt-3 text-sm leading-relaxed text-slate-600">{entry.description}</p><span className="mt-auto pt-5 text-sm font-semibold text-blue-700">Abrir análise</span></Link>)}</nav></div></AppShell>;
}
