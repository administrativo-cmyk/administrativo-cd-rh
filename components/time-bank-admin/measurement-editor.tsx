"use client";
import { cn } from "@/lib/utils";
import { useState, type FormEvent } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dashboardButton, dashboardDate, dashboardInput, dashboardValue } from "@/components/dashboards/format";
import { formatSignedMinutes } from "@/lib/domain/bank-hours";
import { bankAdminEnvelopeSchema, type BankAdminMutation, type BankAdminSnapshot, type BankMeasurement } from "@/lib/time-bank-admin/contracts";
import { parseMeasuredBalance } from "@/lib/time-bank-admin/format";

export type MeasurementEditorState = { mode: "save" | "cancel" | "restore"; row: BankMeasurement | null };
export function MeasurementEditor({ editor, employees, today, onClose, onSave }: { editor: MeasurementEditorState; employees: BankAdminSnapshot["employees"]; today: string; onClose: () => void; onSave: (data: BankAdminMutation) => Promise<void> }) {
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const row = editor.row;
  const title = editor.mode === "cancel" ? "Cancelar medição" : editor.mode === "restore" ? "Restaurar medição" : row ? "Editar medição" : "Nova medição";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    const form = new FormData(event.currentTarget);
    const version = row ? { id: row.id, expectedUpdatedAt: row.updatedAt } : {};
    const data = { ...version, reason: String(form.get("reason") ?? ""), ...(editor.mode === "save" ? { employeeId: row?.employeeId ?? String(form.get("employeeId") ?? ""), measurementDate: String(form.get("measurementDate") ?? ""), effectiveFrom: String(form.get("effectiveFrom") ?? ""), workdayHours: Number(form.get("workdayHours")), balanceMinutes: parseMeasuredBalance(String(form.get("balance") ?? "")), source: String(form.get("source") ?? "").trim() || null } : {}) };
    const parsed = bankAdminEnvelopeSchema.safeParse({ action: editor.mode, data });
    if (!parsed.success) { setError("Revise colaborador, datas, jornada e saldo no formato +08:30 ou -08:30. A justificativa deve ter de 5 a 1.000 caracteres."); return; }
    setSaving(true); setError("");
    try { await onSave(parsed.data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}><DialogContent showCloseButton={false} className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{editor.mode === "cancel" ? "A medição permanece no histórico e deixa de compor os saldos. A medição anterior, se existir, volta a definir o ciclo." : editor.mode === "restore" ? "A medição volta a compor os saldos se não houver outra ativa com a mesma vigência." : "Informe o saldo do extrato e a data a partir da qual ele define o ciclo. Alterações ficam registradas no histórico."}</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-4">
      {row ? <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><p className="font-semibold text-slate-950">{row.employeeName} · {row.employeeNumber}</p><p>{row.unit} · Vigência atual: {dashboardDate(row.effectiveFrom)} · Saldo: {formatSignedMinutes(row.balanceMinutes)}</p>{row.importBatchId ? <p className="mt-1 text-xs">Medição importada: a origem do lote é preservada.</p> : null}</div> : null}
      {editor.mode === "save" ? <div className="grid gap-4 sm:grid-cols-2">
        {!row ? <label className="text-sm font-medium text-slate-700 sm:col-span-2">Colaborador<select name="employeeId" required defaultValue={employees.length === 1 ? employees[0].id : ""} className={dashboardInput}><option value="" disabled>Selecione pela matrícula e nome</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNumber} · {employee.name} · {employee.unit}{employee.active ? "" : " · Inativo"}</option>)}</select></label> : null}
        <label className="text-sm font-medium text-slate-700">Data da medição<input name="measurementDate" type="date" required defaultValue={row?.measurementDate ?? today} className={dashboardInput} /></label>
        <label className="text-sm font-medium text-slate-700">Aplicar a partir de<input name="effectiveFrom" type="date" required defaultValue={row?.effectiveFrom ?? today} className={dashboardInput} /></label>
        <label className="text-sm font-medium text-slate-700">Jornada diária em horas<input name="workdayHours" type="number" required min="0.0167" max="24" step="0.0001" defaultValue={row?.workdayHours ?? ""} className={dashboardInput} /><span className="mt-1 block text-xs font-normal">Jornada usada pelo extrato para converter o saldo em dias.</span></label>
        <label className="text-sm font-medium text-slate-700">Saldo medido (horas:minutos)<input name="balance" type="text" required maxLength={10} pattern="[+\-]?[0-9]{1,6}:[0-5][0-9]" defaultValue={row ? formatSignedMinutes(row.balanceMinutes) : ""} placeholder="+08:30 ou -08:30" className={dashboardInput} /><span className="mt-1 block text-xs font-normal">Use sinal negativo para débito. Zero conhecido: 00:00.</span></label>
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">Fonte ou documento de conferência<input name="source" maxLength={200} defaultValue={row?.source ?? ""} className={dashboardInput} /></label>
      </div> : row ? <p className="text-sm text-slate-700">Saldo da medição: <strong>{dashboardValue(row.balanceMinutes, "minutes")}</strong>. Os lançamentos manuais da Chamada serão preservados.</p> : null}
      <label className="block text-sm font-medium text-slate-700">Justificativa<textarea name="reason" required minLength={5} maxLength={1000} rows={3} className={dashboardInput} /></label>
      <p className="text-xs leading-relaxed text-slate-600">Novas medições ativam o cálculo do ponto desde a vigência, inclusive. Dias incompletos ficam pendentes; medições anteriores não são ativadas retroativamente. A alteração pode mudar os dias a compensar e a repor desde a vigência informada. Decisões automáticas da Chamada serão reenfileiradas para revisão.</p>
      {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className={dashboardButton}>Fechar</button><button type="submit" disabled={saving} className={cn(dashboardButton, "border-blue-700 bg-blue-700 text-white hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-700 disabled:opacity-100")}>{saving ? "Salvando…" : editor.mode === "save" ? "Salvar medição" : title}</button></div>
    </form>
  </DialogContent></Dialog>;
}
