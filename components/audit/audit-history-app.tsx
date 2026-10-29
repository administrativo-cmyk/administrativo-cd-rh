"use client";
import Link from "@/components/navigation-link";
import { useEffect, useState, type FormEvent } from "react";
import { Download, RefreshCw, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { auditDifferences, auditDomains, auditQuerySchema, type AuditQuery, type AuditRecord, type AuditSnapshot } from "@/lib/audit/contracts";
import { downloadCsv, toCsv } from "@/lib/csv";

const control = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-blue-600";
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-40";
const display = (value: unknown) => value === undefined || value === null ? "—" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
const dateTime = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
const actionLabels: Record<string, string> = { save: "Salvar", create: "Criar", update: "Editar", archive: "Arquivar", restore: "Restaurar", cancel: "Cancelar", INSERT: "Registrar", UPDATE: "Atualizar", CLEAR: "Limpar", manager_link: "Vincular gestor", upload: "Anexar", download: "Baixar" };

export function AuditHistoryApp({ initialQuery, isAdmin }: { initialQuery: AuditQuery; isAdmin: boolean }) {
 const [draft, setDraft] = useState(initialQuery); const [query, setQuery] = useState(initialQuery);
 const [snapshot, setSnapshot] = useState<AuditSnapshot | null>(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
 const [selected, setSelected] = useState<AuditRecord | null>(null);
 useEffect(() => {
  const abort = new AbortController();
  Promise.resolve().then(async () => {
   setLoading(true); setError("");
   try {
    const response = await fetch("/api/audit", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query), signal: abort.signal });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Falha na consulta.");
    if (!abort.signal.aborted) setSnapshot(result);
   } catch (cause) { if (!abort.signal.aborted) { setSnapshot(null); setError(cause instanceof Error ? cause.message : "Falha na consulta."); } }
   finally { if (!abort.signal.aborted) setLoading(false); }
  });
  return () => abort.abort();
 }, [query]);
 function search(event: FormEvent) { event.preventDefault(); const result = auditQuerySchema.safeParse({ ...draft, offset: 0, snapshot: undefined }); if (!result.success) { setError("Revise os filtros. Selecione um período válido de até 366 dias."); return; } setQuery(result.data); }
 function exportPage() { if (!snapshot || loading) return; downloadCsv(toCsv([["Data", "Área", "Entidade", "Registro", "Colaborador", "Matrícula", "Ação", "Responsável", "Justificativa"], ...snapshot.rows.map(row => [dateTime(row.createdAt), auditDomains[row.domain], row.entity, row.recordId, row.employeeName, row.employeeNumber, row.action, row.actorName || "Sistema", row.reason])]), "historico-pagina.csv"); }
 const differences = selected ? auditDifferences(selected.before, selected.after) : [];
 return <main className="space-y-5 p-4 md:p-6">
  <div><Link href="/administracao" className="text-sm text-blue-700 underline">Cadastros</Link><h1 className="mt-2 text-2xl font-bold text-slate-900">Histórico de alterações</h1><p className="mt-1 text-sm text-slate-600">Consulte responsáveis, justificativas e valores registrados. Identificadores sensíveis ficam protegidos.</p>{!isAdmin && <p className="mt-1 text-xs text-slate-600">Histórico de usuários, preferências e avisos disponível somente para ADMIN.</p>}</div>
  <form onSubmit={search} className="rounded-xl border border-slate-200 bg-white p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
   <label className="text-sm">De<input className={control} type="date" required value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label>
   <label className="text-sm">Até<input className={control} type="date" required value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} /></label>
   <label className="text-sm">Área<select className={control} value={draft.domain} onChange={e => setDraft({ ...draft, domain: e.target.value as AuditQuery["domain"] })}>{Object.entries(auditDomains).filter(([key]) => isAdmin || !["usuarios", "workspace"].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
   <label className="text-sm">Pessoa ou registro<input className={control} maxLength={120} placeholder="Nome, matrícula ou identificador" value={draft.query} onChange={e => setDraft({ ...draft, query: e.target.value })} /></label>
   <label className="text-sm">Ação exata<input className={control} maxLength={100} placeholder="Ex.: save, archive, restore" value={draft.action} onChange={e => setDraft({ ...draft, action: e.target.value })} /></label>
   <label className="text-sm sm:col-span-2">Responsável — ID do usuário<input className={control} placeholder="Opcional. Também é possível buscar pelo nome acima." value={draft.actor} onChange={e => setDraft({ ...draft, actor: e.target.value })} /></label>
  </div><div className="mt-4 flex flex-wrap gap-2"><button className={button} disabled={loading}><Search size={16} aria-hidden />Consultar</button><button type="button" className={button} disabled={loading} onClick={() => setQuery({ ...query, offset: 0, snapshot: undefined })}><RefreshCw size={16} aria-hidden />Atualizar</button><button type="button" className={button} disabled={loading || !snapshot?.rows.length} onClick={exportPage}><Download size={16} aria-hidden />Exportar esta página</button></div></form>
  {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  <section aria-label="Registros de alteração" aria-busy={loading} className="rounded-xl border border-slate-200 bg-white">
   <div className="border-b p-4 text-sm" role="status">{loading ? "Consultando histórico…" : snapshot ? `${snapshot.total} registros encontrados` : "Consulta não concluída"}</div>
   {!loading && snapshot?.rows.length === 0 && <p className="p-6 text-sm text-slate-500">Nenhuma alteração no período e filtros selecionados.</p>}
   <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="bg-slate-50"><tr>{["Data", "Área / registro", "Colaborador", "Ação", "Responsável", "Detalhes"].map(label => <th key={label} scope="col" className="p-3 font-semibold">{label}</th>)}</tr></thead><tbody>{snapshot?.rows.map(row => <tr key={row.id} className="border-t"><td className="whitespace-nowrap p-3">{dateTime(row.createdAt)}</td><td className="max-w-64 break-all p-3"><strong className="block font-medium">{auditDomains[row.domain]}</strong><span className="text-xs text-slate-500">{row.entity} · {row.recordId}</span></td><td className="p-3">{row.employeeName || "—"}{row.employeeNumber && <span className="block text-xs text-slate-500">{row.employeeNumber}</span>}</td><td className="p-3">{actionLabels[row.action] || row.action}</td><td className="p-3">{row.actorName || "Sistema"}</td><td className="p-3"><button type="button" className={button} disabled={loading} onClick={() => setSelected(row)} aria-label={`Ver alteração ${row.id}`}>Ver alteração</button></td></tr>)}</tbody></table></div>
   {snapshot && <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-sm"><span>Página {Math.floor(snapshot.offset / snapshot.limit) + 1} de {Math.max(1, Math.ceil(snapshot.total / snapshot.limit))}</span><div className="flex gap-2"><button className={button} disabled={loading || !snapshot.offset} onClick={() => setQuery({ ...query, offset: Math.max(0, snapshot.offset - snapshot.limit), snapshot: snapshot.snapshot })}>Anterior</button><button className={button} disabled={loading || snapshot.offset + snapshot.limit >= snapshot.total} onClick={() => setQuery({ ...query, offset: snapshot.offset + snapshot.limit, snapshot: snapshot.snapshot })}>Próxima</button></div></div>}
  </section>
  <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>Detalhes da alteração</DialogTitle><DialogDescription>{selected ? `${dateTime(selected.createdAt)} · ${selected.actorName || "Sistema"} · ${selected.action}` : ""}</DialogDescription></DialogHeader>{selected && <><p className="break-words text-sm"><strong>Justificativa: </strong>{selected.reason || "Não registrada na origem."}</p><p className="text-xs text-slate-500">Campos técnicos preservam o nome original. Eventos antigos podem conter apenas os dados disponíveis na origem.</p><div className="overflow-x-auto"><table className="w-full table-fixed text-left text-sm"><thead><tr><th scope="col" className="w-1/4 p-2">Campo</th><th scope="col" className="p-2">Antes</th><th scope="col" className="p-2">Depois / detalhe</th></tr></thead><tbody>{differences.map(change => <tr className="border-t" key={change.field}><th scope="row" className="break-words p-2 align-top font-medium">{change.field}</th><td className="whitespace-pre-wrap break-words p-2 align-top">{display(change.before)}</td><td className="whitespace-pre-wrap break-words bg-blue-50/50 p-2 align-top">{display(change.after)}</td></tr>)}</tbody></table></div>{!differences.length && <p className="text-sm text-slate-500">Sem diferença de campos disponível neste evento.</p>}</>}</DialogContent></Dialog>
 </main>;
}
