"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dashboardButton, dashboardDate, dashboardInstant } from "@/components/dashboards/format";
import { formatSignedMinutes } from "@/lib/domain/bank-hours";
import { bankHistorySchema, type BankHistory, type BankMeasurement } from "@/lib/time-bank-admin/contracts";

const labels = { create: "Criação", update: "Edição", cancel: "Cancelamento", restore: "Restauração" };
export function MeasurementHistory({ row, onClose }: { row: BankMeasurement; onClose: () => void }) {
  const [history, setHistory] = useState<BankHistory | null>(null); const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const response = await fetch(`/api/time-bank-admin?action=history&id=${encodeURIComponent(row.id)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Não foi possível carregar o histórico.");
        const result = bankHistorySchema.parse(await response.json());
        if (!controller.signal.aborted) setHistory(result);
      } catch { if (!controller.signal.aborted) setError("Não foi possível carregar o histórico. Feche e tente novamente."); }
    }
    void read(); return () => controller.abort();
  }, [row.id]);
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent showCloseButton={false} className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Histórico da medição</DialogTitle><DialogDescription>{row.employeeName} · {row.employeeNumber}. Valores anteriores e posteriores de cada alteração administrativa.</DialogDescription></DialogHeader>{error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : !history ? <p role="status" className="text-sm text-slate-600">Carregando histórico…</p> : history.rows.length ? <ol className="divide-y divide-slate-200">{history.rows.map((entry) => <li key={entry.id} className="space-y-2 py-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{labels[entry.action]}</strong><span className="text-xs text-slate-600">{dashboardInstant(entry.createdAt)}</span></div><p className="text-slate-700">{entry.actorName} · {entry.reason}</p><dl className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">{([["Antes", entry.before], ["Depois", entry.after]] as const).map(([label, measurement]) => <div key={label}><dt className="font-medium text-slate-600">{label}</dt><dd className="mt-1 text-slate-950">{measurement ? <><p>{formatSignedMinutes(measurement.balanceMinutes)} · Jornada {measurement.workdayHours}h</p><p>Medição: {dashboardDate(measurement.measurementDate)}</p><p>Vigência: {dashboardDate(measurement.effectiveFrom)}</p><p>{measurement.cancelledAt ? "Cancelada" : "Ativa"}</p><p className="break-words">Fonte: {measurement.source ?? "Não informada"}</p></> : "Não havia medição"}</dd></div>)}</dl></li>)}</ol> : <p className="text-sm text-slate-600">Sem alterações administrativas registradas. Medições importadas antes desta funcionalidade mantêm a origem do lote.</p>}<div className="flex justify-end"><button type="button" onClick={onClose} className={dashboardButton}>Fechar</button></div></DialogContent></Dialog>;
}
