import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkforceApp } from "./workforce-app";
import type { AuthenticatedProfile } from "@/lib/auth/types";
import type { WorkforceEmployee } from "@/lib/workforce";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const managerId = "20000000-0000-4000-8000-000000000001";
const date = "2026-10-08";
const globalRows: WorkforceEmployee[] = [
  {
    id: "30000000-0000-4000-8000-000000000001", employeeNumber: "FICT-001", name: "Ana Fictícia",
    unit: "CD I", manager: "Gestor Exemplo", managerId, department: "Operação", role: "Auxiliar",
    situation: "ATIVO", category: null, admissionDate: "2025-01-01", workdayHours: 7.3333,
    activeInSystem: true, bankMeasurementDate: "2026-09-28", bankBalanceMinutes: 440, bankBalanceDays: 1,
  },
  {
    id: "30000000-0000-4000-8000-000000000002", employeeNumber: "FICT-002", name: "Bruno Fictício",
    unit: "CD II", manager: null, managerId: null, department: null, role: null,
    situation: "AFASTADO", category: null, admissionDate: null, workdayHours: 7.3333,
    activeInSystem: true, bankMeasurementDate: null, bankBalanceMinutes: null, bankBalanceDays: null,
  },
];

function profile(role: AuthenticatedProfile["papel_usuario"]): AuthenticatedProfile {
  return {
    id: "10000000-0000-4000-8000-000000000001", nome_completo: "Usuário Fictício",
    status_usuario: "APROVADO", papel_usuario: role, gestor_id: role === "GESTOR" ? managerId : null,
    ultimo_acesso_em: null, created_at: date, updated_at: date,
  };
}

describe("Quadro Atual somente leitura", () => {
  it.each(["ADMIN", "RH", "LEITURA"] as const)("%s vê todos os cadastrados, inclusive sem gestor e sem extrato", (role) => {
    render(<WorkforceApp profile={profile(role)} employees={globalRows} />);
    expect(screen.getByRole("region", { name: "Indicadores do quadro" })).toHaveTextContent("No quadro2");
    expect(screen.getByRole("table")).toHaveTextContent("Ana Fictícia");
    expect(screen.getByRole("table")).toHaveTextContent("Bruno Fictício");
    expect(screen.getByRole("table")).toHaveTextContent("Sem gestor definido");
    expect(screen.getByRole("table")).toHaveTextContent("Sem extrato");
    expect(screen.queryByRole("button", { name: /editar|excluir|cadastrar/i })).not.toBeInTheDocument();
  });

  it("GESTOR só possui filtros da equipe recebida e não vê gestor externo", async () => {
    const user = userEvent.setup();
    render(<WorkforceApp profile={profile("GESTOR")} employees={[globalRows[0]]} />);
    expect(screen.queryByRole("combobox", { name: "Filtrar gestor" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filtrar unidade" })).not.toHaveTextContent("CD II");
    await user.type(screen.getByRole("textbox", { name: "Buscar no quadro" }), "Bruno");
    expect(screen.getByText("Nenhum colaborador encontrado neste escopo.")).toBeInTheDocument();
  });

  it("busca, filtros, cards e drawer refletem apenas o resultado filtrado", async () => {
    const user = userEvent.setup();
    render(<WorkforceApp profile={profile("RH")} employees={globalRows} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar situação" }), "AFASTADO");
    expect(screen.getByRole("table")).not.toHaveTextContent("Ana Fictícia");
    expect(screen.getByRole("table")).toHaveTextContent("Bruno Fictício");
    expect(screen.getByText("No quadro").parentElement).toHaveTextContent("1");
    await user.click(screen.getByRole("button", { name: "Ver detalhes de Bruno Fictício" }));
    expect(screen.getByTestId("workforce-drawer")).toHaveTextContent("Sem extrato");
  });
});
