import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initialEmployees } from "@/lib/mock-daily-call";
import type { BankDay } from "@/lib/monitoring/bank-day";
import type { z } from "zod";
import type { attendanceHistorySnapshotSchema } from "@/lib/monitoring/attendance-history-contracts";
import { PeriodGrid } from "./period-grid";

vi.mock("@/lib/data/daily-call-dates", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/data/daily-call-dates")>();
  return { ...original, todayInSaoPaulo: (now?: Date) => now ? original.todayInSaoPaulo(now) : "2026-10-20" };
});
const first = { ...initialEmployees[0], databaseId: "30000000-0000-4000-8000-000000000001", name: "Pessoa da noite" };
const second = { ...initialEmployees[1], databaseId: "30000000-0000-4000-8000-000000000002", name: "Outra pessoa" };
const props = { employees: [first, second], startDate: "2026-10-08", endDate: "2026-10-09", onSelect: vi.fn(), columnsCollapsed: true };
const day = (date: string, times: string[], extra: Partial<BankDay> = {}) => ({
  date, correctionVersion: null,
  bankDay: { state: "ready", reason: "Quatro batidas conferidas", expectedMinutes: 440, workedMinutes: 440, deltaMinutes: 0,
    punches: times.map((time, index) => ({ id: `punch-${index}`, at: Date.parse(`${time}-03:00`), sourceId: index % 2 ? "clock-pis" : "clock-cpf" })),
    slots: [], missingRole: null, suggestions: [], suppressedIds: [], ...extra } satisfies BankDay,
});
const snapshot = (days: z.infer<typeof attendanceHistorySnapshotSchema>["days"]) => ({ days, bank: null, canEdit: false, correctionHistory: [] });
const ok = (data: ReturnType<typeof snapshot>) => ({ ok: true, json: async () => data });
afterEach(() => vi.unstubAllGlobals());
const renderGrid = (overrides = {}) => render(<TooltipProvider><PeriodGrid {...props} {...overrides} /></TooltipProvider>);

it("identifica horário sugerido pelo torniquete em vermelho com legenda e nome acessível", async () => {
  const user=userEvent.setup();
  const source=day("2026-10-08",["2026-10-08T10:00:00"]);
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(ok(snapshot([{...source,displayMarks:[{at:Date.parse("2026-10-08T10:00:00-03:00")},{at:Date.parse("2026-10-08T18:10:00-03:00"),role:"end",origin:"turnstile",eventId:"access",pointId:"Saída operação"}]}]))));
  renderGrid();await user.click(screen.getByRole("button",{name:"Expandir batidas de Pessoa da noite"}));
  const suggested=await screen.findByLabelText(/Saída sugerida pelo torniquete, não é batida do relógio/);
  expect(suggested).toHaveClass("text-red-700");expect(suggested).toHaveTextContent("18:10");expect(suggested).toHaveTextContent("T");
  expect(screen.getByText("Vermelho + T: saída sugerida do torniquete")).toBeVisible();
});

it("carrega somente ao expandir e alinha batidas dos dois relógios à data operacional noturna", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn().mockResolvedValue(ok(snapshot([
    day("2026-10-08", ["2026-10-08T22:00:00", "2026-10-09T01:00:00", "2026-10-09T02:00:00", "2026-10-09T06:20:00"]),
    day("2026-10-09", []),
  ])));
  vi.stubGlobal("fetch", fetcher);
  const view = renderGrid();
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.getByRole("table").style.minWidth).toContain("28px");
  await user.click(screen.getByRole("button", { name: "Expandir batidas de Pessoa da noite" }));
  const row = await screen.findByRole("row", { name: "Batidas de Pessoa da noite" });
  const cell = await within(row).findByRole("cell", { name: "Pessoa da noite, batidas de 08/10/2026" });
  expect([...cell.querySelectorAll("time")].map(mark => mark.textContent)).toEqual(["22:00", "01:00 S", "02:00 S", "06:20 S"]);
  expect(screen.getByRole("table").style.minWidth).toContain("40px");
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

it("mostra agrupamento histórico antes da vigência e não repete saída no dia seguinte", async () => {
  const user = userEvent.setup();
  const source = day("2026-10-08", ["2026-10-08T18:56:00", "2026-10-08T20:23:00", "2026-10-08T21:23:00"]);
  const next = day("2026-10-09", ["2026-10-09T07:01:00"]);
  const reason = "Batidas noturnas agrupadas na data da entrada";
  const response = snapshot([
    { ...source, displayMarks: [...source.bankDay.punches, ...next.bankDay.punches], displayReason: reason },
    { ...next, displayMarks: [], displayReason: reason },
  ]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(response)));
  renderGrid();
  await user.click(screen.getByRole("button", { name: "Expandir batidas de Pessoa da noite" }));
  const row = await screen.findByRole("row", { name: "Batidas de Pessoa da noite" });
  const entry = await within(row).findByRole("cell", { name: "Pessoa da noite, batidas de 08/10/2026" });
  await waitFor(() => expect(entry.querySelectorAll("time")).toHaveLength(4));
  expect([...entry.querySelectorAll("time")].map(mark => mark.textContent)).toEqual(["18:56", "20:23", "21:23", "07:01 S"]);
  expect(within(row).getByRole("cell", { name: "Pessoa da noite, batidas de 09/10/2026" })).toHaveTextContent("—");
  expect(within(entry).getByText("07:01 S")).toHaveAttribute("title", "09/10/2026, 07:01 · sexta-feira");
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

it("expande todos pelo cabeçalho, mantém controles individuais e recolhe todos", async () => {
  const user = userEvent.setup(), fetcher = vi.fn().mockResolvedValue(ok(snapshot([])));
  vi.stubGlobal("fetch", fetcher);
  const unsynced = { ...initialEmployees[2], name: "Sem cadastro sincronizado", databaseId: undefined };
  const view = renderGrid({ employees: [first, second, unsynced] });
  const heading = screen.getByRole("columnheader", { name: /Colaborador/ });
  const expandAll = within(heading).getByRole("button", { name: "Expandir batidas de todos os colaboradores" });
  await user.click(expandAll);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(screen.getAllByRole("row", { name: /^Batidas de/ })).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Expandir batidas de Sem cadastro sincronizado" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Recolher batidas de todos os colaboradores" })).toHaveAttribute("aria-expanded", "true");
  view.rerender(<TooltipProvider><PeriodGrid {...props} employees={[first, second, unsynced]} columnsCollapsed={false} fillHeight managerGroups={[["Equipe", [first, second, unsynced]]]} /></TooltipProvider>);
  expect(screen.getAllByRole("row", { name: /^Batidas de/ })).toHaveLength(2);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
  await user.click(screen.getByRole("button", { name: "Recolher batidas de Pessoa da noite" }));
  expect(screen.getAllByRole("row", { name: /^Batidas de/ })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Expandir batidas de todos os colaboradores" }));
  expect(screen.getAllByRole("row", { name: /^Batidas de/ })).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Recolher batidas de todos os colaboradores" }));
  expect(screen.queryByRole("row", { name: /^Batidas de/ })).not.toBeInTheDocument();
});

it("expande somente a lista filtrada e desabilita ação quando não há cadastro sincronizado", async () => {
  const user = userEvent.setup(), fetcher = vi.fn().mockResolvedValue(ok(snapshot([])));
  vi.stubGlobal("fetch", fetcher);
  const view = renderGrid({ employees: [second] });
  await user.click(screen.getByRole("button", { name: "Expandir batidas de todos os colaboradores" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  expect(fetcher.mock.calls[0][0]).toContain(`employeeId=${second.databaseId}`);
  expect(screen.queryByRole("row", { name: "Batidas de Pessoa da noite" })).not.toBeInTheDocument();
  view.rerender(<TooltipProvider><PeriodGrid {...props} employees={[{ ...first, databaseId: undefined }]} /></TooltipProvider>);
  expect(screen.getByRole("button", { name: "Expandir batidas de todos os colaboradores" })).toBeDisabled();
});

it("limita consultas simultâneas e cancela a fila ao recolher todos", async () => {
  const user = userEvent.setup();
  const people = Array.from({ length: 8 }, (_, index) => ({ ...first, id: `person-${index}`, databaseId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, name: `Pessoa ${index}` }));
  const pending: Array<{ resolve: (value: ReturnType<typeof ok>) => void; signal: AbortSignal }> = [];
  const fetcher = vi.fn((_url: string, options: { signal: AbortSignal }) => new Promise((resolve, reject) => {
    pending.push({ resolve, signal: options.signal });
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  }));
  vi.stubGlobal("fetch", fetcher);
  renderGrid({ employees: people });
  await user.click(screen.getByRole("button", { name: "Expandir batidas de todos os colaboradores" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
  expect(screen.getAllByRole("row", { name: /^Batidas de/ })).toHaveLength(8);
  await act(async () => pending[0].resolve(ok(snapshot([]))));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(5));
  await user.click(screen.getByRole("button", { name: "Recolher batidas de todos os colaboradores" }));
  expect(screen.queryByRole("row", { name: /^Batidas de/ })).not.toBeInTheDocument();
  expect(pending.every(request => request.signal.aborted)).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(5);
});
