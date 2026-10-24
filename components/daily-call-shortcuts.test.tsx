import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DailyCallShortcuts } from "./daily-call-shortcuts";
import { filtersForDate } from "@/lib/daily-call-selectors";
import { initialEmployees } from "@/lib/mock-daily-call";

vi.mock("@/lib/data/daily-call-dates", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/data/daily-call-dates")>(), todayInSaoPaulo: () => "2026-10-23" }));
const date = "2026-10-23";
const update = vi.fn(), changeDate = vi.fn(), changePeriod = vi.fn();
const employees = [{ ...initialEmployees[0], id: "123", name: "João Teste", manager: "GESTOR ÁLVARO", additionalEmployeeNumbers: ["98765"] }, { ...initialEmployees[1], id: "1234", name: "Maria Teste", manager: "OUTRO GESTOR" }];
const props = { selectedDate: date, filters: filtersForDate(date), payrollPeriods: ["2026-11", "2026-10"], employees, managerOptions: ["GESTOR ÁLVARO", "OUTRO GESTOR"], hideManagerFilter: false, changeDate, changePayrollPeriod: changePeriod, updateFilter: update };

it("oferece data e folha diretamente na barra e compartilha a busca", async () => {
  const user = userEvent.setup();
  const view = render(<DailyCallShortcuts {...props} viewMode="today" />);
  fireEvent.change(screen.getByLabelText("Data rápida da chamada"), { target: { value: "2026-10-22" } });
  expect(changeDate).toHaveBeenCalledWith("2026-10-22");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "João" } });
  expect(update).toHaveBeenLastCalledWith("query", "João");
  view.rerender(<DailyCallShortcuts {...props} viewMode="period" />);
  await user.selectOptions(screen.getByLabelText("Período rápido da chamada"), "2026-10");
  expect(changePeriod).toHaveBeenCalledWith("2026-10");
});

it("pesquisa gestor sem acentos e seleciona pela lista", async () => {
  const user = userEvent.setup();
  render(<DailyCallShortcuts {...props} viewMode="period" />);
  await user.click(screen.getByRole("combobox", { name: "Gestor rápido" }));
  await user.type(screen.getByPlaceholderText("Pesquisar gestor"), "alvaro");
  expect(screen.queryByRole("option", { name: /OUTRO GESTOR/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("option", { name: /GESTOR ÁLVARO/ }));
  expect(update).toHaveBeenCalledWith("manager", "GESTOR ÁLVARO");
  expect(update).toHaveBeenLastCalledWith("employeeId", undefined);
  expect(screen.getByRole("combobox", { name: "Gestor rápido" })).toHaveFocus();
});

it("seleciona colaborador exato por matrícula adicional e permite limpar com teclado", async () => {
  const user = userEvent.setup();
  function Harness() {
    const [filters, setFilters] = useState(props.filters);
    return <DailyCallShortcuts {...props} viewMode="today" filters={filters} updateFilter={(key, value) => setFilters(current => ({ ...current, [key]: value }))} />;
  }
  render(<Harness />);
  await user.click(screen.getByRole("combobox", { name: "Colaborador rápido" }));
  await user.type(screen.getByPlaceholderText("Pesquisar na lista por nome ou matrícula"), "98765");
  await user.keyboard("{ArrowDown}{Enter}");
  expect(screen.getByRole("combobox", { name: "Colaborador rápido" })).toHaveTextContent("João Teste");
  await user.click(screen.getByRole("combobox", { name: "Colaborador rápido" }));
  await user.clear(screen.getByPlaceholderText("Pesquisar na lista por nome ou matrícula"));
  await user.click(screen.getByRole("option", { name: /Todos os colaboradores/ }));
  expect(screen.getByRole("combobox", { name: "Colaborador rápido" })).toHaveTextContent("Todos os colaboradores");
});

it("respeita o escopo do gestor sem expor outro filtro", () => {
  render(<DailyCallShortcuts {...props} viewMode="today" hideManagerFilter />);
  expect(screen.queryByRole("combobox", { name: "Gestor rápido" })).not.toBeInTheDocument();
});
