"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Archive, Download, Pencil, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AuthenticatedProfile } from "@/lib/auth/types";
import { administrationListSchema, archiveInputSchema, saveSchemas, type AdministrationEntity, type AdministrationRows, type AdministrationSnapshot } from "@/lib/administration/contracts";
import { situationLabels, workforceSituations } from "@/lib/workforce";
import { downloadCsv, toCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { EmployeePunchHistory } from "@/components/monitoring/employee-punch-history";
import { EmployeeSchedule } from "@/components/employee-schedule";
import { EmployeeRegisterDetails } from "./employee-register-details";
import { isAwaySituation } from "@/lib/employee-lifecycle";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";

type Row = AdministrationRows[AdministrationEntity];
type Field = { key: string; label: string; type?: "date" | "number" | "textarea" | "unit" | "manager" | "employee" | "situation" | "vacationStatus" | "department" | "job" | "category"; required?: boolean };
const fields: Record<AdministrationEntity, Field[]> = {
  department: [{ key: "name", label: "Nome do setor", required: true }],
  job: [{ key: "name", label: "Nome do cargo / função", required: true }],
  category: [{ key: "name", label: "Nome da categoria", required: true }],
  unit: [{ key: "code", label: "Código da unidade", required: true }, { key: "name", label: "Nome", required: true }],
  manager: [{ key: "name", label: "Nome", required: true }, { key: "referenceUnitId", label: "Unidade de referência", type: "unit" }],
  employee: [{ key: "employeeNumber", label: "Matrícula", required: true }, { key: "name", label: "Nome completo", required: true }, { key: "unitId", label: "Unidade", type: "unit", required: true }, { key: "managerId", label: "Gestor", type: "manager" }, { key: "department", label: "Setor", type: "department" }, { key: "role", label: "Cargo / função", type: "job" }, { key: "situation", label: "Situação", type: "situation", required: true }, { key: "category", label: "Categoria", type: "category" }, { key: "admissionDate", label: "Admissão", type: "date" }, { key: "movement", label: "Movimento" }, { key: "workdayHours", label: "Jornada diária em horas", type: "number", required: true }, { key: "observation", label: "Observação", type: "textarea" }],
  vacation: [{ key: "employeeId", label: "Colaborador", type: "employee", required: true }, { key: "startDate", label: "Início das férias", type: "date", required: true }, { key: "endDate", label: "Fim das férias", type: "date", required: true }, { key: "acquisitionStart", label: "Início do período aquisitivo", type: "date" }, { key: "acquisitionEnd", label: "Fim do período aquisitivo", type: "date" }, { key: "status", label: "Etapa", type: "vacationStatus", required: true }, { key: "observation", label: "Observação", type: "textarea" }],
};
export const administrationLabels: Record<AdministrationEntity, string> = { unit: "Unidades", manager: "Gestores", employee: "Colaboradores", vacation: "Planejamento de Férias", department: "Setores", job: "Cargos / funções", category: "Categorias" };
const vacationLabels: Record<string, string> = { draft: "Rascunho", requested: "Solicitado", approved: "Aprovado", cancelled: "Cancelado" };
const lifecycleFields: Field[] = [{ key: "cpf", label: "CPF (11 dígitos)" }, { key: "pis", label: "PIS (11 dígitos)" }, { key: "terminationDate", label: "Data de desligamento", type: "date" }, { key: "situationFrom", label: "Situação válida desde / retorno efetivo", type: "date" }, { key: "expectedReturnDate", label: "Retorno previsto", type: "date" }];
const paths: Record<AdministrationEntity, string> = { unit: "/administracao/unidades", manager: "/administracao/gestores", employee: "/administracao/colaboradores", vacation: "/planejamento/ferias", department: "/administracao/setores", job: "/administracao/cargos", category: "/administracao/categorias" };
const control = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600";
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40";
const valueAt = (row: Row, key: string) => (row as unknown as Record<string, unknown>)[key];
const archived = (row: Row) => "active" in row ? !row.active : "activeInSystem" in row ? !row.activeInSystem : Boolean(row.archivedAt);
const rowName = (row: Row) => "name" in row ? row.name : row.employeeName;

async function api(entity: AdministrationEntity, action: string, data: unknown, signal?: AbortSignal) {
  const response = await fetch("/api/administration", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity, action, data }), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Não foi possível concluir a operação.");
  return result;
}

export function AdministrationApp({ profile, entity }: { profile: AuthenticatedProfile; entity: AdministrationEntity }) {
  const [historyEmployee, setHistoryEmployee] = useState<{id:string;name:string} | null>(null);
  const [snapshot, setSnapshot] = useState<AdministrationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [draftQuery, setDraftQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<{ row: Row | null; mode: "save" | "archive" | "restore" } | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [situationFilter, setSituationFilter] = useState("");
  const [scheduleEmployee, setScheduleEmployee] = useState<{ id: string; name: string } | null>(null);
  const limit = 25;
  const reload = () => setRefresh(value => value + 1);

  useEffect(() => {
    const abort = new AbortController();
    Promise.resolve().then(async () => {
      if (abort.signal.aborted) return;
      setLoading(true); setError("");
      try {
        const result = await api(entity, "list", administrationListSchema.parse({ query, includeArchived, offset, limit, ...(entity === "employee" ? { managerId: managerFilter || undefined, situation: situationFilter || undefined } : {}) }), abort.signal);
        if (!abort.signal.aborted) setSnapshot(result);
      } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Falha na consulta."); }
      finally { if (!abort.signal.aborted) setLoading(false); }
    });
    return () => abort.abort();
  }, [entity, query, includeArchived, offset, refresh, managerFilter, situationFilter]);

  const canCreate = Boolean(snapshot && (entity === "vacation" ? snapshot.permissions.canProposeVacation : snapshot.permissions.canManageRegisters));
  function openEditor(row: Row | null, mode: "save" | "archive" | "restore") {
    const next: Record<string, string> = { reason: "" };
    for (const field of fields[entity]) next[field.key] = row ? String(valueAt(row, field.key) ?? "") : field.key === "situation" ? "ATIVO" : field.key === "status" ? "draft" : "";
    if (entity === "employee") for (const field of lifecycleFields) next[field.key] = row ? String(valueAt(row, field.key) ?? "") : "";
    setDraft(next); setFormError(""); setEditor({ row, mode });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || saving) return;
    const data: Record<string, unknown> = { reason: draft.reason };
    if (editor.row) Object.assign(data, { id: editor.row.id, expectedUpdatedAt: editor.row.updatedAt });
    if (editor.mode === "save") for (const field of fields[entity]) data[field.key] = field.type === "number" ? Number(draft[field.key]) : draft[field.key] || (field.required ? "" : null);
    if (editor.mode === "save" && entity === "employee") {
      for (const field of lifecycleFields) data[field.key] = draft[field.key] || null;
      if (draft.situation !== "DESLIGADO") data.terminationDate = null;
      if (!isAwaySituation(draft.situation)) data.expectedReturnDate = null;
    }
    const parsed = (editor.mode === "save" ? saveSchemas[entity] : archiveInputSchema).safeParse(data);
    if (!parsed.success) { setFormError(parsed.error.issues.map(issue => `${[...fields[entity], ...lifecycleFields].find(field => field.key === issue.path[0])?.label ?? (issue.path[0] === "reason" ? "Motivo" : "Cadastro")}: ${issue.message}`).join(" · ")); return; }
    setSaving(true); setFormError("");
    try {
      await api(entity, editor.mode, parsed.data);
      setEditor(null); setMessage(editor.mode === "save" ? "Cadastro salvo." : editor.mode === "archive" ? "Cadastro arquivado." : "Cadastro restaurado.");
      setOffset(0);
      reload();
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Falha ao salvar."); }
    finally { setSaving(false); }
  }

  function options(field: Field) {
    if (!snapshot) return [];
    if (["department", "job", "category"].includes(field.type ?? "")) return (snapshot.options.catalogs ?? []).filter(item => item.kind === field.type && (item.active || draft[field.key] === item.name)).map(item => ({ value: item.name, label: `${item.name}${item.active ? "" : " (arquivado)"}` }));
    if (field.type === "unit") return snapshot.options.units.map(item => ({ value: item.id, label: `${item.code} · ${item.name}${item.active ? "" : " (arquivada)"}` }));
    if (field.type === "manager") return snapshot.options.managers.map(item => ({ value: item.id, label: `${item.name}${item.active ? "" : " (arquivado)"}` }));
    if (field.type === "employee") return snapshot.options.employees.map(item => ({ value: item.id, label: `${item.employeeNumber} · ${item.name}${item.activeInSystem ? "" : " (arquivado)"}` }));
    if (field.type === "situation") return workforceSituations.map(value => ({ value, label: situationLabels[value] }));
    if (field.type === "vacationStatus") return Object.entries(vacationLabels).filter(([value]) => snapshot.permissions.canApproveVacation || value === "draft" || value === "requested" || (value === "cancelled" && editor?.row && "status" in editor.row && ["draft", "requested"].includes(editor.row.status))).map(([value, label]) => ({ value, label }));
    return [];
  }
  function detail(row: Row, data = snapshot) {
    if ("startDate" in row) return `${row.startDate.split("-").reverse().join("/")} a ${row.endDate.split("-").reverse().join("/")} · ${vacationLabels[row.status]}`;
    if ("employeeNumber" in row) return `${data?.options.units.find(unit => unit.id === row.unitId)?.code ?? "Unidade não encontrada"} · ${situationLabels[row.situation]}`;
    if ("referenceUnitId" in row) return data?.options.units.find(unit => unit.id === row.referenceUnitId)?.code ?? "Sem unidade de referência";
    return "code" in row ? row.code : "aliases" in row ? `${row.aliases.length} grafia(s) preservada(s)` : "";
  }
  async function exportAll() {
    if (!snapshot || exporting) return;
    setError(""); setExporting(true);
    try {
      const all: Row[] = [];
      let first: AdministrationSnapshot | null = null;
      for (let page = 0; ; page += 500) {
        const result = await api(entity, "list", { query, includeArchived, offset: page, limit: 500, ...(entity === "employee" ? { managerId: managerFilter || undefined, situation: situationFilter || undefined } : {}) }) as AdministrationSnapshot;
        first ??= result;
        if (!result.datasetVersion || result.datasetVersion !== first.datasetVersion || result.total !== first.total) throw new Error("A consulta mudou durante a exportação. Atualize e tente novamente.");
        all.push(...result.rows);
        if (all.length >= first.total) break;
        if (!result.rows.length || page >= 100000) throw new Error("A consulta mudou durante a exportação. Atualize e tente novamente.");
      }
      if (all.length !== first?.total || new Set(all.map(row => row.id)).size !== all.length) throw new Error("A consulta mudou durante a exportação. Atualize e tente novamente.");
      const csv = entity === "employee" ? toCsv([["Matrícula", "Nome", "CPF", "PIS", "Gestor", "Situação", "Horário", "Desligamento", "Retorno previsto", "Cadastro"], ...all.filter(row => "workdayHours" in row).map(row => [row.employeeNumber, row.name, row.cpf, row.pis, first?.options.managers.find(manager => manager.id === row.managerId)?.name ?? "Sem gestor", situationLabels[row.situation], row.defaultSchedule ? `${row.defaultSchedule.start} às ${row.defaultSchedule.end}` : "Não definido", row.terminationDate, row.expectedReturnDate, archived(row) ? "Arquivado" : "Ativo"])]) : toCsv([["Nome", "Código / Matrícula", "Detalhes", "Estado"], ...all.map(row => [rowName(row), "employeeNumber" in row ? row.employeeNumber : "code" in row ? row.code : "", detail(row, first), archived(row) ? "Arquivado" : "Ativo"])]);
      downloadCsv(csv, `${entity}-cadastros.csv`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao exportar."); }
    finally { setExporting(false); }
  }

  const title = administrationLabels[entity];
  const editorFields = entity === "employee" ? [...fields.employee, ...lifecycleFields.filter(field => field.key !== "terminationDate" || draft.situation === "DESLIGADO").filter(field => field.key !== "expectedReturnDate" || isAwaySituation(draft.situation)).map(field => ({ ...field, required: (field.key === "terminationDate" && draft.situation === "DESLIGADO") || (["situationFrom", "expectedReturnDate"].includes(field.key) && isAwaySituation(draft.situation)) }))] : fields[entity];
  return <AppShell profile={profile} title={title} activeLabel={entity === "vacation" ? "Sugestão de Férias" : "Cadastros"}>
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">{entity === "vacation" ? "Planejamento" : "Administração"}</p><h1 className="mt-1 text-2xl font-bold">{title}</h1><p className="mt-1 max-w-3xl text-sm text-slate-600">{entity === "vacation" ? "Organize propostas, períodos e aprovações por colaborador. A programação não substitui o lançamento da Chamada." : "Cadastros compartilhados pelos módulos. Alterações registram motivo, autor e versão."}</p></div><button className={cn(button, "border-blue-700 bg-blue-700 text-white hover:bg-blue-800")} disabled={!canCreate || loading || Boolean(error)} onClick={() => openEditor(null, "save")}><Plus size={16} />Novo cadastro</button></header>
    <nav aria-label={entity === "vacation" ? "Planejamento" : "Cadastros"} className="flex flex-wrap gap-2">{entity === "vacation" ? <><Link className={button} href="/planejamento/ferias" aria-current="page">Propostas de férias</Link><Link className={button} href="/planejamento/calendario">Calendário por gestor</Link><Link className={button} href="/planejamento/escalas">Escalas e calendário</Link><Link className={button} href="/planejamento/sugestoes-ferias">Sugestões de férias</Link></> : (["unit", "manager", "employee", "department", "job", "category"] as const).map(key => <Link className={cn(button, key === entity && "border-blue-300 bg-blue-50 text-blue-800")} aria-current={key === entity ? "page" : undefined} key={key} href={paths[key]}>{administrationLabels[key]}</Link>)}{entity !== "vacation" ? <><Link className={button} href="/administracao/banco-horas">Medições do Banco de Horas</Link><Link className={button} href="/administracao/auditoria">Auditoria</Link></> : null}</nav>
    <section className="rounded-xl border border-slate-200 bg-white p-4"><form onSubmit={event => { event.preventDefault(); setOffset(0); setQuery(draftQuery); }} className="flex flex-wrap items-end gap-3"><label className="min-w-48 flex-1 text-sm font-medium">Buscar por nome ou código<input className={`${control} mt-1`} value={draftQuery} onChange={event => setDraftQuery(event.target.value)} maxLength={100} /></label>{entity === "employee" ? <><label className="text-sm font-medium">Gestor<select className={`${control} mt-1`} aria-label="Filtrar gestor" value={managerFilter} onChange={event => { setManagerFilter(event.target.value); setOffset(0); }}><option value="">Todos os gestores</option>{snapshot?.options.managers.map(manager => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label><label className="text-sm font-medium">Situação<select className={`${control} mt-1`} aria-label="Filtrar situação" value={situationFilter} onChange={event => { setSituationFilter(event.target.value); setOffset(0); }}><option value="">Todas as situações</option>{workforceSituations.map(situation => <option key={situation} value={situation}>{situationLabels[situation]}</option>)}</select></label></> : null}<button className={button} type="submit">Aplicar busca</button><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={includeArchived} onChange={event => { setIncludeArchived(event.target.checked); setOffset(0); }} />Incluir arquivados</label><button type="button" className={button} onClick={reload} disabled={loading}><RefreshCw size={16} />Atualizar</button><button type="button" className={button} onClick={exportAll} disabled={exporting || loading || !snapshot || Boolean(error)}><Download size={16} />{exporting ? "Exportando…" : "Exportar CSV"}</button></form></section>
    {message ? <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p> : null}
    {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}<button className={`${button} ml-3`} onClick={reload}>Tentar novamente</button></div> : loading ? <p role="status" className="p-5 text-sm text-slate-600">Carregando cadastros…</p> : snapshot ? <section aria-label="Cadastros encontrados" className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr><th className="p-3">Nome</th>{entity === "employee" ? <><th className="p-3">CPF / PIS</th><th className="p-3">Gestor / setor</th><th className="p-3">Horário padrão</th><th className="p-3">Situação</th></> : <th className="p-3">Detalhes</th>}<th className="p-3">Cadastro</th><th className="p-3 text-right">Ações</th></tr></thead><tbody>{snapshot.rows.map(row => <tr key={row.id} className="border-t border-slate-100"><td className="p-3 font-medium"><div className="flex min-w-56 items-center gap-2.5">{"workdayHours" in row ? <EmployeeAvatar name={row.name} employeeId={row.id} size={40} /> : null}<div>{"workdayHours" in row ? <button type="button" className="text-left text-blue-800 underline decoration-blue-200 underline-offset-4 focus-visible:outline-2 focus-visible:outline-blue-600" onClick={() => setHistoryEmployee({id:row.id,name:row.name})}>{rowName(row)}</button> : rowName(row)}{"employeeNumber" in row ? <small className="block font-normal text-slate-500">Matrícula {row.employeeNumber} · {snapshot.options.units.find(unit => unit.id === row.unitId)?.code}</small> : null}</div></div></td>{"workdayHours" in row ? <EmployeeRegisterDetails row={row} snapshot={snapshot} review={() => openEditor(row, "save")} /> : <td className="p-3 text-slate-600">{detail(row)}</td>}<td className="p-3">{archived(row) ? "Arquivado" : "Ativo"}</td><td className="p-3"><div className="flex justify-end gap-2">{"workdayHours" in row && !archived(row) ? <button className={button} onClick={() => setScheduleEmployee(row)} aria-label={`Horário de ${row.name}`}>Horário</button> : null}{canCreate && (!("canEdit" in row) || row.canEdit || (archived(row) && (snapshot.permissions.canApproveVacation || (row.createdBy === profile.id && row.managerId === profile.gestor_id && ["draft", "requested"].includes(row.status))))) ? <>{!archived(row) ? <button className={button} onClick={() => openEditor(row, "save")} aria-label={`Editar ${rowName(row)}`}><Pencil size={15} />Editar</button> : null}<button className={button} onClick={() => openEditor(row, archived(row) ? "restore" : "archive")} aria-label={`${archived(row) ? "Restaurar" : "Arquivar"} ${rowName(row)}`}>{archived(row) ? <RotateCcw size={15} /> : <Archive size={15} />}{archived(row) ? "Restaurar" : "Arquivar"}</button></> : <span className="text-xs text-slate-500">Consulta</span>}</div></td></tr>)}</tbody></table></div>{!snapshot.rows.length ? <p className="p-8 text-center text-sm text-slate-500">Nenhum cadastro encontrado para os filtros.</p> : null}<footer className="flex flex-wrap items-center justify-between gap-3 border-t p-3 text-sm"><span>{snapshot.total ? `${offset + 1}–${Math.min(offset + limit, snapshot.total)}` : "0"} de {snapshot.total} cadastros</span><div className="flex gap-2"><button className={button} disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - limit))}>Anterior</button><button className={button} disabled={offset + limit >= snapshot.total} onClick={() => setOffset(value => value + limit)}>Próxima</button></div></footer></section> : null}
    <Dialog open={Boolean(editor)} onOpenChange={open => { if (!open && !saving) setEditor(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{editor?.mode === "archive" ? "Arquivar cadastro" : editor?.mode === "restore" ? "Restaurar cadastro" : editor?.row ? "Editar cadastro" : "Novo cadastro"}</DialogTitle><DialogDescription>{editor?.mode === "save" ? "Preencha os campos e informe o motivo para o histórico." : `${editor?.row ? rowName(editor.row) : ""}. O histórico permanece disponível.`}</DialogDescription></DialogHeader><form onSubmit={save} className="space-y-4"><fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">{editor?.mode === "save" ? editorFields.map(field => <label key={field.key} className={`text-sm font-medium ${field.type === "textarea" ? "sm:col-span-2" : ""}`}>{field.label}{field.required ? " *" : ""}{["unit", "manager", "employee", "situation", "vacationStatus", "department", "job", "category"].includes(field.type ?? "") ? <select className={`${control} mt-1`} required={field.required} value={draft[field.key] ?? ""} onChange={event => setDraft(value => ({ ...value, [field.key]: event.target.value }))}><option value="">{field.required ? "Selecione" : "Não informado"}</option>{options(field).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === "textarea" ? <textarea className={`${control} mt-1`} rows={3} maxLength={1000} value={draft[field.key] ?? ""} onChange={event => setDraft(value => ({ ...value, [field.key]: event.target.value }))} /> : <input className={`${control} mt-1`} type={field.type ?? "text"} required={field.required} step={field.type === "number" ? "any" : undefined} min={field.type === "number" ? "0.01" : undefined} max={field.type === "number" ? "24" : undefined} value={draft[field.key] ?? ""} onChange={event => setDraft(value => ({ ...value, [field.key]: event.target.value }))} />}</label>) : null}<label className="text-sm font-medium sm:col-span-2">Motivo da alteração *<textarea className={`${control} mt-1`} required minLength={5} maxLength={1000} value={draft.reason ?? ""} onChange={event => setDraft(value => ({ ...value, reason: event.target.value }))} /></label>{entity === "employee" && editor?.mode === "save" ? <p className="text-xs leading-relaxed text-slate-600 sm:col-span-2">Desligamento encerra a presença nessa data. Afastamentos exigem início e retorno previsto; sem retorno confirmado, permanecem protegidos de falta automática. Para reativar, informe a data efetiva em “Situação válida desde”. CPF/PIS do cadastro não substituem a conferência de vínculos na Conciliação.</p> : null}</fieldset>{formError ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{formError}</p> : null}<div className="flex justify-end gap-2"><button type="button" className={button} disabled={saving} onClick={() => setEditor(null)}>Cancelar</button><button type="submit" className={cn(button, "border-blue-700 bg-blue-700 text-white hover:bg-blue-800")} disabled={saving}>{saving ? "Salvando…" : editor?.mode === "save" ? "Salvar cadastro" : editor?.mode === "archive" ? "Arquivar" : "Restaurar"}</button></div></form></DialogContent></Dialog>
    <Dialog open={Boolean(historyEmployee)} onOpenChange={open => { if (!open) setHistoryEmployee(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>Ponto de {historyEmployee?.name}</DialogTitle><DialogDescription>Batidas dos dois relógios, saldo diário e correções do RH.</DialogDescription></DialogHeader>{historyEmployee ? <EmployeePunchHistory key={historyEmployee.id} employeeId={historyEmployee.id} /> : null}</DialogContent></Dialog>
    <Dialog open={Boolean(scheduleEmployee)} onOpenChange={open => { if (!open) { setScheduleEmployee(null); reload(); } }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Horário de {scheduleEmployee?.name}</DialogTitle><DialogDescription>Horário padrão e vigência do colaborador.</DialogDescription></DialogHeader>{scheduleEmployee ? <EmployeeSchedule key={scheduleEmployee.id} employeeId={scheduleEmployee.id} date={todayInSaoPaulo()} /> : null}</DialogContent></Dialog>
  </AppShell>;
}
