"use client";

import { useEffect, useId, useState } from "react";
import { groupCatalogSchema, type GroupCatalog } from "@/lib/monitoring/group-catalog";
import { buttonClass, Field, inputClass, requestJson } from "./shared";

export function GroupSelect({ value, onChange, locked = false }: { value: string; onChange: (value: string) => void; locked?: boolean }) {
  const [catalog, setCatalog] = useState<GroupCatalog | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const hintId = useId();
  useEffect(() => {
    let disposed = false;
    let pending: AbortController | null = null;
    const refresh = async () => {
      if (pending || document.visibilityState !== "visible") return;
      const controller = new AbortController();
      pending = controller;
      try {
        const result = groupCatalogSchema.parse(await requestJson("/api/monitoring/groups", { signal: controller.signal }));
        if (!disposed) { setCatalog(result); setError(""); }
      } catch (cause) {
        if (!disposed && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível carregar os grupos.");
      } finally { if (pending === controller) pending = null; }
    };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 30000);
    const onVisible = () => { void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      disposed = true; pending?.abort(); window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible);
    };
  }, [revision]);
  const groups = [...new Set(catalog?.groups ?? [])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const missingSelection = value && !groups.includes(value);
  return <div className="space-y-2">
    <Field label="Grupo"><select required disabled={locked || !catalog?.groups.length} className={inputClass} value={value} onChange={event => onChange(event.target.value)} aria-describedby={hintId}>
      <option value="">{catalog ? groups.length ? "Selecione o grupo" : "Nenhum grupo encontrado" : error ? "Grupos indisponíveis" : "Carregando grupos…"}</option>
      {missingSelection ? <option value={value}>{value}</option> : null}
      {groups.map(group => <option key={group} value={group}>{group}</option>)}
    </select></Field>
    <p id={hintId} className="text-xs text-slate-600">Grupos dos arquivos Defense concluídos e do histórico. Novos grupos aparecem automaticamente; a lista é atualizada a cada 30 segundos enquanto esta tela está visível.</p>
    {error ? <div className="space-y-2"><p role="alert" className="text-xs text-rose-900">{error} {catalog ? "A lista anterior foi mantida." : "Tente carregar a lista novamente."}</p><button type="button" className={buttonClass} onClick={() => setRevision(previous => previous + 1)}>Tentar carregar grupos</button></div> : null}
  </div>;
}
