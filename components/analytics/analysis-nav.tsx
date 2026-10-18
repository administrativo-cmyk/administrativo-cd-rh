import Link from "next/link";
import { analysisCatalog } from "@/lib/analytics/contracts";
import { dashboardButton } from "@/components/dashboards/format";

export function AnalysisNav({ selected }: { selected?: string }) {
  return <nav aria-label="Análises disponíveis" className="flex flex-wrap gap-2">{[...analysisCatalog, { key: "metodologia", title: "Metodologia" }].map((item) => <Link href={`/analises/${item.key}`} key={item.key} aria-current={selected === item.key ? "page" : undefined} className={`${dashboardButton} ${selected === item.key ? "border-blue-700 bg-blue-700 text-white hover:bg-blue-800" : ""}`}>{item.title}</Link>)}</nav>;
}
