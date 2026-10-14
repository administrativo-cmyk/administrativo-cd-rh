import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TimeBankApp } from "./time-bank-app";
import type { AuthenticatedProfile } from "@/lib/auth/types";
import type { TimeBankSnapshot } from "@/lib/time-bank";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const managerId = "20000000-0000-4000-8000-000000000001";
const snapshot: TimeBankSnapshot = {
  asOfDate: "2026-10-08",
  employees: [
    {
      id: "30000000-0000-4000-8000-000000000001", employeeNumber: "FICT-001",
      name: "Ana Fictícia", unit: "CD I", manager: "Gestor Exemplo", managerId,
      department: null, role: "Auxiliar", situation: "ATIVO", workdayHours: 7.3333,
      measurementDate: "2026-09-28", effectiveFrom: "2026-09-28",
      measuredMinutes: 440, measuredDays: 1, usedCompensationDays: 0,
      pendingCompensationDays: 1, replacementDays: 0, effectiveDays: 1,
    },
    {
      id: "30000000-0000-4000-8000-000000000002", employeeNumber: "FICT-002",
      name: "Bruno Fictício", unit: "CD II", manager: null, managerId: null,
      department: null, role: null, situation: "AFASTADO", workdayHours: 6,
      measurementDate: null, effectiveFrom: null, measuredMinutes: null,
      measuredDays: null, usedCompensationDays: 0,
      pendingCompensationDays: null, replacementDays: null, effectiveDays: null,
    },
  ],
};

function profile(role: AuthenticatedProfile["papel_usuario"]): AuthenticatedProfile {
  return {
    id: "10000000-0000-4000-8000-000000000001", nome_completo: "Usuário Fictício",
    status_usuario: "APROVADO", papel_usuario: role, gestor_id: role === "GESTOR" ? managerId : null,
    ultimo_acesso_em: null, created_at: "2026-10-08", updated_at: "2026-10-08",
  };
}

describe("Banco de Horas somente leitura", () => {
  it.each(["ADMIN", "RH", "LEITURA"] as const)("%s vê todos, inclusive sem extrato", (role) => {
    render(<TimeBankApp profile={profile(role)} snapshot={snapshot} />);
    expect(screen.getByRole("region", { name: "Indicadores do banco de horas" })).toHaveTextContent("No quadro2");
    expect(screen.getByRole("table")).toHaveTextContent("Ana Fictícia");
    expect(screen.getByRole("table")).toHaveTextContent("Bruno Fictício");
    expect(screen.getByRole("table")).toHaveTextContent("Sem extrato");
    expect(screen.getByRole("table")).toHaveTextContent("Sem gestor definido");
    expect(screen.queryByRole("button", { name: /editar|excluir|importar/i })).not.toBeInTheDocument();
  });

  it("GESTOR recebe só sua equipe e não ganha filtros de gestores externos", async () => {
    const user = userEvent.setup();
    render(<TimeBankApp profile={profile("GESTOR")} snapshot={{
      ...snapshot, employees: [snapshot.employees[0]],
    }} />);
    expect(screen.queryByRole("combobox", { name: "Filtrar gestor" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filtrar unidade" })).not.toHaveTextContent("CD II");
    await user.type(screen.getByRole("textbox", { name: "Buscar no banco de horas" }), "Bruno");
    expect(screen.getByText("Nenhum colaborador encontrado neste escopo.")).toBeInTheDocument();
  });

  it("filtros recalculam cards e o detalhe mantém Sem extrato neutro", async () => {
    const user = userEvent.setup();
    render(<TimeBankApp profile={profile("RH")} snapshot={snapshot} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar classificação" }), "SEM_EXTRATO");
    expect(screen.getByRole("table")).not.toHaveTextContent("Ana Fictícia");
    expect(screen.getByRole("table")).toHaveTextContent("Bruno Fictício");
    expect(screen.getByText("No quadro").parentElement).toHaveTextContent("1");
    await user.click(screen.getByRole("button", { name: "Ver detalhes de Bruno Fictício" }));
    expect(screen.getByTestId("time-bank-drawer")).toHaveTextContent("Sem extrato");
    expect(screen.getByTestId("time-bank-drawer")).not.toHaveTextContent("00:00");
  });

  it("pagina a tabela sem limitar o total do quadro", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 25 }, (_, index) => ({
      ...snapshot.employees[0],
      id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      employeeNumber: `FICT-${String(index + 1).padStart(3, "0")}`,
      name: `Pessoa Fictícia ${String(index + 1).padStart(2, "0")}`,
    }));
    render(<TimeBankApp profile={profile("ADMIN")} snapshot={{ ...snapshot, employees: many }} />);
    expect(screen.getByText("25 de 25 no escopo", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(20);
    await user.click(screen.getByRole("button", { name: "Próxima página" }));
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(5);
    expect(screen.getByText("21-25 de 25")).toBeInTheDocument();
  });
});
