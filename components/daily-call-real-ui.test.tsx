import { render, screen } from "@testing-library/react";
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
});
