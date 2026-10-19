import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmployeePunchHistory } from "./employee-punch-history";
const employeeId = "30000000-0000-4000-8000-000000000001";
const at = (time: string) => Date.parse(`2026-10-02T${time}:00-03:00`);
const data = (canEdit = false) => ({ canEdit, bank: { saldo_minutos: 960, aplica_a_partir_de: "2026-09-13", automatic: false, movementMinutes: 0 }, correctionHistory: [], days: [{ date: "2026-10-02", correctionVersion: null,
 bankDay: { state: "pending", reason: "Falta uma batida; somente RH ou ADMIN pode corrigir", deltaMinutes: null, expectedMinutes: 480, workedMinutes: null, suppressedIds: [], missingRole: "breakEnd", punches: ["08:00", "12:00", "17:00"].map((time, index) => ({ id: String(index), at: at(time), sourceId: index % 2 ? "CPF" : "PIS" })), slots: [{ role: "start", at: at("08:00") }, { role: "breakStart", at: at("12:00") }, { role: "breakEnd", at: null }, { role: "end", at: at("17:00") }], suggestions: [{ at: at("13:00"), eventId: "40000000-0000-4000-8000-000000000001", pointId: "Torniquete", direction: "entry", differenceMinutes: 0 }] } }] });
afterEach(() => { vi.unstubAllGlobals(); });
describe("employee punch history", () => {
 it("shows pending balance and both clocks without manager editing controls", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => data() })));
  render(<EmployeePunchHistory employeeId={employeeId} date="2026-10-02" />);
  await screen.findByText(/Cálculo automático aguardando/);
  await userEvent.click(screen.getByText(/02\/10\/2026/));
  expect(screen.getByText(/08:00 · PIS/)).toBeInTheDocument(); expect(screen.getByText(/12:00 · CPF/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /corrigir batidas/ })).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Editar saldo manual" })).not.toBeInTheDocument();
 });
 it("keeps missing mark blank, then lets RH explicitly use and confirm turnstile evidence", async () => {
  const user = userEvent.setup(); const fetch = vi.fn(async (_url: string, options?: RequestInit) => ({ ok: true, json: async () => options?.method === "POST" ? { changed: true } : data(true) })); vi.stubGlobal("fetch", fetch);
  render(<EmployeePunchHistory employeeId={employeeId} date="2026-10-02" />);
  await screen.findByRole("button", { name: "Editar saldo manual" }); await user.click(screen.getByText(/02\/10\/2026/));
  await user.click(screen.getByRole("button", { name: /corrigir batidas/ })); expect(screen.getByLabelText("Retorno do intervalo")).toHaveValue("");
  await user.click(screen.getByRole("button", { name: /Usar sugestão/ })); expect(screen.getByLabelText("Retorno do intervalo")).toHaveValue("2026-10-02T13:00");
  await user.type(screen.getByLabelText("Justificativa"), "Conferido pelo RH com evidência"); await user.click(screen.getByRole("button", { name: "Confirmar correção auditada" }));
  await waitFor(() => expect(fetch.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
  const body = JSON.parse(String(fetch.mock.calls.find(([, options]) => options?.method === "POST")?.[1]?.body));
  expect(body.punches[2]).toEqual({ at: "2026-10-02T16:00:00.000Z", evidenceId: "40000000-0000-4000-8000-000000000001" }); expect(body.reason).toContain("Conferido");
 });
 it("handles malformed responses without crashing or exposing stale balances", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ unexpected: true }) })));
  render(<EmployeePunchHistory employeeId={employeeId} date="2026-10-02" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("não confirmou o histórico");
 });
});
