import type { MealCount } from "@/lib/monitoring/domain/types";
import { instant, Quality } from "./shared";

export function MealsDetail({ meals }: { meals?: MealCount }) {
 return <section aria-label="Refeições sem ponto de descanso" className="rounded-lg border border-slate-200 p-3">
  <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Refeições sem ponto de descanso</h3><Quality value={meals?.quality ?? "unavailable"}/></div>
  <p className="mt-2 text-lg font-semibold">{meals?.eligibility.state === "excluded" ? "Excluído por regra" : meals?.count == null ? "Não apurável" : `${meals.count} vez(es)`}</p>
  <p className="mt-2 text-xs text-slate-600">Conta visitas com entrada e saída do refeitório dentro do expediente, sem descanso registrado sobre a visita. Não altera o ponto nem o Banco de Horas. Três batidas ficam pendentes. Duas batidas em coleta completa permitem contagem parcial entre elas, sem confirmar a jornada inteira.</p>
  <p className="mt-2 text-xs text-slate-600">Visitas inteiramente na janela de café não entram. Sem essa janela, o acesso não distingue almoço, jantar ou café. Liderança e cozinha seguem a exclusão de refeitório.</p>
  {meals?.eligibility.reasons.length ? <p className="mt-2 text-xs text-amber-900">{meals.eligibility.reasons.join("; ")}</p> : null}
  {meals?.visits.length ? <ul className="mt-3 space-y-1 text-xs">{meals.visits.map(visit => <li key={visit.entryEventId}>{instant(visit.start)} até {instant(visit.end)}</li>)}</ul> : null}
 </section>;
}
