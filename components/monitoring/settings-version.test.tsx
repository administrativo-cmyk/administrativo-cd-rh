import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsForm } from "./settings-form";
import { MonitoringAdmin } from "./monitoring-admin";
import type { AdminSnapshot } from "./admin-types";
const employeeId = "10000000-0000-4000-8000-000000000001";
const setting: AdminSnapshot["settings"][number] = { id: "20000000-0000-4000-8000-000000000001", kind: "schedule", target: employeeId, valid_from: "2026-10-01", valid_to: null, reason: "Original sintético", revoked_at: null, updated_at: "2026-10-17T12:00:00Z", revision: 2,
  payload: { name: "Escala sintética", start: "08:00", end: "17:00", days: [1, 3, 5], allowNoBreak: false, pairing: "explicit", coffeeWindows: [{ start: "09:00", end: "09:15" }, { start: "15:00", end: "15:15" }] } };
const snapshot: AdminSnapshot = { sources: [], files: [], settings: [setting], bindings: [], employees: [{ id: employeeId, name: "Pessoa sintética", employeeNumber: "0001" }], users: [], pending: [], audit: [] };
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot)))); });
it("prefills revision fields and preserves all coffee windows during editing", async () => {
  const user = userEvent.setup(); const save = vi.fn().mockResolvedValue(true);
  render(<SettingsForm employees={snapshot.employees} users={[]} today="2026-10-17" initial={setting} save={save} />);
  expect(screen.getByRole("combobox", { name: "Configuração" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "Colaborador" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "Janelas de café (opcional, separadas por vírgula)" })).toHaveValue("09:00-09:15, 15:00-15:15");
  await user.clear(screen.getByRole("textbox", { name: "Nome da escala" }));
  await user.type(screen.getByRole("textbox", { name: "Nome da escala" }), "Escala revisada");
  await user.type(screen.getByRole("textbox", { name: "Justificativa" }), "Conferência sintética da escala");
  await user.click(screen.getByRole("button", { name: "Salvar nova revisão" }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: "schedule", target: employeeId, payload: { ...setting.payload, name: "Escala revisada", estimated: false, weeklyRosterConfirmed: true } }));
});
it("editing an inferred time preserves the pending roster until explicitly confirmed", async () => {
  const user = userEvent.setup(); const save = vi.fn().mockResolvedValue(true);
  const inferred = { ...setting, payload: { ...setting.payload, estimated: true, weeklyRosterConfirmed: false } };
  render(<SettingsForm employees={snapshot.employees} users={[]} today="2026-10-19" initial={inferred} save={save} />);
  const confirmation = screen.getByRole("checkbox", { name: "Horários e dias de trabalho/folga confirmados" });
  expect(confirmation).not.toBeChecked();
  expect(screen.getByText(/O ciclo de folgas permanece pendente/)).toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "Justificativa" }), "Revisão do horário estimado");
  await user.click(screen.getByRole("button", { name: "Salvar nova revisão" }));
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({ estimated: true, weeklyRosterConfirmed: false }) }));
  await user.click(confirmation);
  await user.click(screen.getByRole("button", { name: "Salvar nova revisão" }));
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({ estimated: false, weeklyRosterConfirmed: true }) }));
});
it("restoration sends displayed version and justification", async () => {
  const user = userEvent.setup();
  vi.mocked(fetch).mockImplementation(async (_url, options) => new Response(JSON.stringify(options?.method === "POST" ? { ok: true } : { ...snapshot, settings: [{ ...setting, revoked_at: "2026-10-17T13:00:00Z" }] })));
  render(<MonitoringAdmin section="settings" today="2026-10-17" />);
  await user.click(await screen.findByRole("button", { name: "Restaurar configuração" }));
  await user.type(screen.getByRole("textbox", { name: "Justificativa da alteração" }), "Restauração sintética");
  await user.click(screen.getByRole("button", { name: "Confirmar restauração" }));
  const call = vi.mocked(fetch).mock.calls.find(([, options]) => options?.method === "POST");
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ action: "restore_setting", data: { id: setting.id, expectedUpdatedAt: setting.updated_at, reason: "Restauração sintética" } });
});
