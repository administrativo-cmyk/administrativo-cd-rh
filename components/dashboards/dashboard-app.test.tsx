import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultDashboardFilters, type DashboardSnapshot } from "@/lib/dashboards/contracts";
import { DashboardApp } from "./dashboard-app";
import { dashboardValue } from "./format";

const today = "2026-10-17";
const filters = defaultDashboardFilters("chamada-diaria", today);
function snapshot(value: number | null = null): DashboardSnapshot {
  return {
    domain: "chamada-diaria", title: "Chamada Diária", description: "Consulta de teste", queriedAt: "2026-10-17T15:00:00Z", start: filters.start, end: filters.end,
    options: { units: ["Unidade de teste"], managers: [] },
    metrics: [{ id: "present", label: "Presenças", value, format: "count", description: "Lançamentos do período" }],
    charts: [{ id: "status", title: "Por situação", description: "Registros consultados", format: "count", points: [{ label: "Presente", value }] }],
    table: { columns: [{ key: "name", label: "Nome" }], rows: [{ name: "Pessoa de teste" }] }, notes: ["Dias sem lançamento permanecem pendentes."], operationHref: "/chamada-diaria",
  };
}
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
function metric() { return within(screen.getByRole("region", { name: "Indicadores de Chamada Diária" })); }
afterEach(() => vi.unstubAllGlobals());

describe("dashboards separados", () => {
  it("distingue ausência de dado, zero e duração negativa sem misturar formatos", () => {
    expect(dashboardValue(null, "minutes")).toBe("Não apurável");
    expect(dashboardValue(0, "minutes")).toBe("0h 00min");
    expect(dashboardValue(-481, "minutes")).toBe("−8h 01min");
    expect(dashboardValue(12.5, "percent")).toBe("12,5%");
    render(<DashboardApp domain="chamada-diaria" today={today} initialFilters={filters} initialSnapshot={snapshot()} />);
    expect(metric().getByText("Não apurável")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Dashboards por área" }).querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Abrir Chamada Diária" })).toHaveAttribute("href", "/chamada-diaria");
  });

  it("mantém o último painel e o filtro digitado quando a consulta falha", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "Consulta indisponível", correlationId: "synthetic-reference" }, 503)));
    render(<DashboardApp domain="chamada-diaria" today={today} initialFilters={filters} initialSnapshot={snapshot(12)} />);
    fireEvent.change(screen.getByLabelText("Colaborador"), { target: { value: "Filtro novo" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("synthetic-reference");
    expect(screen.getByLabelText("Colaborador")).toHaveValue("Filtro novo");
    expect(metric().getByText("12")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("última consulta concluída");
  });

  it("ignora resposta antiga e preserva texto digitado enquanto a consulta está em andamento", async () => {
    let first: (value: Response) => void = () => {};
    let second: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { first = resolve; })).mockImplementationOnce(() => new Promise<Response>((resolve) => { second = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DashboardApp domain="chamada-diaria" today={today} initialFilters={filters} initialSnapshot={snapshot(1)} />);
    const form = screen.getByRole("form", { name: "Filtros do dashboard de Chamada Diária" });
    fireEvent.submit(form);
    fireEvent.change(screen.getByLabelText("Colaborador"), { target: { value: "Segundo filtro" } });
    fireEvent.submit(form);
    fireEvent.change(screen.getByLabelText("Colaborador"), { target: { value: "Rascunho seguinte" } });
    await act(async () => second(response(snapshot(22))));
    await waitFor(() => expect(metric().getByText("22")).toBeInTheDocument());
    await act(async () => first(response(snapshot(11))));
    expect(metric().queryByText("11")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Colaborador")).toHaveValue("Rascunho seguinte");
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("exporta os filtros aplicados e mostra falha de exportação sem baixar resposta de erro", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ error: "Exportação indisponível" }, 503));
    vi.stubGlobal("fetch", fetchMock);
    render(<DashboardApp domain="chamada-diaria" today={today} initialFilters={{ ...filters, query: "Consulta aplicada" }} initialSnapshot={snapshot(3)} />);
    fireEvent.change(screen.getByLabelText("Colaborador"), { target: { value: "Rascunho não aplicado" } });
    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Exportação indisponível");
    const request = new URL(fetchMock.mock.calls[0][0], "http://localhost");
    expect(request.searchParams.get("query")).toBe("Consulta aplicada");
    expect(request.searchParams.get("format")).toBe("csv");
  });

  it("recusa período inválido antes de consultar e não fabrica painel após erro inicial", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<DashboardApp domain="chamada-diaria" today={today} initialFilters={filters} initialSnapshot={null} initialError="Falha na leitura" />);
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(screen.getByRole("alert")).toHaveTextContent("até 31 dias");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Indicadores de Chamada Diária" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeDisabled();
  });
});
