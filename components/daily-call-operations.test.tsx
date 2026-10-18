import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Employee } from "@/lib/daily-call-types";
import { DailyCallBatch } from "./daily-call-batch";
import { DailyCallAttachments } from "./daily-call-attachments";

const id = "cd100000-0000-4000-8000-000000000001";
const date = "2026-10-10";
const version = "2026-10-17T15:00:00Z";
const employee: Employee = { id: "QA-1", databaseId: id, name: "Pessoa sintética", unit: "CD I", manager: "Gestor sintético", department: "Operação", role: "Auxiliar", situation: "Ativo", admissionDate: "2026-01-01", plannedVacation: "", bankDays: 2, bankHours: "16:00", attendance: {}, observations: {} };
const preview = { version: "a".repeat(64), eligible: 1, total: 1, rows: [{ employeeId: id, date, name: employee.name, status: "G", observation: "Conferido", currentStatus: null, origin: null, eligible: true, explanation: "Revisão manual explícita" }] };
const attachment = { id, fileName: "evidencia.pdf", description: "Justificativa sintética", mediaType: "application/pdf", size: 512, createdAt: version, updatedAt: version, archivedAt: null };
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
afterEach(() => vi.unstubAllGlobals());
function openBatch() {
 fireEvent.click(screen.getByRole("button", { name: "Preencher ou revisar em lote" }));
 const dialog = within(screen.getByRole("dialog"));
 fireEvent.click(dialog.getByRole("checkbox", { name: /Pessoa sintética/ }));
 fireEvent.change(dialog.getByLabelText("Status"), { target: { value: "G" } });
 fireEvent.change(dialog.getByLabelText("Observação comum"), { target: { value: "Conferido" } });
 fireEvent.change(dialog.getByLabelText("Motivo do lote"), { target: { value: "Revisão sintética conferida" } });
 return dialog;
}
describe("operações da Chamada", () => {
 it("exige prévia, envia a versão e conserva rascunho quando outro usuário altera o lote", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(response({ error: "Dados alterados. Gere uma nova prévia." }, 409));
  vi.stubGlobal("fetch", fetcher); const changed = vi.fn();
  render(<DailyCallBatch employees={[employee]} date={date} onChanged={changed}/>);
  const dialog = openBatch();
  expect(dialog.getByRole("button", { name: "Confirmar lote conferido" })).toBeDisabled();
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole("button", { name: "Gerar prévia" }));
  expect(await dialog.findByRole("region", { name: "Prévia do lote" })).toHaveTextContent("1 novo(s) G");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ action: "preview", data: { mode: "fill_blank", items: [{ employeeId: id, date, status: "G" }] } });
  fireEvent.click(dialog.getByRole("button", { name: "Confirmar lote conferido" }));
  expect(await dialog.findByRole("alert")).toHaveTextContent("nova prévia");
  expect(dialog.getByLabelText("Motivo do lote")).toHaveValue("Revisão sintética conferida");
  expect(dialog.getByLabelText("Observação comum")).toHaveValue("Conferido");
  expect(dialog.getByRole("checkbox", { name: /Pessoa sintética/ })).toBeChecked();
  expect(dialog.getByRole("button", { name: "Confirmar lote conferido" })).toBeDisabled();
  expect(JSON.parse(fetcher.mock.calls[1][1].body).data.expectedVersion).toBe(preview.version);
  expect(changed).not.toHaveBeenCalled();
 });
 it("descarta prévia ao mudar o pedido e atualiza dados somente após confirmação bem-sucedida", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(response({ reviewed: 1, changed: 1, skipped: 0 }));
  vi.stubGlobal("fetch", fetcher); const changed = vi.fn();
  render(<DailyCallBatch employees={[employee]} date={date} onChanged={changed}/>);
  const dialog = openBatch(); fireEvent.click(dialog.getByRole("button", { name: "Gerar prévia" }));
  await dialog.findByRole("region", { name: "Prévia do lote" });
  fireEvent.change(dialog.getByLabelText("Motivo do lote"), { target: { value: "Motivo revisado pelo gestor" } });
  expect(dialog.queryByRole("region", { name: "Prévia do lote" })).not.toBeInTheDocument();
  expect(dialog.getByRole("button", { name: "Confirmar lote conferido" })).toBeDisabled();
  fireEvent.click(dialog.getByRole("button", { name: "Gerar prévia" }));
  await dialog.findByRole("region", { name: "Prévia do lote" });
  fireEvent.click(dialog.getByRole("button", { name: "Confirmar lote conferido" }));
  expect(await screen.findByRole("status")).toHaveTextContent("1 alterado(s)");
  expect(changed).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
 });
 it("permite consulta privada à leitura sem mostrar ações de escrita", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ rows: [attachment] })));
  render(<DailyCallAttachments employeeId={id} date={date} canWrite={false}/>);
  expect(await screen.findByRole("link", { name: "Baixar anexo" })).toHaveAttribute("href", `/api/daily-call/attachments?id=${id}`);
  expect(screen.queryByLabelText("Arquivo privado")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Arquivar" })).not.toBeInTheDocument();
 });
 it("mantém arquivo e justificativa após rejeição do upload", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ rows: [] })).mockResolvedValueOnce(response({ error: "Arquivo inválido ou fora do limite." }, 400));
  vi.stubGlobal("fetch", fetcher);
  render(<DailyCallAttachments employeeId={id} date={date} canWrite/>);
  await screen.findByText("Nenhum anexo nesta data.");
  const file = new File(["%PDF-synthetic"], "evidencia.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("Arquivo privado"), { target: { files: [file] } });
  fireEvent.change(screen.getByLabelText("Descrição da justificativa"), { target: { value: "Justificativa ainda não salva" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar anexo privado" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Arquivo inválido");
  expect(screen.getByLabelText("Descrição da justificativa")).toHaveValue("Justificativa ainda não salva");
  expect((screen.getByLabelText("Arquivo privado") as HTMLInputElement).files?.[0]).toBe(file);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ employeeId: id, date, fileName: file.name, description: "Justificativa ainda não salva" });
 });
 it("preserva motivo e envia CAS ao arquivar anexo", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ rows: [attachment] })).mockResolvedValueOnce(response({ error: "Anexo alterado por outra pessoa." }, 409));
  vi.stubGlobal("fetch", fetcher);
  render(<DailyCallAttachments employeeId={id} date={date} canWrite/>);
  await screen.findByRole("button", { name: "Arquivar" });
  fireEvent.change(screen.getByLabelText("Motivo para arquivar ou restaurar"), { target: { value: "Documento substituído após revisão" } });
  fireEvent.click(screen.getByRole("button", { name: "Arquivar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("outra pessoa");
  expect(screen.getByLabelText("Motivo para arquivar ou restaurar")).toHaveValue("Documento substituído após revisão");
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ action: "archive", data: { id, expectedUpdatedAt: version, reason: "Documento substituído após revisão" } });
 });
});
