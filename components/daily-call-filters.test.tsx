import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DailyCallFilters } from "./daily-call-filters";
import { filtersForDate } from "@/lib/daily-call-selectors";

const props = { filters: filtersForDate("2026-10-23"), managerOptions: [], activeCount: 0, updateFilter: vi.fn(), clearFilters: vi.fn(), onPeriodChange: vi.fn() };

it("oferece somente períodos com dados e mantém seleção de outra folha", async () => {
  const user = userEvent.setup();
  render(<DailyCallFilters {...props} payrollPeriods={["2026-11", "2026-09"]} />);
  const select = screen.getByRole("combobox", { name: "Meses do fechamento da folha" });
  expect(within(select).getAllByRole("option").map(option => option.textContent)).toEqual(["OUT/NOV 2026", "AGO/SET 2026"]);
  await user.selectOptions(select, "2026-09");
  expect(props.onPeriodChange).toHaveBeenCalledWith("2026-09");
});

it("não oferece período vazio como competência e permite escolher histórico", () => {
  render(<DailyCallFilters {...props} payrollPeriods={["2026-09"]} />);
  const select = screen.getByRole("combobox", { name: "Meses do fechamento da folha" });
  expect(select).toHaveValue("");
  expect(within(select).queryByRole("option", { name: "OUT/NOV 2026" })).not.toBeInTheDocument();
  expect(select).toBeEnabled();
});

it("desabilita a lista quando não há lançamentos", () => {
  render(<DailyCallFilters {...props} payrollPeriods={[]} />);
  expect(screen.getByRole("combobox", { name: "Meses do fechamento da folha" })).toBeDisabled();
  expect(screen.getByRole("option", { name: "Nenhum período com dados" })).toBeInTheDocument();
});
