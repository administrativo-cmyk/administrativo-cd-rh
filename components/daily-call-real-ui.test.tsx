import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TodayTable } from "./today-table";
import { PeriodGrid } from "./period-grid";
import { mapDailyCallSnapshot } from "@/lib/data/daily-call-snapshot";

const snapshot = mapDailyCallSnapshot({
  date: "2026-10-05", startDate: "2026-10-01", endDate: "2026-10-31",
  employees: [{
    id: "00000000-0000-4000-8000-000000000001", employeeNumber: "FICT-1", name: "Colaborador Fictício",
    unit: "CD I", department: "Operação", role: "Auxiliar", situation: "ATIVO", manager: null,
    admissionDate: "2025-01-01", measurementDate: null, effectiveFrom: null, workdayHours: null,
    balanceMinutes: null, balanceDays: null, usedCompensationDays: 0,
    pendingCompensationDays: null, replacementDays: null, attendance: [],
  }],
});

describe("Chamada real sem gravação", () => {
  it("mostra Não lançado e Sem extrato, com observação desabilitada", () => {
    render(<TooltipProvider><TodayTable employees={snapshot.employees} date={snapshot.date} onSelect={vi.fn()} /></TooltipProvider>);
    expect(screen.getAllByText("Não lançado").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sem extrato").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Observação de Colaborador Fictício").every((input) => input.hasAttribute("disabled"))).toBe(true);
    expect(screen.queryByRole("button", { name: "Status de Colaborador Fictício" })).not.toBeInTheDocument();
  });

  it("mantém a grade do período sem fabricar códigos", () => {
    render(<TooltipProvider><PeriodGrid employees={snapshot.employees} startDate="2026-10-01" endDate="2026-10-03" onSelect={vi.fn()} /></TooltipProvider>);
    expect(screen.getByTestId("period-grid")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });
  it("distingue presença do ponto, falta automática e revisão manual", () => {
    const employees = (["punch", "automatic_absence", "manual"] as const).map((origin, index) => ({ ...snapshot.employees[0], id: `FICT-${index}`, attendance: { [snapshot.date]: origin === "automatic_absence" ? "I" as const : "P" as const }, attendanceSources: { [snapshot.date]: origin } }));
    render(<TooltipProvider><TodayTable employees={employees} date={snapshot.date} onSelect={vi.fn()} /></TooltipProvider>);
    for (const label of ["Pelo ponto", "Falta automática", "Revisão manual"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });
});

describe("controles ADMIN da Chamada Diária", () => {
  it("salva status e limpa no modo Hoje", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    render(<TooltipProvider><TodayTable employees={snapshot.employees} date={snapshot.date} onSelect={vi.fn()} readOnly={false} onSave={onSave} /></TooltipProvider>);
    await user.click(screen.getAllByRole("button", { name: "Status de Colaborador Fictício" })[0]);
    await user.click(screen.getByRole("button", { name: /PPresente/ }));
    expect(onSave).toHaveBeenCalledWith(snapshot.employees[0], snapshot.date, "P", null);
  });

  it("salva o dia exato do Período e desabilita a célula em salvamento", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    render(<TooltipProvider><PeriodGrid employees={snapshot.employees} startDate="2026-10-01" endDate="2026-10-03" onSelect={vi.fn()} readOnly={false} onSave={onSave} isSaving={(_, date) => date === "2026-10-02"} /></TooltipProvider>);
    expect(screen.getByRole("button", { name: "Colaborador Fictício, dia 02" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Colaborador Fictício, dia 03" }));
    await user.click(screen.getByRole("button", { name: /FFolga/ }));
    expect(onSave).toHaveBeenCalledWith(snapshot.employees[0], "2026-10-03", "F", null);
  });

  it("permite observação somente mediante status e limpa pelo picker", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    const employee = { ...snapshot.employees[0], attendance: { [snapshot.date]: "P" as const } };
    render(<TooltipProvider><TodayTable employees={[employee]} date={snapshot.date} onSelect={vi.fn()} readOnly={false} onSave={onSave} /></TooltipProvider>);
    const observation = screen.getAllByRole("textbox", { name: "Observação de Colaborador Fictício" })[0];
    await user.type(observation, "  teste  ");
    await user.tab();
    expect(onSave).toHaveBeenCalledWith(employee, snapshot.date, "P", "teste");
    await user.click(screen.getAllByRole("button", { name: "Status de Colaborador Fictício" })[0]);
    await user.click(screen.getByRole("button", { name: "Limpar lançamento" }));
    expect(onSave).toHaveBeenCalledWith(employee, snapshot.date, null, null);
  });
});
