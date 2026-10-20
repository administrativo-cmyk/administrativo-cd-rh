import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GroupFilter } from "./group-filter";

const response = (groups: string[]) => ({ ok: true, json: async () => ({ groups, queriedAt: "2026-10-20T13:00:00Z" }) }) as Response;
beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(["COZINHA JK", "LIDERANÇA JK", "ENT-14H JK VESP"]))));
afterEach(() => vi.useRealTimers());

it("pesquisa por parte do nome, sem diferença de caixa ou acento, com seleção por teclado", async () => {
  const user = userEvent.setup(), change = vi.fn();
  render(<GroupFilter value="" onChange={change} />);
  await user.click(screen.getByRole("combobox", { name: "Grupo" }));
  const search = screen.getByRole("combobox", { name: "Pesquisar grupos" });
  await user.type(search, "lideranca");
  expect(await screen.findByRole("option", { name: "LIDERANÇA JK" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "COZINHA JK" })).not.toBeInTheDocument();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(change).toHaveBeenCalledWith("LIDERANÇA JK");
  expect(screen.getByRole("combobox", { name: "Grupo" })).toHaveAttribute("aria-expanded", "false");
  expect(fetch).toHaveBeenCalledWith("/api/monitoring/groups?scope=query", expect.objectContaining({ cache: "no-store" }));
});

it("atualiza o catálogo sem perder a seleção e permite remover o filtro", async () => {
  vi.useFakeTimers();
  const change = vi.fn();
  render(<GroupFilter value="COZINHA JK" onChange={change} />);
  await act(async () => {});
  vi.mocked(fetch).mockResolvedValue(response(["COZINHA JK", "NOVO GRUPO"]));
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  fireEvent.click(screen.getByRole("combobox", { name: "Grupo" }));
  expect(screen.getByRole("option", { name: "NOVO GRUPO" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Grupo" })).toHaveTextContent("COZINHA JK");
  fireEvent.click(screen.getByRole("option", { name: "Todos os grupos" }));
  expect(change).toHaveBeenCalledWith("");
});

it("falha no catálogo mantém o filtro selecionado e permite recuperar a lista", async () => {
  const user = userEvent.setup();
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Falha temporária"));
  render(<GroupFilter value="GRUPO HISTÓRICO" onChange={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Falha temporária");
  expect(screen.getByRole("combobox", { name: "Grupo" })).toHaveTextContent("GRUPO HISTÓRICO");
  await user.click(screen.getByRole("button", { name: "Tentar carregar grupos" }));
  await user.click(screen.getByRole("combobox", { name: "Grupo" }));
  await user.type(screen.getByRole("combobox", { name: "Pesquisar grupos" }), "inexistente");
  expect(await screen.findByText("Nenhum grupo encontrado.")).toBeInTheDocument();
});
