"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import type { DailyCallExcelInput } from "@/lib/daily-call-excel";

export function DailyCallExcelButton({ input, disabled }: { input: DailyCallExcelInput; disabled: boolean }) {
  const active = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function exportExcel() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setError(null);
    setProgress({ completed: 0, total: input.employees.length });
    try {
      const { downloadDailyCallExcel } = await import("@/lib/daily-call-excel");
      await downloadDailyCallExcel(input, {
        signal: controller.signal,
        onProgress: (completed, total) => { if (!controller.signal.aborted) setProgress({ completed, total }); },
      });
    } catch (cause) {
      if (!controller.signal.aborted) {
        controller.abort();
        setError(cause instanceof Error ? cause.message : "Não foi possível exportar o Excel. Tente novamente.");
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setProgress(null);
      }
    }
  }

  return <div className="flex max-w-full flex-wrap items-center gap-2">
    <button type="button" onClick={() => void exportExcel()} disabled={disabled || progress !== null} title="Exportar o período filtrado em Excel, com status e batidas em duas linhas por colaborador" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-40"><Download size={14} aria-hidden="true" />Exportar Excel</button>
    {progress ? <><span role="status" aria-live="polite" className="text-xs text-slate-600">{progress.completed === progress.total ? "Gerando Excel…" : `Carregando batidas: ${progress.completed} de ${progress.total}`}</span><button type="button" onClick={() => active.current?.abort()} className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-blue-600">Cancelar exportação</button></> : null}
    {error ? <p role="alert" className="max-w-sm text-xs text-rose-800">{error}</p> : null}
  </div>;
}
