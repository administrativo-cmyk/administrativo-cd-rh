import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyCallPending } from "./daily-call-pending";
import type { DailyCallWorkflowSnapshot } from "@/lib/daily-call-workflow";

const employeeId = "30000000-0000-4000-8000-000000000001";
const managerId = "20000000-0000-4000-8000-000000000001";
const date = "2026-10-01";
const counts = { total: 1, present: 0, automaticAbsence: 0, manual: 0, pending: 1, blocked: 0 };
const snapshot: DailyCallWorkflowSnapshot = {
  start: date, end: date, revision: "revision-one", counts,
  days: [{ ...counts, date, managerId, managerName: "Gestor Sintético", closedAt: null }],
  rows: [{ employeeId, name: "Pessoa Pendente", employeeNumber: "FICT-1", date, managerId, managerName: "Gestor Sintético", status: null, origin: null, state: "pending_manager", balanceMinutes: 481, blockers: [], updatedAt: null, decisionVersion: "decision-one" }],
};
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(snapshot))));
afterEach(() => vi.useRealTimers());

describe("fila da chamada", () => {
  it("compacta 528 grupos, filtra e pagina localmente sem alterar totais ou o escopo da revisão", async () => {
    const user = userEvent.setup();
    const days = Array.from({ length: 16 }, (_, dayIndex) => Array.from({ length: 33 }, (_, managerIndex) => ({
      ...counts, date: `2026-10-${String(dayIndex + 1).padStart(2, "0")}`,
      managerId: `20000000-0000-4000-8000-${String(managerIndex + 1).padStart(12, "0")}`,
      managerName: `Gestor ${String(managerIndex + 1).padStart(2, "0")}`, closedAt: null,
    }))).flat();
    const largeSnapshot = { ...snapshot, end: "2026-10-16", days, counts: { ...counts, total: 528, pending: 528 } };
    vi.mocked(fetch).mockImplementation(async (url) => {
      const parameters = new URL(String(url), "http://localhost").searchParams;
      if (parameters.has("managerId")) {
        const selectedDay = days.find((day) => day.managerId === parameters.get("managerId") && day.date === parameters.get("start"))!;
        return response({ ...snapshot, start: selectedDay.date, end: selectedDay.date, days: [selectedDay], rows: [{ ...snapshot.rows[0], date: selectedDay.date, managerId: selectedDay.managerId, managerName: selectedDay.managerName }] });
      }
      return response(largeSnapshot);
    });
    render(<DailyCallPending start={date} end="2026-10-16" canWrite onChanged={vi.fn()} />);
    expect(await screen.findByText("1–8 de 528 grupos")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Revisar .* de Gestor/ })).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Página anterior da fila" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Próxima página da fila" }));
    expect(screen.getByText("9–16 de 528 grupos")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Gestor da revisão" }), days[32].managerId);
    expect(screen.getByText("1–8 de 16 grupos · 528 no período")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Próxima página da fila" }));
    expect(screen.getByText("9–16 de 16 grupos · 528 no período")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Dia da revisão" }), "2026-10-16");
    expect(screen.getByText("1–1 de 1 grupo · 528 no período")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima página da fila" })).toBeDisabled();
    expect(screen.getByText(/aguardando gestor/, { selector: "span" })).toHaveTextContent("528 aguardando gestor");
    expect(fetch).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Revisar 16/10/2026 de Gestor 33" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`start=2026-10-16&end=2026-10-16&offset=0&limit=50&managerId=${days[32].managerId}`), expect.anything()));
  });
  it("restringe a consulta e seus contadores aos dias encerrados do mês", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T12:00:00-03:00"));
    vi.mocked(fetch).mockResolvedValue(response({ ...snapshot, start: "2026-10-01", end: "2026-10-16" }));
    render(<DailyCallPending start="2026-10-01" end="2026-10-31" canWrite onChanged={vi.fn()} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("start=2026-10-01&end=2026-10-16"), expect.anything()));
    expect(screen.getByText(/Período de revisão: 01\/10\/2026 a 16\/10\/2026/)).toBeInTheDocument();
  });
  it("período futuro não oferece revisão nem consulta uma fila inventada", async () => {
    render(<DailyCallPending start="2099-01-01" end="2099-01-31" canWrite onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText("Consultando pendências…")).not.toBeInTheDocument());
    expect(screen.getByText(/Não há dias encerrados no período selecionado/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Revisar .* de/ })).not.toBeInTheDocument();
  });
  it("consulta sem gravar, mantém saldo acima de oito horas branco e preserva decisão após conflito", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockImplementation(async (_url, init) => response(init?.method === "POST" ? { error: "O dia mudou", correlationId: "fixture-ref" } : snapshot, init?.method !== "POST"));
    render(<DailyCallPending start={date} end={date} canWrite onChanged={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Revisar 01/10/2026 de Gestor Sintético" }));
    expect(await screen.findByText("Em branco")).toBeInTheDocument();
    expect(screen.getByText(/Saldo: 8h 01min/)).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method)).toBe(true);
    expect(screen.getByRole("button", { name: "Finalizar revisão" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Revisar lançamento de Pessoa Pendente" }));
    const form = within(screen.getByRole("form", { name: "Decisão de Pessoa Pendente" }));
    expect(form.getByRole("combobox", { name: "Ocorrência" })).toHaveValue("");
    await user.selectOptions(form.getByRole("combobox", { name: "Ocorrência" }), "G");
    await user.type(form.getByRole("textbox", { name: "Justificativa da decisão" }), "Compensação conferida pelo gestor");
    await user.click(form.getByRole("button", { name: "Salvar decisão" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("fixture-ref");
    expect(form.getByRole("textbox", { name: "Justificativa da decisão" })).toHaveValue("Compensação conferida pelo gestor");
    const body = JSON.parse(vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")![1]!.body as string);
    expect(body).toMatchObject({ action: "resolve", data: { employeeId, date, status: "G", expectedUpdatedAt: null, expectedDecisionVersion: "decision-one" } });
  });
  it("finalização exige revisão explícita e envia versão do resumo sem gerar códigos", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const doneCounts = { ...counts, pending: 0, present: 1 };
    const done = { ...snapshot, counts: doneCounts, days: [{ ...snapshot.days[0], ...doneCounts }], rows: [{ ...snapshot.rows[0], status: "P", origin: "punch", state: "present" }] };
    vi.mocked(fetch).mockImplementation(async (_url, init) => response(init?.method === "POST" ? { closed: true } : done));
    render(<DailyCallPending start={date} end={date} canWrite onChanged={onChanged} />);
    await user.click(await screen.findByRole("button", { name: "Revisar 01/10/2026 de Gestor Sintético" }));
    const form = within(await screen.findByRole("form", { name: "Finalizar revisão do dia" }));
    expect(form.getByRole("button", { name: "Finalizar revisão" })).toBeDisabled();
    await user.type(form.getByRole("textbox", { name: "Resumo da revisão" }), "Equipe e ocorrências conferidas");
    await user.click(form.getByRole("checkbox", { name: "Conferi as ocorrências e justificativas deste dia." }));
    await user.click(form.getByRole("button", { name: "Finalizar revisão" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    const body = JSON.parse(vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")![1]!.body as string);
    expect(body).toEqual({ action: "close", data: { date, managerId, expectedRevision: "revision-one", reason: "Equipe e ocorrências conferidas" } });
    expect(body.data).not.toHaveProperty("status");
  });
  it("consulta LEITURA não oferece gravação e bloqueios continuam explícitos", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(response({ ...snapshot, rows: [{ ...snapshot.rows[0], state: "blocked", blockers: ["COVERAGE_MISSING"] }] }));
    render(<DailyCallPending start={date} end={date} canWrite={false} onChanged={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Revisar 01/10/2026 de Gestor Sintético" }));
    expect(await screen.findByText("Cobertura do ponto não confirmada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Revisar lançamento/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finalizar revisão" })).not.toBeInTheDocument();
  });
});
