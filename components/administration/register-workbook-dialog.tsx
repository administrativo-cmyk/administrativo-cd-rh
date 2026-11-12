"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { dashboardButton, dashboardInput } from "@/components/dashboards/format";
import { importFileLimitBytes } from "@/lib/monitoring/payload-limits";
import {
  registerWorkbookChunkSize, registerWorkbookEndpoint, registerWorkbookMime,
  type RegisterWorkbookEntity, type RegisterWorkbookIssue, type RegisterWorkbookPreview,
} from "@/lib/administration/register-workbook-contracts";

const sheetNames: Record<RegisterWorkbookEntity, string> = {
  employee: "Quadro Atual", bank: "Banco de Horas", vacation: "Férias", unit: "Unidades", manager: "Gestores",
  department: "Setores", job: "Cargos e Funções", category: "Categorias",
};
type Result = { entity: RegisterWorkbookEntity; line: number; ok: boolean; error?: string };

async function requestWorkbook(body: File | string) {
  const response = await fetch(registerWorkbookEndpoint, {
    method: "POST", headers: { "Content-Type": typeof body === "string" ? "application/json" : registerWorkbookMime }, body,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error ?? "O servidor não confirmou a operação.");
  return data;
}

export function RegisterWorkbookDialog({ onApplied }: { onApplied: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RegisterWorkbookPreview | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ saved: number; issues: RegisterWorkbookIssue[]; finished: boolean } | null>(null);
  const [page, setPage] = useState(0);

  function selectFile(next: File | null) {
    setFile(next);
    setPreview(null);
    setResult(null);
    setError("");
    setPage(0);
  }

  async function review() {
    if (!file || busy) return;
    if (!/\.xlsx$/i.test(file.name) || file.size > importFileLimitBytes) {
      setError("Selecione um arquivo XLSX de até 4,3 MB.");
      return;
    }
    setBusy("preview");
    setError("");
    setPreview(null);
    setPage(0);
    try { setPreview(await requestWorkbook(file)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao ler o Excel."); }
    finally { setBusy(null); }
  }

  async function apply() {
    if (!preview?.changes.length || busy || result) return;
    setBusy("apply");
    setError("");
    setPage(0);
    let saved = 0;
    const issues = [...preview.issues];
    try {
      for (let offset = 0; offset < preview.changes.length; offset += registerWorkbookChunkSize) {
        const chunk = preview.changes.slice(offset, offset + registerWorkbookChunkSize);
        const operations = chunk.map(({ entity, line, data }) => ({ entity, line, data }));
        const { results }: { results: Result[] } = await requestWorkbook(JSON.stringify({ operations, reason }));
        if (results.length !== chunk.length) throw new Error("O servidor devolveu um resultado incompleto.");
        for (const row of results) {
          if (row.ok) saved++;
          else issues.push({ sheet: sheetNames[row.entity], line: row.line, message: row.error ?? "Falha ao atualizar." });
        }
        setResult({ saved, issues: [...issues], finished: false });
      }
      setResult({ saved, issues, finished: true });
    } catch (cause) {
      setResult({ saved, issues, finished: false });
      setError((cause instanceof Error ? cause.message : "Falha ao atualizar.") + " Baixe um novo Excel para conferir o que foi salvo.");
    } finally {
      setBusy(null);
      if (saved) onApplied();
    }
  }

  const entries = result?.issues ?? [
    ...(preview?.issues ?? []),
    ...(preview?.changes.map(row => ({ sheet: sheetNames[row.entity], line: row.line, message: row.label + " · " + row.fields.join(", ") })) ?? []),
  ];
  const pageSize = 25;

  return <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
    <DialogTrigger asChild><button type="button" className={dashboardButton}><FileSpreadsheet size={16} />Atualizar via Excel</button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!busy}>
      <DialogHeader>
        <DialogTitle>Atualizar via Excel</DialogTitle>
        <DialogDescription>Baixe o arquivo com os dados atuais, edite as linhas existentes e envie o mesmo Excel para conferir as alterações.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-end gap-3">
        <a className={dashboardButton} href={registerWorkbookEndpoint} download><FileSpreadsheet size={16} />Baixar Excel</a>
        <label className="min-w-0 flex-1 text-sm font-medium">Excel editado
          <input type="file" className={dashboardInput} accept={".xlsx," + registerWorkbookMime} disabled={!!busy} onChange={event => { selectFile(event.target.files?.[0] ?? null); event.target.value = ""; }} />
          {file ? <span className="block break-all text-xs font-normal text-slate-600">{file.name}</span> : null}
        </label>
        <button type="button" className={dashboardButton} disabled={!file || !!busy || !!result} onClick={() => void review()}>{busy === "preview" ? "Validando…" : "Conferir alterações"}</button>
      </div>
      {preview && !result ? <p role="status" className="text-sm text-slate-700">{preview.changes.length} linhas com alterações · {preview.unchanged} intactas · {preview.issues.length} pendências</p> : null}
      {result ? <p role="status" className="text-sm text-slate-700">{result.saved} alterações confirmadas · {result.issues.length} pendências{busy ? " · Aplicando…" : result.finished ? " · Importação concluída" : ""}</p> : null}
      {entries.length ? <div className="space-y-2">
        <ul aria-label="Linhas da planilha" className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 text-sm">
          {entries.slice(page * pageSize, (page + 1) * pageSize).map((row, index) => <li className="border-b border-slate-100 px-3 py-2 last:border-b-0" key={row.sheet + ":" + row.line + ":" + index}>
            <strong>{row.sheet} · Linha {row.line}</strong><span className="block break-words text-slate-600">{row.message}</span>
          </li>)}
        </ul>
        {entries.length > pageSize ? <div className="flex flex-wrap items-center gap-2 text-sm">
          <button className={dashboardButton} type="button" disabled={!page} onClick={() => setPage(value => value - 1)}>Anterior</button>
          <span>Página {page + 1} de {Math.ceil(entries.length / pageSize)}</span>
          <button className={dashboardButton} type="button" disabled={(page + 1) * pageSize >= entries.length} onClick={() => setPage(value => value + 1)}>Próxima</button>
        </div> : null}
      </div> : null}
      {Boolean(preview?.issues.length) && !result ? <p role="alert" className="text-sm text-rose-800">As linhas com pendência precisam de correção no Excel.</p> : null}
      {error ? <p role="alert" className="text-sm text-rose-800">{error}</p> : null}
      {preview?.changes.length && !result ? <div className="space-y-3">
        <label className="block text-sm font-medium">Motivo da atualização<input className={dashboardInput} value={reason} maxLength={1000} disabled={!!busy} onChange={event => setReason(event.target.value)} /></label>
        <button type="button" className={dashboardButton + " border-blue-700 bg-blue-700 text-white hover:bg-blue-800"} disabled={!!busy || reason.trim().length < 5} onClick={() => void apply()}>{busy === "apply" ? "Aplicando…" : "Aplicar linhas válidas (" + preview.changes.length + ")"}</button>
      </div> : null}
    </DialogContent>
  </Dialog>;
}
