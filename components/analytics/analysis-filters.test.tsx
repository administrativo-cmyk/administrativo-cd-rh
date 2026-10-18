import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
import { AnalysisExport, AnalysisFiltersForm } from "./analysis-filters";
import { AnalysisNav } from "./analysis-nav";

const filters = { start: "2026-10-17", end: "2026-10-17", unit: "", managerId: "", query: "" };
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());
describe("filtros e exportação de análises", () => {
  it("envia filtros explícitos pelaURL e permite limpar sem alterar dados", () => {
    render(<AnalysisFiltersForm kind="top-por-gestor" filters={filters} options={{ units: ["CD I"], managers: [] }} today={filters.end} />);
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "CD I" } });
    fireEvent.change(screen.getByLabelText("Gestor"), { target: { value: "none" } });
    fireEvent.change(screen.getByLabelText("Colaborador"), { target: { value: "Álvaro" } });
    fireEvent.submit(screen.getByRole("form", { name: "Filtros da análise" }));
    const query = new URL(mocks.push.mock.calls[0][0], "http://localhost");
    expect(query.pathname).toBe("/analises/top-por-gestor");
    expect(Object.fromEntries(query.searchParams)).toEqual({ end: filters.end, unit: "CD I", managerId: "none", query: "Álvaro" });
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(mocks.push).toHaveBeenLastCalledWith("/analises/top-por-gestor");
  });
  it("quadro atual não oferece data histórica e navmarca análise ativa", () => {
    render(<><AnalysisFiltersForm kind="afastados-e-outros" filters={filters} options={{ units: [], managers: [] }} today={filters.end} /><AnalysisNav selected="afastados-e-outros" /></>);
    expect(screen.queryByLabelText("Data de referência")).not.toBeInTheDocument();
    expect(screen.getByText(/Cadastro atual/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Afastados e outros" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Metodologia" })).toHaveAttribute("href", "/analises/metodologia");
  });
  it("exportação falha visivelmente e não converte respostaJSON emCSV", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: "Denied" }, { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    render(<AnalysisExport kind="top-20-banco-horas" filters={filters} />);
    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível exportar");
    await waitFor(() => expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeEnabled());
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/analytics/top-20-banco-horas?"), expect.objectContaining({ cache: "no-store" }));
  });
  it("desmontagem cancela download em andamento", () => {
    const fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(<AnalysisExport kind="top-por-gestor" filters={filters} />);
    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    const signal = fetch.mock.calls[0][1].signal;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
