import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ImportWizard } from "./import-wizard";
import { BindingHistory } from "./binding-history";
import { SourceManager } from "./source-manager";
import type { AdminSnapshot } from "./admin-types";
import { importFileLimitBytes, importFileLimitMessage } from "@/lib/monitoring/payload-limits";
const id = "ba000000-0000-4000-8000-000000000001";
const stamp = "2026-10-17T00:00:00Z";
const source = { id: "clock", kind: "afd", timezone: "America/Sao_Paulo", identity_namespace: "clock", label: "Synthetic clock", active: true, configuration_updated_at: stamp, heartbeat_at: null, worker_state: "idle", last_success_at: null };
afterEach(() => vi.unstubAllGlobals());
it("impede envio acima do limite e preserva arquivo selecionado", async () => {
  const user = userEvent.setup(); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  render(<ImportWizard kind="bank" today="2026-10-17" onApplied={vi.fn()} />);
  await user.click(screen.getByText("Importar lote de medições"));
  const file = new File([new Uint8Array(importFileLimitBytes + 1)], "synthetic.csv", { type: "text/csv" });
  await user.upload(screen.getByLabelText("Arquivo"), file);
  await user.click(screen.getByRole("button", { name: "Ler títulos e amostra" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(importFileLimitMessage);
  expect(fetch).not.toHaveBeenCalled(); expect((screen.getByLabelText("Arquivo") as HTMLInputElement).files?.[0]).toBe(file);
});
it("explica 413 da plataforma mesmo sem resposta JSON", async () => {
  const user = userEvent.setup(); const json = vi.fn(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 413, ok: false, json }));
  render(<ImportWizard kind="bank" today="2026-10-17" onApplied={vi.fn()} />);
  await user.click(screen.getByText("Importar lote de medições"));
  await user.upload(screen.getByLabelText("Arquivo"), new File(["synthetic"], "synthetic.csv", { type: "text/csv" }));
  await user.click(screen.getByRole("button", { name: "Ler títulos e amostra" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(importFileLimitMessage); expect(json).not.toHaveBeenCalled();
});
it.each([false, true])("clock import preserves review and refreshes even if confirmed response is oversized: %s", async (oversized) => {
  const user = userEvent.setup(); const onApplied = vi.fn();
  const rows = [{ line: 2, input: { employeeNumber: "000123", cpf: "52998224725" }, employeeName: "Synthetic", errors: [], state: "ready" }, { line: 3, input: { employeeNumber: "000124" }, employeeName: "Homonym", errors: ["NOME_DIVERGENTE"], state: "blocked" }];
  const preview = { id, kind: "clock", updatedAt: stamp, rows };
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ headers: ["Mat", "Nome", "CPF"], sheets: ["CSV"], selectedSheet: "CSV", rowCount: 2, sample: [] }) }).mockResolvedValueOnce({ ok: true, json: async () => preview }).mockResolvedValueOnce(oversized ? { ok: false, status: 422, json: async () => ({ code: "RESULTADO_IMPORTACAO_LIMITE_EXCEDIDO", error: "As linhas foram processadas; confira o histórico." }) } : { ok: true, json: async () => ({ ...preview, rows: [{ ...rows[0], state: "applied" }, rows[1]] }) }); vi.stubGlobal("fetch", fetch);
  render(<ImportWizard kind="clock" today="2026-10-17" sources={[source]} onApplied={onApplied} />);
  await user.click(screen.getByText("Importar cadastro do relógio")); await user.upload(screen.getByLabelText("Arquivo"), new File(["synthetic"], "synthetic.csv", { type: "text/csv" }));
  await user.click(screen.getByRole("button", { name: "Ler títulos e amostra" })); await screen.findByText("Mapear colunas");
  await user.selectOptions(screen.getByLabelText("Matrícula"), "0"); await user.selectOptions(screen.getByLabelText("Nome completo"), "1"); await user.selectOptions(screen.getByLabelText("CPF do trabalhador"), "2"); await user.selectOptions(screen.getByLabelText("Fonte AFD"), "clock");
  await user.type(screen.getByLabelText("Documento ou motivo da importação"), "Synthetic confirmed document"); await user.click(screen.getByRole("button", { name: "Gerar prévia conferida" }));
  expect(await screen.findByRole("checkbox", { name: "Conferir linha 2" })).not.toBeChecked(); expect(screen.getByRole("checkbox", { name: "Conferir linha 3" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Confirmar 0 linha(s) conferida(s)" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: "Conferir linha 2" })); await user.click(screen.getByRole("button", { name: "Confirmar 1 linha(s) conferida(s)" }));
  await waitFor(() => expect(onApplied).toHaveBeenCalledOnce()); expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ action: "confirm", id, expectedUpdatedAt: stamp, lines: [2] });
  if (oversized) expect(screen.getByRole("alert")).toHaveTextContent("As linhas foram processadas");
});
it("binding restore sends displayed CAS and written reason, and hides superseded restore", async () => {
  const user = userEvent.setup(); const save = vi.fn(); const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }); vi.stubGlobal("fetch", fetch);
  const binding = { id, source_id: "clock", identity_type: "cpf", identity_value: "52998224725", employee_id: id, valid_from: "2026-10-17", valid_to: null, evidence: "Synthetic identity evidence", revoked_at: stamp, updated_at: stamp, revision: 1 };
  const data: AdminSnapshot = { sources: [source], employees: [{ id, name: "Synthetic", employeeNumber: "000123" }], bindings: [binding], files: [], settings: [], users: [], pending: [], audit: [] };
  render(<BindingHistory data={data} onSaved={save} />); await user.click(screen.getByRole("button", { name: "Restaurar vínculo" })); await user.type(screen.getByLabelText("Justificativa da alteração"), "Synthetic restoration review"); await user.click(screen.getByRole("button", { name: "Confirmar revisão" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce()); expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: "restore", data: { id, expectedUpdatedAt: stamp, reason: "Synthetic restoration review" } });
});
it("source deactivation is an explicit versioned save without local path input", async () => {
  const user = userEvent.setup(); const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }); vi.stubGlobal("fetch", fetch);
  render(<SourceManager sources={[source]} onSaved={vi.fn()} />); await user.click(screen.getByRole("button", { name: "Editar fonte" })); await user.click(screen.getByLabelText("Fonte ativa")); fireEvent.change(screen.getByLabelText("Motivo e evidência"), { target: { value: "Synthetic source paused" } });
  expect(screen.queryByLabelText("Pasta")).not.toBeInTheDocument(); await user.click(screen.getByRole("button", { name: "Salvar fonte" })); await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ id: "clock", active: false, expectedUpdatedAt: stamp, reason: "Synthetic source paused" });
});
