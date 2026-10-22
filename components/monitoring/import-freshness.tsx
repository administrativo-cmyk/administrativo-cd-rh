import { dashboardInstant } from "@/components/dashboards/format";
import type { ImportFreshness } from "@/lib/monitoring/import-freshness";

function ImportTime({ value, empty }: { value: string | null; empty: string }) {
  return value ? <time dateTime={value}>{dashboardInstant(value)}</time> : <span className="font-normal text-slate-600">{empty}</span>;
}

export function ImportFreshnessSummary({ rows }: { rows: ImportFreshness[] | undefined }) {
  return <section aria-labelledby="import-freshness-title" className="mt-5">
    <h4 id="import-freshness-title" className="font-semibold text-slate-900">Última atualização dos dados</h4>
    <p className="mt-1 text-sm text-slate-600">Horário de Brasília. O último registro não garante cobertura completa. Reexporte desde o mesmo dia para completar dias parciais, sem duplicar batidas.</p>
    {rows === undefined ? <p className="mt-3 text-sm text-slate-600">Resumo ainda não disponível. Atualize os envios para consultar.</p>
      : rows.length ? <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map(source => <article key={source.sourceId} aria-labelledby={`freshness-${source.sourceId}`} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h5 id={`freshness-${source.sourceId}`} className="font-semibold text-slate-900">{source.name}</h5>
        <dl className="mt-3 space-y-3 text-sm">
          <div><dt className="text-slate-600">Última importação concluída</dt><dd className="mt-1 font-medium tabular-nums text-slate-950"><ImportTime value={source.lastImportAt} empty="Nenhuma importação concluída" /></dd></div>
          <div><dt className="text-slate-600">{source.kind === "afd" ? "Última batida importada" : "Último acesso facial importado"}</dt><dd className="mt-1 font-medium tabular-nums text-slate-950"><ImportTime value={source.lastRecordAt} empty="Sem registro com data disponível" /></dd></div>
        </dl>
      </article>)}</div> : <p className="mt-3 text-sm text-slate-600">Nenhuma fonte de ponto ou acesso facial ativa.</p>}
  </section>;
}
