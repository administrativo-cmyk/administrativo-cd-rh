"use client";
import { SourceManager } from "./source-manager";
import { BindingHistory } from "./binding-history";
import { ImportWizard } from "./import-wizard";

import { useEffect, useMemo, useState } from "react";
import { bindingSchema } from "@/lib/monitoring/contracts";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { identityReviewCandidates } from "@/lib/monitoring/identity-review";
import { refreshEmployeePhotos } from "@/lib/monitoring/photo-refresh";
import type { AdminSnapshot } from "./admin-types";
import { SettingsForm, settingLabels } from "./settings-form";
import { buttonClass, calendarDate, Field, inputClass, instant, primaryClass, requestJson } from "./shared";

const sourceLabels: Record<string, string> = { afd: "Ponto", "defense-access": "Acessos Defense", "defense-person": "Cadastros Defense" };
const fileLabels: Record<string, string> = { processing: "Em processamento", complete: "Concluído", conflict: "Conflito", failed: "Falhou" };
function settingDescription(setting: AdminSnapshot["settings"][number]) {
  const p = setting.payload;
  if (setting.kind === "schedule") return `${p.name} · ${p.start} a ${p.end}`;
  if (setting.kind === "mapping") return `${p.pointId} · ${p.direction === "entry" ? "Entrada" : "Saída"} · ${p.validated ? "Orientação validada" : "Orientação pendente"}`;
  if (setting.kind === "policy") return `${p.exclude ? "Exclusão" : "Inclusão"} de ${{ outsideOperation: "fora da operação", cafeteria: "refeitório", outsideCd: "fora do CD", lateness: "atraso" }[String(p.indicator)] ?? p.indicator}`;
  if (setting.kind === "coverage") return `${instant(String(p.start))} a ${instant(String(p.end))} · ${p.declaredComplete ? "Coleta completa declarada" : "Cobertura parcial"}`;
  if (setting.kind === "rule") return `Repetição: ponto ${p.punchRepeatSeconds}s, acesso ${p.accessRepeatSeconds}s · jornada até ${p.maxJourneyHours}h`;
  if (setting.kind === "group_snapshot") return Array.isArray(p.groups) ? p.groups.join(", ") || "Sem grupos" : "Grupos";
  if (setting.kind === "evidence") return `Entrada ${p.startConfirmed ? "confirmada" : "pendente"} · saída ${p.endConfirmed ? "confirmada" : "pendente"}`;
  if (setting.kind === "manual_event") return `${instant(String(p.at))} · ${p.pointId}`;
  return "Foto compartilhada com conta vinculada";
}

export function MonitoringAdmin({ section, today }: { section: "import" | "reconcile" | "settings"; today: string }) {
  const [data, setData] = useState<AdminSnapshot | null>(null);
  const [error, setError] = useState("");
  const [messageSection, setMessageSection] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [binding, setBinding] = useState({ sourceId: "", identityType: "defense", identityValue: "", employeeId: "", validFrom: today, validTo: "", evidence: "" });
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; action: "revoke_binding" | "revoke_setting" | "restore_setting"; expectedUpdatedAt?: string } | null>(null);
  const [editing, setEditing] = useState<AdminSnapshot["settings"][number] | null>(null);
  const [reason, setReason] = useState("");
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const abort = new AbortController();
    requestJson<AdminSnapshot>(`/api/monitoring/admin?offset=${offset}`, { signal: abort.signal })
      .then((result) => { if (!abort.signal.aborted) { setData(result); setError(""); } })
      .catch((cause) => { if (!abort.signal.aborted) { setMessageSection(null); setError(cause instanceof Error ? cause.message : "Falha ao carregar administração."); } })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [offset, refresh]);
  async function mutation(action: string, payload: unknown) {
    setError(""); setNotice(""); setMessageSection(section);
    try {
      await requestJson("/api/monitoring/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data: payload }) });
      setNotice("Alteração registrada. Jornadas afetadas entram na fila de recálculo do processo local."); setRefresh((value) => value + 1); refreshEmployeePhotos(); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar."); return false; }
  }
  async function bind() {
    const parsed = bindingSchema.safeParse({ ...binding, validTo: binding.validTo || null });
    if (!parsed.success) { setMessageSection(section); setError("Revise a identidade, colaborador, vigência e evidência. CPF/PIS exigem exatamente 11 dígitos."); return; }
    setBusy(true); try { await mutation("bind", parsed.data); } finally { setBusy(false); }
  }
  function selectIdentity(sourceId: string, identityType: string, identityValue: string) {
    setBinding((current) => current.sourceId === sourceId && current.identityType === identityType && current.identityValue === identityValue
      ? current
      : { ...current, sourceId, identityType, identityValue, employeeId: "", evidence: "" });
  }
  const employeeName = (id: string) => data?.employees.find((employee) => employee.id === id)?.name ?? id;
  const reviewedPerson = binding.identityType === "defense" ? data?.people?.find((person) => person.source_id === binding.sourceId && person.external_id === binding.identityValue) : undefined;
  const reviewedName = reviewedPerson?.name ?? data?.pending.find((pending) => pending.source_id === binding.sourceId && pending.identity_type === binding.identityType && pending.identity_value === binding.identityValue)?.name;
  const candidates = useMemo(() => identityReviewCandidates(reviewedName, data?.employees ?? []), [reviewedName, data?.employees]);
  const supersededIds = useMemo(() => new Set(data?.settings.map(setting => setting.supersedes_id).filter(Boolean)), [data?.settings]);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-slate-600">{section === "import" ? "Acompanhe o processo local e a integridade dos arquivos recebidos." : section === "reconcile" ? "Identidades sem vínculo permanecem importadas. Nome é evidência auxiliar; nunca vinculação automática." : "Configurações com vigência, justificativa e histórico."}</p><button className={buttonClass} disabled={loading} onClick={() => { setLoading(true); setRefresh((value) => value + 1); refreshEmployeePhotos(); }}>Atualizar administração</button></div>
    {loading ? <p role="status" className="text-sm text-slate-600">Carregando administração…</p> : null}{error && (!messageSection || messageSection === section) ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p> : null}{notice && (!messageSection || messageSection === section) ? <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{notice}</p> : null}
    {data && section === "import" ? <>
      <SourceManager sources={data.sources} onSaved={() => setRefresh(value => value + 1)} />
      <section aria-label="Fila de recálculo" className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold">Recálculo automático</h3><p className="mt-2 text-sm">{data.jobs?.pending ?? 0} pendente(s) · {data.jobs?.failed ?? 0} falha(s)</p><p className="mt-1 text-xs text-slate-600">O processo local retoma apurações após importações ou mudanças nas regras. O detalhe permite recalcular uma jornada imediatamente.</p></section>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Estado das fontes">{data.sources.length ? data.sources.map((source) => {
        const stale = !source.heartbeat_at || now - Date.parse(source.heartbeat_at) > 120000;
        return <article className="rounded-xl border border-slate-200 bg-white p-4" key={source.id}><h3 className="break-all font-semibold">{source.id}</h3><p className="text-xs text-slate-600">{sourceLabels[source.kind]} · {source.timezone}</p><b className={`mt-3 block text-sm ${stale || source.worker_state === "error" ? "text-amber-900" : "text-emerald-800"}`}>{source.active === false ? "Fonte desativada" : stale ? "Sem sinal recente do processo local" : source.worker_state === "scanning" ? "Lendo pastas" : source.worker_state === "error" ? "Falha no processo local" : "Aguardando arquivos"}</b><p className="mt-2 text-xs text-slate-600">Último sinal: {instant(source.heartbeat_at)}<br />Último sucesso: {instant(source.last_success_at)}</p>{source.last_error ? <p className="mt-2 text-xs text-rose-800">Código de falha: {source.last_error}</p> : null}</article>;
      }) : <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm">Nenhuma fonte registrada. Configure e execute o importador local conforme as instruções de instalação.</p>}</section>
      <p className="text-xs text-slate-600">Sinal ausente por mais de 120 segundos exige conferência do processo local. Isso não comprova falha de nenhum equipamento.</p>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><h3 className="border-b border-slate-200 p-4 font-semibold">Últimos 50 arquivos</h3><div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-left text-xs"><thead className="bg-slate-50"><tr>{["Arquivo / fonte", "Estado", "Lidas", "Aceitas", "Novos eventos", "Reapresentados", "Conflitos", "Rejeitadas", "Tentativas", "Última tentativa"].map((label) => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{data.files.map((file) => <tr key={file.id}><td className="max-w-64 break-all p-3">{file.relative_path}<span className="block text-slate-500">{file.source_id}</span></td><td className="p-3">{fileLabels[file.status] ?? file.status}</td>{[file.processed_rows, file.accepted_rows, file.new_events, file.repeated_events, file.conflict_rows, file.rejected_rows, file.attempts].map((value, index) => <td className="p-3" key={index}>{value ?? "—"}</td>)}<td className="whitespace-nowrap p-3">{instant(file.last_attempt_at)}</td></tr>)}</tbody></table></div>{!data.files.length ? <p className="p-5 text-sm text-slate-600">Nenhum arquivo processado.</p> : null}</section>
      <p className="text-xs leading-relaxed text-slate-600">Reapresentados são eventos já persistidos. Supressões analíticas por proximidade aparecem no detalhe da jornada e preservam a origem. Um arquivo parcial não é considerado concluído.</p>
      {data.attempts?.length ? <section className="rounded-xl border border-amber-200 bg-white p-4"><h3 className="font-semibold">Tentativas com falha de leitura</h3><ul className="mt-3 space-y-2 text-xs">{data.attempts.map((attempt) => <li key={attempt.id} className="break-all">{instant(attempt.created_at)} · {attempt.source_id} · {attempt.relative_path} · Código: {attempt.code}</li>)}</ul></section> : null}
    </> : null}
    {data && section === "reconcile" ? <>
      <ImportWizard kind="clock" today={today} sources={data.sources} onApplied={() => { setRefresh(value => value + 1); refreshEmployeePhotos(); }} />
      {data.people ? <section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold">Cadastros Defense e fotos</h3><p className="mb-3 mt-1 text-xs text-slate-600">Inclui pessoas sem eventos no período. Foto ou nome não comprovam vínculo com o RH.</p><ul className="grid gap-2 sm:grid-cols-2">{data.people.map((person) => <li key={`${person.source_id}|${person.external_id}`} className="rounded-lg border border-slate-200 p-3 text-sm"><div className="flex items-center gap-3"><EmployeeAvatar name={person.name} identity={person.has_photo ? { sourceId: person.source_id, value: person.external_id } : undefined} size={48} /><div className="min-w-0"><b>{person.name}</b><p className="break-all text-xs text-slate-600">{person.source_id} · {person.external_id}</p></div></div>{person.ambiguous ? <p className="mt-2 text-xs font-semibold text-amber-900">Cadastro divergente entre arquivos</p> : null}<p className="mt-2 text-xs">{person.has_photo ? "Foto disponível" : "Foto pendente"} · {person.linked ? "Vínculo cadastrado" : "Sem vínculo RH"}</p><p className="text-xs text-slate-600">{person.groups.join(", ") || "Sem grupos informados"}</p>{!person.linked ? <button className={`${buttonClass} mt-2`} onClick={() => selectIdentity(person.source_id, "defense", person.external_id)}>Conferir cadastro</button> : null}</li>)}</ul><p className="mt-3 text-xs text-slate-500">Página {offset / 100 + 1}; até 100 cadastros. Use a paginação abaixo para consultar os demais.</p></section> : null}
      <section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="mb-3 font-semibold">Identidades pendentes</h3><div className="grid gap-2 sm:grid-cols-2">{data.pending.map((pending) => <button key={`${pending.source_id}|${pending.identity_type}|${pending.identity_value}`} className="rounded-lg border border-slate-200 p-3 text-left text-sm hover:border-blue-400 focus-visible:outline-2 focus-visible:outline-blue-600" onClick={() => selectIdentity(pending.source_id, pending.identity_type, pending.identity_value)}><b className="block">{pending.name ?? "Nome não disponível"}</b><span className="text-xs text-slate-600">{pending.source_id} · {pending.identity_type.toUpperCase()} · {pending.identity_value}</span><span className="mt-1 block text-xs text-blue-800">Conferir vínculo</span></button>)}</div>{!data.pending.length ? <p className="text-sm text-slate-600">Nenhuma identidade pendente nesta página.</p> : null}<div className="mt-3 flex justify-between gap-2"><button className={buttonClass} disabled={loading || offset === 0} onClick={() => { setLoading(true); setOffset((value) => Math.max(0, value - 100)); }}>Anteriores</button><button className={buttonClass} disabled={loading || (data.pending.length < 100 && (data.people?.length ?? 0) < 100)} onClick={() => { setLoading(true); setOffset((value) => value + 100); }}>Próximas</button></div></section>
      <form onSubmit={(event) => { event.preventDefault(); void bind(); }} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-label="Vincular identidade"><h3 className="font-semibold">Vincular identidade conferida</h3>
        {binding.sourceId && binding.identityValue ? <section aria-label="Conferência da identidade" className="space-y-3 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">{binding.identityType === "defense" ? <EmployeeAvatar name={reviewedName ?? "Cadastro Defense"} identity={{ sourceId: binding.sourceId, value: binding.identityValue }} size={80} /> : null}<div><p className="font-medium">{reviewedName ?? "Nome não disponível na fonte"}</p><p className="text-xs text-slate-600">{binding.sourceId} · {binding.identityType.toUpperCase()} · {binding.identityValue}</p></div></div>
          <p className="text-xs text-slate-600">Confira documento, matrícula e vigência. Nome igual e foto são apenas apoio; não comprovam a relação entre identificadores.</p>
          {reviewedPerson?.ambiguous ? <p className="text-sm font-medium text-amber-900">Este cadastro tem versões divergentes. Confira a origem antes de vincular.</p> : null}
          {candidates.length ? <div><h4 className="text-sm font-semibold">{candidates.length > 1 ? "Homônimos no RH — confira a matrícula" : "Candidato com mesmo nome completo"}</h4><ul className="mt-2 space-y-2">{candidates.map((candidate) => <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3"><p className="text-sm">{candidate.name}<span className="block text-xs text-slate-600">Matrícula {candidate.employeeNumber}</span></p><button type="button" className={buttonClass} onClick={() => setBinding((current) => ({ ...current, employeeId: candidate.id, evidence: "" }))}>Escolher matrícula {candidate.employeeNumber} para conferir</button></li>)}</ul></div> : <p className="text-sm text-slate-600">Sem candidato por nome completo nesta base. Selecione o cadastro RH somente após conferir os identificadores.</p>}
        </section> : null}
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Fonte"><select required className={inputClass} value={binding.sourceId} onChange={(event) => selectIdentity(event.target.value, binding.identityType, binding.identityValue)}><option value="">Selecione</option>{data.sources.filter(source => source.active !== false).map((source) => <option key={source.id}>{source.id}</option>)}</select></Field><Field label="Tipo de identidade"><select className={inputClass} value={binding.identityType} onChange={(event) => selectIdentity(binding.sourceId, event.target.value, binding.identityValue)}>{["defense", "cpf", "pis"].map((type) => <option value={type} key={type}>{type === "employee_number" ? "Matrícula" : type.toUpperCase()}</option>)}</select></Field><Field label="Identificador completo"><input required className={inputClass} value={binding.identityValue} onChange={(event) => selectIdentity(binding.sourceId, binding.identityType, event.target.value)} /></Field><Field label="Colaborador RH"><select required className={inputClass} value={binding.employeeId} onChange={(event) => setBinding((old) => ({ ...old, employeeId: event.target.value, evidence: "" }))}><option value="">Selecione após conferir</option>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.employeeNumber}</option>)}</select></Field><Field label="Válido a partir de"><input required type="date" className={inputClass} value={binding.validFrom} onChange={(event) => setBinding((old) => ({ ...old, validFrom: event.target.value }))} /></Field><Field label="Válido até (opcional)"><input type="date" className={inputClass} value={binding.validTo} onChange={(event) => setBinding((old) => ({ ...old, validTo: event.target.value }))} /></Field></div><Field label="Evidência do vínculo"><textarea required minLength={5} maxLength={1000} className={inputClass} value={binding.evidence} onChange={(event) => setBinding((old) => ({ ...old, evidence: event.target.value }))} placeholder="Documento ou conferência que relaciona os identificadores" /></Field><button className={primaryClass} disabled={busy}>{busy ? "Salvando…" : "Salvar vínculo"}</button></form>
      <BindingHistory data={data} onSaved={() => { setRefresh(value => value + 1); refreshEmployeePhotos(); }} />
    </> : null}
    {data && section === "settings" ? <>
      <SettingsForm key={editing ? `${editing.id}:${editing.updated_at}` : "new"} initial={editing} cancel={() => setEditing(null)} employees={data.employees} users={data.users ?? []} today={today} save={async payload => {
        const saved = await mutation(editing ? "replace_setting" : "setting", editing ? { id: editing.id, expectedUpdatedAt: editing.updated_at, reason: (payload as { reason: string }).reason, setting: payload } : payload);
        if (saved) setEditing(null); return saved;
      }} />
      <section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="mb-3 font-semibold">Configurações e histórico</h3><ul className="divide-y divide-slate-100">{data.settings.map(setting => {
        const superseded = supersededIds.has(setting.id);
        return <li key={setting.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0 flex-1"><b className="text-sm">{settingLabels[setting.kind]} · {employeeName(setting.target)}</b><p className="break-words text-xs text-slate-700">{settingDescription(setting)}</p><p className="mt-1 text-xs text-slate-500">{calendarDate(setting.valid_from)} a {setting.valid_to ? calendarDate(setting.valid_to) : "sem fim definido"} · revisão {setting.revision ?? 1} · {superseded ? "Substituída" : setting.revoked_at ? "Removida" : "Ativa"}</p><p className="mt-1 text-xs">{setting.reason}</p></div>
          {!superseded ? <div className="flex flex-wrap gap-2">{!setting.revoked_at ? <><button className={buttonClass} disabled={!setting.updated_at} onClick={() => { setEditing(setting); setRemoving(null); }}>Editar configuração</button><button className={buttonClass} disabled={!setting.updated_at} onClick={() => { setRemoving({ id: setting.id, action: "revoke_setting", expectedUpdatedAt: setting.updated_at }); setReason(""); }}>Remover regra</button></> : <button className={buttonClass} disabled={!setting.updated_at} onClick={() => { setRemoving({ id: setting.id, action: "restore_setting", expectedUpdatedAt: setting.updated_at }); setReason(""); }}>Restaurar configuração</button>}</div> : null}
        </li>;
      })}</ul></section>
    </> : null}
    {removing ? <form className="sticky bottom-3 z-20 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-lg" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { if (await mutation(removing.action, { id: removing.id, ...(removing.expectedUpdatedAt ? { expectedUpdatedAt: removing.expectedUpdatedAt } : {}), reason })) setRemoving(null); } finally { setBusy(false); } }}><h3 className="font-semibold">{removing.action === "restore_setting" ? "Justificar restauração" : "Justificar remoção"}</h3><p className="text-xs">O histórico será preservado. Apurações afetadas serão marcadas para recálculo.</p><Field label="Justificativa da alteração"><input className={inputClass} required minLength={5} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></Field><div className="flex gap-2"><button className={primaryClass} disabled={busy}>{removing.action === "restore_setting" ? "Confirmar restauração" : "Confirmar remoção"}</button><button className={buttonClass} type="button" disabled={busy} onClick={() => setRemoving(null)}>Cancelar</button></div></form> : null}
    {data && section !== "import" ? <details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">Últimas alterações auditadas</summary><ul className="mt-3 space-y-2 text-xs">{data.audit.map((entry) => <li key={entry.id}>{instant(entry.created_at ?? entry.occurred_at)} · {({ bind: "Vínculo criado", setting: "Regra criada", revoke_binding: "Vínculo removido", revoke_setting: "Regra removida", reprocess: "Jornada recalculada" } as Record<string, string>)[entry.action] ?? entry.action} · {entry.detail?.reason ?? "Motivo registrado"}</li>)}</ul></details> : null}
  </div>;
}
