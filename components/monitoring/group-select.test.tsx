import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GroupSelect } from "./group-select";
import { SettingsForm } from "./settings-form";
import type { AdminSnapshot } from "./admin-types";

const response = (groups: string[]) => ({ ok: true, json: async () => ({ groups, queriedAt: "2026-10-20T12:00:00Z" }) });
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => response(["LIDERANÇA JK", "COZINHA JK"]))); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("seleciona grupo importado e envia a exceção com vigência e justificativa", async () => {
  const user = userEvent.setup(), save = vi.fn().mockResolvedValue(true);
  render(<SettingsForm employees={[]} users={[]} today="2026-10-20" save={save} />);
  await user.selectOptions(screen.getByRole("combobox", { name: "Configuração" }), "policy");
  await screen.findByRole("option", { name: "COZINHA JK" });
  await user.selectOptions(screen.getByRole("combobox", { name: "Grupo" }), "COZINHA JK");
  await user.type(screen.getByRole("textbox", { name: "Justificativa" }), "Exceção conferida com RH");
  await user.click(screen.getByRole("button", { name: "Salvar configuração" }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ target: "COZINHA JK", validFrom: "2026-10-20", reason: "Exceção conferida com RH", payload: { indicator: "outsideOperation", scope: "group", exclude: true } }));
});

it("atualiza novos grupos automaticamente sem perder a seleção e suspende consultas com a tela oculta", async () => {
  vi.useFakeTimers();
  let groups = ["COZINHA JK"];
  vi.mocked(fetch).mockImplementation(async () => response(groups) as unknown as Response);
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const view = render(<GroupSelect value="COZINHA JK" onChange={vi.fn()} />);
  await act(async () => {});
  expect(screen.getByRole("option", { name: "COZINHA JK" })).toBeInTheDocument();
  groups = ["COZINHA JK", "GRUPO NOVO"];
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.getByRole("option", { name: "GRUPO NOVO" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Grupo" })).toHaveValue("COZINHA JK");
  visibility.mockReturnValue("hidden");
  const calls = vi.mocked(fetch).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(fetch).toHaveBeenCalledTimes(calls);
  visibility.mockReturnValue("visible");
  await act(async () => { fireEvent(document, new Event("visibilitychange")); });
  expect(fetch).toHaveBeenCalledTimes(calls + 1);
  view.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(fetch).toHaveBeenCalledTimes(calls + 1);
});

it("preserva o nome exato e bloqueia o destino ao editar uma regra histórica", async () => {
  const initial = { id: "x", kind: "policy", target: "Grupo antigo", valid_from: "2026-10-01", valid_to: null, payload: { scope: "group", indicator: "outsideOperation", exclude: true }, reason: "Histórico", revoked_at: null } as AdminSnapshot["settings"][number];
  render(<SettingsForm employees={[]} users={[]} today="2026-10-20" initial={initial} save={vi.fn()} />);
  await screen.findByRole("option", { name: "COZINHA JK" });
  expect(screen.getByRole("combobox", { name: "Grupo" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "Grupo" })).toHaveValue("Grupo antigo");
});

it("informa falha e permite recarregar sem salvar configurações", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Falha temporária"));
  render(<GroupSelect value="" onChange={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Falha temporária");
  expect(screen.getByRole("combobox", { name: "Grupo" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Tentar carregar grupos" }));
  await screen.findByRole("option", { name: "COZINHA JK" });
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});

it("não reutiliza uma matrícula como nome de grupo ao trocar Pessoa por Grupo", async () => {
  const user = userEvent.setup();
  render(<SettingsForm employees={[{ id: "10000000-0000-4000-8000-000000000001", name: "Pessoa", employeeNumber: "001" }]} users={[]} today="2026-10-20" save={vi.fn()} />);
  await user.selectOptions(screen.getByRole("combobox", { name: "Colaborador" }), "10000000-0000-4000-8000-000000000001");
  await user.selectOptions(screen.getByRole("combobox", { name: "Configuração" }), "policy");
  await screen.findByRole("option", { name: "COZINHA JK" });
  expect(screen.getByRole("combobox", { name: "Grupo" })).toHaveValue("");
  await user.selectOptions(screen.getByRole("combobox", { name: "Aplicar a" }), "person");
  await user.selectOptions(screen.getByRole("combobox", { name: "Colaborador" }), "10000000-0000-4000-8000-000000000001");
  await user.selectOptions(screen.getByRole("combobox", { name: "Aplicar a" }), "group");
  await screen.findByRole("option", { name: "COZINHA JK" });
  expect(screen.getByRole("combobox", { name: "Grupo" })).toHaveValue("");
});
