"use client";

import { useId } from "react";
import { buttonClass, Field, inputClass } from "./shared";
import { useGroupCatalog } from "./use-group-catalog";

export function GroupSelect({ value, onChange, locked = false }: { value: string; onChange: (value: string) => void; locked?: boolean }) {
  const { catalog, error, retry } = useGroupCatalog();
  const hintId = useId();
  const groups = [...new Set(catalog?.groups ?? [])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const missingSelection = value && !groups.includes(value);
  return <div className="space-y-2">
    <Field label="Grupo"><select required disabled={locked || !catalog?.groups.length} className={inputClass} value={value} onChange={event => onChange(event.target.value)} aria-describedby={hintId}>
      <option value="">{catalog ? groups.length ? "Selecione o grupo" : "Nenhum grupo encontrado" : error ? "Grupos indisponíveis" : "Carregando grupos…"}</option>
      {missingSelection ? <option value={value}>{value}</option> : null}
      {groups.map(group => <option key={group} value={group}>{group}</option>)}
    </select></Field>
    <p id={hintId} className="text-xs text-slate-600">Grupos dos arquivos Defense concluídos e do histórico. Novos grupos aparecem automaticamente; a lista é atualizada a cada 30 segundos enquanto esta tela está visível.</p>
    {error ? <div className="space-y-2"><p role="alert" className="text-xs text-rose-900">{error} {catalog ? "A lista anterior foi mantida." : "Tente carregar a lista novamente."}</p><button type="button" className={buttonClass} onClick={retry}>Tentar carregar grupos</button></div> : null}
  </div>;
}
