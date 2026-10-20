import type { Issue, LocationInterval } from "@/lib/monitoring/domain/types";
import { instant } from "./shared";

const areas = ["operation", "cafeteria"] as const;
const areaLabels = { operation: "Operação", cafeteria: "Refeitório" };
const stateLabels = { inside: "Dentro", outside: "Fora", unknown: "Desconhecido" };

/** Compact only the presentation. The calculation keeps every evidence boundary. */
export function compactLocationTimeline(intervals: readonly LocationInterval[]) {
  return areas.flatMap(area => {
    const compact: LocationInterval[] = [];
    for (const interval of intervals.filter(item => item.area === area).sort((a, b) => a.start - b.start)) {
      const previous = compact.at(-1);
      if (previous && previous.state === interval.state && previous.end === interval.start) {
        previous.end = interval.end;
        previous.evidenceEventIds = [...new Set([...previous.evidenceEventIds, ...interval.evidenceEventIds])];
      } else compact.push({ ...interval, evidenceEventIds: [...interval.evidenceEventIds] });
    }
    return compact;
  });
}

export function LocationTimeline({ intervals, issues }: { intervals: LocationInterval[]; issues: Issue[] }) {
  const compact = compactLocationTimeline(intervals);
  return <section>
    <h3 className="mb-2 font-semibold">Linha do tempo por área</h3>
    <p className="mb-3 text-xs text-slate-600">Trechos consecutivos no mesmo estado aparecem juntos. Desconhecido significa falta de evidência suficiente; não representa tempo fora da área.</p>
    <p className="mb-3 text-xs text-slate-600">A linha do tempo inclui trechos antes e depois da jornada. Um trecho desconhecido fora dos períodos trabalhados não reduz a cobertura do trabalho.</p>
    <div className="space-y-3">{areas.map(area => {
      const periods = compact.filter(period => period.area === area);
      if (!periods.length) return null;
      const incompleteMapping = issues.some(issue => issue.code === "INCOMPLETE_AREA_MAPPING" && issue.detail?.split(":").at(-1)?.trim() === area);
      const missingCoverage = issues.some(issue => issue.code === "AREA_COVERAGE_MISSING" && issue.detail === area);
      const unknown = periods.some(period => period.state === "unknown");
      return <section key={area} aria-label={`Linha do tempo: ${areaLabels[area]}`} className="rounded-lg border border-slate-200 p-3">
        <h4 className="mb-2 text-sm font-semibold">{areaLabels[area]}</h4>
        {incompleteMapping ? <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-900">Falta validar o conjunto de leitores de entrada e saída desta área. Confira o mapeamento e a vigência dos leitores na Configuração.</p>
          : missingCoverage ? <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-900">Coleta completa desta área não confirmada neste período. Confira os arquivos e a cobertura na Configuração.</p>
          : unknown ? <p className="mb-2 text-xs text-slate-600">Há trechos sem estado confirmado. Confira a cobertura, passagens sem par e o primeiro acesso anterior ao trecho nas pendências abaixo.</p> : null}
        <ol className="space-y-1 text-xs">{periods.map((period, index) => <li key={index} className="grid gap-1 border-l-4 border-slate-300 bg-slate-50 p-2 sm:grid-cols-[150px_1fr]">
          <b>{areaLabels[area]} · {stateLabels[period.state]}</b>
          <span>{instant(period.start)} até {instant(period.end)}</span>
        </li>)}</ol>
      </section>;
    })}</div>
  </section>;
}
