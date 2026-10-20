import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initialEmployees } from "@/lib/mock-daily-call";
import type { BankDay } from "@/lib/monitoring/bank-day";
import { PeriodGrid } from "./period-grid";

vi.mock("@/lib/data/daily-call-dates", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/data/daily-call-dates")>(),
  todayInSaoPaulo: () => "2026-10-20",
}));
const first = { ...initialEmployees[0], databaseId: "30000000-0000-4000-8000-000000000001", name: "Pessoa da noite" };
const second = { ...initialEmployees[1], databaseId: "30000000-0000-4000-8000-000000000002", name: "Outra pessoa" };
const props = { employees: [first, second], startDate: "2026-10-08", endDate: "2026-10-09", onSelect: vi.fn(), columnsCollapsed: true };
const day = (date: string, times: string[], extra: Partial<BankDay> = {}) => ({
  date, correctionVersion: null,
  bankDay: { state: "ready", reason: "Quatro batidas conferidas", expectedMinutes: 440, workedMinutes: 440, deltaMinutes: 0,
    punches: times.map((time, index) => ({ id: `punch-${index}`, at: Date.parse(`${time}-03:00`), sourceId: index % 2 ? "clock-pis" : "clock-cpf" })),
    slots: [], missingRole: null, suggestions: [], suppressedIds: [], ...extra } satisfies BankDay,
});
const snapshot = (days: ReturnType<typeof day>[]) => ({ days, bank: null, canEdit: false, correctionHistory: [] });
const ok = (data: ReturnType<typeof snapshot>) => ({ ok: true, json: async () => data });
afterEach(() => vi.unstubAllGlobals());
const renderGrid = (overrides = {}) => render(<TooltipProvider><PeriodGrid {...props} {...overrides} /></TooltipProvider>);

it("carrega somente ao expandir e alinha batidas dos dois relógios à data operacional noturna", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn().mockResolvedValue(ok(snapshot([
    day("2026-10-08", ["2026-10-08T22:00:00", "2026-10-09T01:00:00", "2026-10-09T02:00:00", "2026-10-09T06:20:00"]),
    day("2026-10-09", []),
  ])));
  vi.stubGlobal("fetch", fetcher);
  const view = renderGrid();
  expect(fetcher).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Expandir batidas de Pessoa da noite" }));
  const row = await screen.findByRole("row", { name: "Batidas de Pessoa da noite" });
  const cell = await within(row).findByRole("cell", { name: "Pessoa da noite, batidas de 08/10/2026" });
  expect([...cell.querySelectorAll("time")].map(mark => mark.textContent)).toEqual(["22:00", "01:00", "02:00", "06:20"]);
  expect(within(cell).getByLabelText("09/10/2026, 06:20")).toHaveAttribute("datetime", "2026-10-09T09:20:00.000Z");
  expect(within(row).getByRole("cell", { name: "Pessoa da noite, batidas de 09/10/2026" })).toHaveTextContent("—");
  expect(within(row).getByRole("rowheader")).toHaveAttribute("colspan", "1");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toContain(`employeeId=${first.databaseId}&start=2026-10-08&end=2026-10-09`);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  expect(screen.getByRole("button", { name: "Expandir batidas de Outra pessoa" })).toHaveAttribute("aria-expanded", "false");
  expect(props.onSelect).not.toHaveBeenCalled();
  view.rerender(<TooltipProvider><PeriodGrid {...props} columnsCollapsed={false} fillHeight /></TooltipProvider>);
  expect(within(row).getByRole("rowheader")).toHaveAttribute("colspan", "7");
  expect(fetcher).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Recolher batidas de Pessoa da noite" }));
  expect(screen.queryByRole("row", { name: "Batidas de Pessoa da noite" })).not.toBeInTheDocument();
});

it("mostra batida faltante sem preencher sugestão do torniquete automaticamente", async () => {
  const user = userEvent.setup();
  const times = ["2026-10-08T14:00:00", "2026-10-08T19:00:00", "2026-10-08T22:20:00"];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(snapshot([day("2026-10-08", times, {
    state: "pending", missingRole: "breakStart",
    slots: [{ role: "start", at: Date.parse(`${times[0]}-03:00`) }, { role: "breakStart", at: null }, { role: "breakEnd", at: Date.parse(`${times[1]}-03:00`) }, { role: "end", at: Date.parse(`${times[2]}-03:00`) }],
    suggestions: [{ at: Date.parse("2026-10-08T18:00:00-03:00"), eventId: "access", pointId: "torniquete", direction: "exit", differenceMinutes: 0 }],
  })]))));
  renderGrid();
  await user.click(screen.getByRole("button", { name: "Expandir batidas de Pessoa da noite" }));
  expect(await screen.findByLabelText("Saída para intervalo: batida faltante")).toHaveTextContent("--:--");
  expect(screen.queryByText("18:00")).not.toBeInTheDocument();
  expect(screen.getByText("19:00")).toBeInTheDocument();
});

it("falha não aparece como dia sem batidas e permite nova consulta", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Seu perfil não permite esta operação." }) }).mockResolvedValueOnce(ok(snapshot([day("2026-10-08", ["2026-10-08T08:00:00", "2026-10-08T17:00:00"])])));
  vi.stubGlobal("fetch", fetcher);
  renderGrid();
  await user.click(screen.getByRole("button", { name: "Expandir batidas de Pessoa da noite" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Seu perfil não permite esta operação.");
  expect(screen.queryByLabelText("Sem batidas no histórico")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Tentar carregar batidas de Pessoa da noite novamente" }));
  expect(await screen.findByText("08:00")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("aborta o período anterior e nunca mostra sua resposta atrasada em outra data", async () => {
  const user = userEvent.setup();
  let resolveOld!: (value: ReturnType<typeof ok>) => void;
  const old = new Promise<ReturnType<typeof ok>>(resolve => { resolveOld = resolve; });
  const fetcher = vi.fn().mockReturnValueOnce(old).mockResolvedValueOnce(ok(snapshot([day("2026-10-10", ["2026-10-10T10:00:00"])])));
  vi.stubGlobal("fetch", fetcher);
  const view = renderGrid();
  await user.click(screen.getByRole("button", { name: "Expandir batidas de Pessoa da noite" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
  view.rerender(<TooltipProvider><PeriodGrid {...props} startDate="2026-10-10" endDate="2026-10-11" /></TooltipProvider>);
  expect(await screen.findByText("10:00")).toBeInTheDocument();
  expect(signal.aborted).toBe(true);
  await act(async () => { resolveOld(ok(snapshot([day("2026-10-08", ["2026-10-08T08:00:00"])]))); await old; });
  expect(screen.queryByText("08:00")).not.toBeInTheDocument();
  expect(screen.getByText("10:00")).toBeInTheDocument();
});

it("limita consulta ao dia atual sem deslocar as colunas futuras do fechamento", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn().mockResolvedValue(ok(snapshot([day("2026-10-20", ["2026-10-20T08:00:00"])])));
  vi.stubGlobal("fetch", fetcher);
  renderGrid({ startDate: "2026-10-19", endDate: "2026-11-18" });
  await user.click(screen.getByRole("button", { name: "Expandir batidas de Pessoa da noite" }));
  expect(await screen.findByText("08:00")).toBeInTheDocument();
  expect(fetcher.mock.calls[0][0]).toContain("start=2026-10-19&end=2026-10-20");
  const row = screen.getByRole("row", { name: "Batidas de Pessoa da noite" });
  expect(within(row).getAllByRole("cell")).toHaveLength(31);
  expect(within(row).getByRole("cell", { name: "Pessoa da noite, batidas de 18/11/2026" })).toHaveTextContent("—");
});

it("não busca períodos totalmente futuros", async () => {
  const user = userEvent.setup(), fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  renderGrid({ startDate: "2026-10-21", endDate: "2026-11-20" });
  await user.click(screen.getByRole("button", { name: "Expandir batidas de Pessoa da noite" }));
  expect(fetcher).not.toHaveBeenCalled();
  expect(within(screen.getByRole("row", { name: "Batidas de Pessoa da noite" })).getAllByLabelText("Data futura")).toHaveLength(31);
});
