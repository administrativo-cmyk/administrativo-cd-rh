import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdministrationVacation } from "@/lib/administration/contracts";
import { VacationCalendar } from "./vacation-calendar";
import { adjacentMonth, loadVacationCalendar, monthDays, vacationCalendarSummary, type VacationCalendarFilters, type VacationCalendarSnapshot } from "./vacation-calendar-data";

const personId = "11111111-1111-4111-8111-111111111111";
const managerId = "22222222-2222-4222-8222-222222222222";
const unitId = "33333333-3333-4333-8333-333333333333";
const otherId = "44444444-4444-4444-8444-444444444444";
function row(index = 1, overrides: Partial<AdministrationVacation> = {}): AdministrationVacation {
  return { id: `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`, employeeId: personId, employeeName: "Pessoa de teste", employeeNumber: "0001", managerId, unitId, startDate: "2026-10-16", endDate: "2026-10-18", status: "approved", acquisitionStart: null, acquisitionEnd: null, observation: null, createdBy: personId, updatedAt: "2026-10-17T15:00:00Z", createdAt: "2026-10-17T15:00:00Z", archivedAt: null, approvedBy: null, approvedAt: null, canEdit: true, ...overrides };
}
function snapshot(rows = [row()], total = rows.length): VacationCalendarSnapshot {
  return { entity: "vacation", datasetVersion: "fixture-v1", rows, total, options: { units: [{ id: unitId, name: "Unidade de teste", code: "TEST", active: true }], managers: [{ id: managerId, name: "Gestor de teste", active: true }], employees: [{ id: personId, name: "Pessoa de teste", employeeNumber: "0001", managerId, unitId, activeInSystem: true }, { id: otherId, name: "Pessoa sem gestor", employeeNumber: "0002", managerId: null, unitId, activeInSystem: true }] }, permissions: { canManageRegisters: true, canApproveVacation: true, canProposeVacation: true } };
}
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
const filters: VacationCalendarFilters = { month: "2026-10", managerId: "", unitId: "", status: "planned", query: "" };
afterEach(() => vi.unstubAllGlobals());

describe("calendário de férias completo", () => {
  it("carrega todas as páginas antes de retornar contagens mensais", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => row(index + 1));
    const fetcher = vi.fn().mockResolvedValueOnce(response(snapshot(rows.slice(0, 500), 501))).mockResolvedValueOnce(response(snapshot(rows.slice(500), 501)));
    const result = await loadVacationCalendar(new AbortController().signal, fetcher);
    expect(result.rows).toHaveLength(501);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).data).toMatchObject({ offset: 500, limit: 500, includeArchived: false });
    expect(vacationCalendarSummary(result, filters).approved).toBe(1);
  });

  it("recusa conjunto incompleto ou alterado sem publicar totais parciais", async () => {
    const changed = vi.fn().mockResolvedValueOnce(response(snapshot([row()], 2))).mockResolvedValueOnce(response(snapshot([row(2)], 3)));
    await expect(loadVacationCalendar(new AbortController().signal, changed)).rejects.toThrow("mudaram");
    const changedVersion = vi.fn().mockResolvedValueOnce(response(snapshot([row()], 2))).mockResolvedValueOnce(response({ ...snapshot([row(2)], 2), datasetVersion: "fixture-v2" }));
    await expect(loadVacationCalendar(new AbortController().signal, changedVersion)).rejects.toThrow("mudaram");
    const repeated = vi.fn().mockResolvedValueOnce(response(snapshot([row()], 2))).mockResolvedValueOnce(response(snapshot([row()], 2)));
    await expect(loadVacationCalendar(new AbortController().signal, repeated)).rejects.toThrow("mudaram");
    const missing = vi.fn().mockResolvedValueOnce(response(snapshot([row()], 2))).mockResolvedValueOnce(response(snapshot([], 2)));
    await expect(loadVacationCalendar(new AbortController().signal, missing)).rejects.toThrow("todas as programações");
  });

  it("conta pessoas únicas, inclui períodos que atravessam o mês e separa situações", () => {
    const rows = [row(1, { startDate: "2026-09-30", endDate: "2026-10-02" }), row(2, { startDate: "2026-10-01", endDate: "2026-10-02" }), row(3, { employeeId: otherId, employeeNumber: "0002", managerId: null, status: "requested", startDate: "2026-10-01", endDate: "2026-10-05" }), row(4, { status: "cancelled" }), row(5, { archivedAt: "2026-10-17T15:00:00Z" }), row(6, { startDate: "2026-11-01", endDate: "2026-11-03" })];
    const view = vacationCalendarSummary(snapshot(rows), filters);
    expect(view.rows).toHaveLength(3);
    expect(view).toMatchObject({ approved: 1, requested: 1, peak: 1, workforce: 2 });
    expect(view.days[0]).toMatchObject({ approved: 1, requested: 1 });
    const noManager = vacationCalendarSummary(snapshot(rows), { ...filters, managerId: "none" });
    expect(noManager).toMatchObject({ approved: 0, requested: 1, workforce: 1 });
    expect(vacationCalendarSummary(snapshot(rows), { ...filters, query: "0001" }).rows).toHaveLength(2);
    expect(monthDays("2024-02")).toHaveLength(29);
    expect(monthDays("2026-13")).toEqual([]);
    expect(adjacentMonth("2026-12", 1)).toBe("2027-01");
  });

  it("não exibe números durante paginação e preserva mês digitado ao concluir", async () => {
    let finish: (value: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(snapshot([row()], 2))).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })));
    render(<VacationCalendar today="2026-10-17" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("region", { name: "Resumo mensal de férias" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mês", { exact: true }), { target: { value: "2026-11" } });
    await act(async () => finish(response(snapshot([row(2, { startDate: "2026-11-01", endDate: "2026-11-03" })], 2))));
    expect(await screen.findByRole("region", { name: "Resumo mensal de férias" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mês", { exact: true })).toHaveValue("2026-11");
    expect(screen.getByRole("heading", { name: "novembro de 2026" })).toBeInTheDocument();
  });

  it("mantém último calendário e filtros ao falhar atualização", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(snapshot())).mockResolvedValueOnce(response({ error: "Administração indisponível" }, 503)));
    render(<VacationCalendar today="2026-10-17" />);
    await screen.findByRole("region", { name: "Resumo mensal de férias" });
    fireEvent.change(screen.getByLabelText("Colaborador"), { target: { value: "Pessoa" } });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("última consulta concluída");
    expect(screen.getByLabelText("Colaborador")).toHaveValue("Pessoa");
    expect(within(screen.getByRole("region", { name: "Programações do dia selecionado" })).getByText("Pessoa de teste")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Gerenciar programações" })).toHaveAttribute("href", "/planejamento/ferias");
  });

  it("mostra falha inicial sem transformar erro em calendário vazio", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "Instalação pendente" }, 503)));
    render(<VacationCalendar today="2026-10-17" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Nenhuma contagem foi apurada");
    expect(screen.queryByRole("region", { name: "Resumo mensal de férias" })).not.toBeInTheDocument();
  });
});
