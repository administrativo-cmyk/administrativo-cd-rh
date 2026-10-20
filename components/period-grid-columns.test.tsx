import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initialEmployees } from "@/lib/mock-daily-call";
import { PeriodGrid } from "./period-grid";

const employee = { ...initialEmployees[0], attendance: { "2026-10-20": "P" as const } };
const props = { employees: [employee], startDate: "2026-09-21", endDate: "2026-10-20", onSelect: vi.fn() };

it("recolhe os dados ao lado de Situação, mantém todos os dias e restaura as colunas", async () => {
  const user = userEvent.setup(), save = vi.fn();
  render(<TooltipProvider><PeriodGrid {...props} onSave={save} /></TooltipProvider>);
  expect(within(screen.getByRole("columnheader", { name: /Situação/ })).getByRole("button", { name: "Recolher colunas de dados" })).toBeInTheDocument();
  expect(screen.getAllByRole("columnheader")).toHaveLength(37);
  await user.click(screen.getByRole("button", { name: "Recolher colunas de dados" }));
  expect(screen.getByRole("button", { name: "Mostrar colunas de dados" })).toHaveFocus();
  expect(screen.getAllByRole("columnheader")).toHaveLength(31);
  for (const name of ["Matrícula", "Gestor", "Férias previstas", "BH em dias", "A compensar / repor", "Situação"]) expect(screen.queryByRole("columnheader", { name })).not.toBeInTheDocument();
  expect(screen.getByLabelText(`${employee.name}, dia 21`)).toBeInTheDocument();
  expect(screen.getByLabelText(`${employee.name}, dia 20`)).toHaveTextContent("P");
  expect(save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Mostrar colunas de dados" }));
  expect(screen.getByRole("columnheader", { name: "Matrícula" })).toBeInTheDocument();
  expect(screen.getAllByRole("columnheader")).toHaveLength(37);
});

it("mantém seleção, edição do dia correto e modo recolhido ao entrar em tela cheia", async () => {
  const user = userEvent.setup(), save = vi.fn().mockResolvedValue(true), select = vi.fn();
  const view = render(<TooltipProvider><PeriodGrid {...props} readOnly={false} onSave={save} onSelect={select} /></TooltipProvider>);
  await user.click(screen.getByRole("button", { name: "Recolher colunas de dados" }));
  view.rerender(<TooltipProvider><PeriodGrid {...props} fillHeight readOnly={false} onSave={save} onSelect={select} /></TooltipProvider>);
  expect(screen.getByRole("button", { name: "Mostrar colunas de dados" })).toHaveAttribute("aria-expanded", "false");
  await user.click(screen.getByRole("button", { name: `Abrir detalhes de ${employee.name}` }));
  expect(select).toHaveBeenCalledWith(employee);
  await user.click(screen.getByRole("button", { name: `${employee.name}, dia 20` }));
  await user.click(screen.getByRole("button", { name: /FFolga/ }));
  expect(save).toHaveBeenCalledWith(employee, "2026-10-20", "F", null);
});

it("recebe preferência controlada e comunica a alteração para persistência pelo usuário", async () => {
  const user = userEvent.setup(), change = vi.fn();
  const view = render(<TooltipProvider><PeriodGrid {...props} columnsCollapsed onColumnsCollapsedChange={change} /></TooltipProvider>);
  expect(screen.getAllByRole("columnheader")).toHaveLength(31);
  await user.click(screen.getByRole("button", { name: "Mostrar colunas de dados" }));
  expect(change).toHaveBeenCalledWith(false);
  expect(screen.getAllByRole("columnheader")).toHaveLength(31);
  view.rerender(<TooltipProvider><PeriodGrid {...props} columnsCollapsed={false} onColumnsCollapsedChange={change} /></TooltipProvider>);
  expect(screen.getAllByRole("columnheader")).toHaveLength(37);
});
