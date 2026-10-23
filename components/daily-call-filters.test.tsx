import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DailyCallFilters } from "./daily-call-filters";
import { filtersForDate } from "@/lib/daily-call-selectors";

vi.mock("@/lib/data/daily-call-dates", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/data/daily-call-dates")>(), todayInSaoPaulo: () => "2026-10-23" }));
const props = { filters: filtersForDate("2026-10-23"), managerOptions: [], activeCount: 0, updateFilter: vi.fn(), clearFilters: vi.fn(), onPeriodChange: vi.fn() };

it("oferece somente períodos com dados e mantém seleção de outra folha", async () => {
  const user = userEvent.setup();
  render(<DailyCallFilters {...props} payrollPeriods={["2026-11", "2026-09"]} />);
  const select = screen.getByRole("combobox", { name: "Meses do fechamento da folha" });
  expect(within(select).getAllByRole("option").map(option => option.textContent)).toEqual(["OUT/NOV 2026", "AGO/SET 2026"]);
  await user.selectOptions(select, "2026-09");
  expect(props.onPeriodChange).toHaveBeenCalledWith("2026-09");
});

it("mantém ciclo atual disponível mesmo sem lançamentos", () => {
  render(<DailyCallFilters {...props} payrollPeriods={["2026-09"]} />);
  const select = screen.getByRole("combobox", { name: "Meses do fechamento da folha" });
  expect(select).toHaveValue("2026-11");
  expect(within(select).getByRole("option", { name: "OUT/NOV 2026" })).toBeInTheDocument();
  expect(select).toBeEnabled();
});

it("oculta histórico anterior aos dois ciclos precedentes", () => {
  render(<DailyCallFilters {...props} payrollPeriods={["2026-11", "2026-10", "2026-09", "2026-08", "2020-09"]} />);
  expect(screen.getByRole("combobox", { name: "Meses do fechamento da folha" })).toBeEnabled();
  expect(screen.queryByRole("option", { name: "JUL/AGO 2026" })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "AGO/SET 2020" })).not.toBeInTheDocument();
});
