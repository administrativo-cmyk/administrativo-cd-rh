import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedProfile } from "@/lib/auth/types";
import { AdministrationApp } from "./administration-app";

vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
const id = "11111111-1111-4111-8111-111111111111", team = "22222222-2222-4222-8222-222222222222";
const version = "2026-10-19T12:00:00Z";
const profile: AuthenticatedProfile = { id, nome_completo: "Pessoa teste", papel_usuario: "ADMIN", status_usuario: "APROVADO", gestor_id: null, ultimo_acesso_em: null, created_at: version, updated_at: version };
const snapshot = { entity: "employee", datasetVersion: "fixture-v1", total: 1, rows: [{ id, employeeNumber: "SINTETICO", name: "Pessoa sintética", unitId: id, managerId: team, department: null, role: null, situation: "ATIVO", category: null, admissionDate: "2020-01-01", movement: null, workdayHours: 8, observation: null, cpf: "12345678909", pis: null, terminationDate: null, situationFrom: null, expectedReturnDate: null, activeInSystem: true, defaultSchedule: { name: "Administrativo", start: "08:00", end: "18:00" }, statusSignal: null, createdAt: version, updatedAt: version }], options: { units: [{ id, code: "TEST", name: "Unidade teste", active: true }], managers: [{ id: team, name: "Gestor sintético", active: true }], employees: [] }, permissions: { canManageRegisters: true, canApproveVacation: true, canProposeVacation: true } };
function setup() { const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(snapshot), { status: 200 }))); vi.stubGlobal("fetch", fetcher);render(<AdministrationApp entity="employee" profile={profile} />);return fetcher; }
afterEach(() => vi.unstubAllGlobals());

describe("cadastro de colaborador", () => {
  it("mostra foto, documentos, gestor, horário e situação com cores", async () => {
    setup();expect(await screen.findByRole("img", { name: "Foto de Pessoa sintética" })).toHaveAttribute("src", expect.stringContaining("/api/monitoring/photo?employeeId="));
    expect(screen.getByText("CPF 12345678909")).toBeVisible();expect(screen.getByText("PIS não informado")).toBeVisible();expect(screen.getByText("08:00 às 18:00")).toBeVisible();
    const row = screen.getByText("CPF 12345678909").closest("tr")!;expect(within(row).getByText("Gestor sintético")).toBeVisible();expect(within(row).getAllByText("Ativo")[0]).toHaveClass("text-emerald-900");
  });
  it("envia filtros de gestor e situação ao servidor e reinicia a paginação", async () => {
    const fetcher = setup();await screen.findByText("CPF 12345678909");
    fireEvent.change(screen.getByLabelText("Filtrar gestor"), { target: { value: team } });fireEvent.change(screen.getByLabelText("Filtrar situação"), { target: { value: "DESLIGADO" } });
    await waitFor(() => expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body).data).toMatchObject({ managerId: team, situation: "DESLIGADO", offset: 0 }));
  });
  it("exige datas conforme a situação e preserva o rascunho em erro", async () => {
    setup();fireEvent.click(await screen.findByRole("button", { name: "Editar Pessoa sintética" }));const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Situação *"), { target: { value: "DESLIGADO" } });expect(dialog.getByLabelText("Data de desligamento *")).toBeRequired();expect(dialog.queryByLabelText("Retorno previsto *")).not.toBeInTheDocument();
    fireEvent.change(dialog.getByLabelText("Situação *"), { target: { value: "ACIDENTE_TRABALHO" } });expect(dialog.getByLabelText("Retorno previsto *")).toBeRequired();expect(dialog.getByLabelText("Situação válida desde / retorno efetivo *")).toBeRequired();
    expect(dialog.queryByLabelText("Data de desligamento *")).not.toBeInTheDocument();expect(dialog.getByLabelText("CPF (11 dígitos)")).toHaveValue("12345678909");
  });
});
