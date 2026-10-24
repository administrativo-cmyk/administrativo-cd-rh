import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DailyCallApp } from "./daily-call-app";
import type { AuthenticatedProfile, UserRole } from "@/lib/auth/types";
import { mapDailyCallSnapshot } from "@/lib/data/daily-call-snapshot";
import type { DailyCallPreferences } from "@/lib/workspace/contracts";

const workspace = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workspace/client", () => ({ workspaceRequest: workspace }));
beforeEach(() => {
  localStorage.clear();
  const preferences = new Map<string, DailyCallPreferences>();
  workspace.mockReset().mockImplementation(async (action: string, data: { expectedUserId?: string; viewMode?: "today" | "period"; columnsCollapsed?: boolean }) => {
    if (action === "settings") return { compactTables: false, notificationsEnabled: true };
    if (action === "notification_summary") return { unread: 0 };
    const userId = data.expectedUserId!;
    const current = preferences.get(userId) ?? { userId, viewMode: "today", columnsCollapsed: false, updatedAt: null };
    if (action === "save_daily_call_preferences") {
      const saved = { ...current, ...data, updatedAt: "2026-10-20T12:00:00Z" };
      preferences.set(userId, saved);
      return saved;
    }
    return current;
  });
});

const date = "2026-10-07";
const snapshot = mapDailyCallSnapshot({
  date, startDate: "2026-10-01", endDate: "2026-10-31",
  employees: [{
    id: "00000000-0000-4000-8000-000000000001", employeeNumber: "FICT-A",
    name: "Colaborador Fictício", unit: "CD I", department: "Operação", role: "Auxiliar",
    situation: "ATIVO", manager: "Gestor Fictício", admissionDate: "2025-01-01",
    measurementDate: null, effectiveFrom: null, workdayHours: null,
    balanceMinutes: null, balanceDays: null, usedCompensationDays: 0,
    pendingCompensationDays: null, replacementDays: null, attendance: [],
  }],
});

function profile(role: UserRole, managerId: string | null = null): AuthenticatedProfile {
  return {
    id: "10000000-0000-4000-8000-000000000001", nome_completo: "Usuário Fictício",
    status_usuario: "APROVADO", papel_usuario: role, gestor_id: managerId,
    ultimo_acesso_em: null, created_at: date, updated_at: date,
  };
}

describe("controles da Chamada por papel", () => {
  it.each(["ADMIN", "RH", "GESTOR"] as const)("%s possui controle de status no conjunto recebido", async (role) => {
    render(<DailyCallApp profile={profile(role, role === "GESTOR" ? "20000000-0000-4000-8000-000000000001" : null)} initialDate={date} initialSnapshot={snapshot} />);
    expect((await screen.findAllByRole("button", { name: "Status de Colaborador Fictício" })).length).toBeGreaterThan(0);
  });

  it("LEITURA consulta Hoje e Período sem poder mudar status ou observação", async () => {
    const user = userEvent.setup();
    render(<DailyCallApp profile={profile("LEITURA")} initialDate={date} initialSnapshot={snapshot} />);
    expect(screen.queryByRole("button", { name: "Status de Colaborador Fictício" })).not.toBeInTheDocument();
    expect((await screen.findAllByRole("textbox", { name: "Observação de Colaborador Fictício" })).every((input) => input.hasAttribute("disabled"))).toBe(true);
    await user.click(screen.getByRole("button", { name: "Período" }));
    expect(screen.getByTestId("period-grid")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Colaborador Fictício, dia 07" })).not.toBeInTheDocument();
  });

  it("GESTOR não recebe filtros de outros gestores ou unidades fora da equipe", () => {
    render(<DailyCallApp profile={profile("GESTOR", "20000000-0000-4000-8000-000000000001")} initialDate={date} initialSnapshot={snapshot} />);
    expect(screen.queryByRole("combobox", { name: "Gestor" })).not.toBeInTheDocument();
    const units = screen.getByRole("combobox", { name: "Unidade" });
    expect(units).toHaveTextContent("CD I");
    expect(units).not.toHaveTextContent("CD II");
    expect(units).not.toHaveTextContent("CD FLV");
  });

  it("gerente vê filtro de gestores e consulta outra equipe sem editar status", async () => {
    const own = { ...snapshot.employees[0], canWrite: true };
    const other = { ...own, id: "FICT-B", databaseId: "00000000-0000-4000-8000-000000000002", name: "Pessoa de outra equipe", manager: "Outro gestor", canWrite: false };
    render(<DailyCallApp profile={{ ...profile("GESTOR", "20000000-0000-4000-8000-000000000001"), visualizar_todos_gestores: true }} initialDate={date} initialSnapshot={{ ...snapshot, employees: [own, other] }} />);
    expect(await screen.findByRole("combobox", { name: "Gestor" })).toHaveTextContent("Outro gestor");
    expect((await screen.findAllByRole("button", { name: "Status de Colaborador Fictício" })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Status de Pessoa de outra equipe" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Usuários" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Importações" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Período" }));
    await screen.findByTestId("period-grid");
    expect(screen.getAllByRole("button", { name: /^Colaborador Fictício, dia/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Pessoa de outra equipe, dia/ })).not.toBeInTheDocument();
  });

  it("GESTOR aprovado sem vínculo recebe mensagem, sem tabela operacional", async () => {
    render(<DailyCallApp profile={profile("GESTOR")} initialDate={date} initialSnapshot={{ ...snapshot, employees: [] }} />);
    expect(await screen.findByText("Seu usuário ainda não está vinculado a um gestor do quadro.")).toBeInTheDocument();
    expect(screen.queryByTestId("today-table")).not.toBeInTheDocument();
  });

  it("GESTOR com perfil desatualizado exibe equipe recebida após novo vínculo", async () => {
    render(<DailyCallApp profile={profile("GESTOR")} initialDate={date} initialSnapshot={snapshot} />);
    expect(screen.queryByText("Seu usuário ainda não está vinculado a um gestor do quadro.")).not.toBeInTheDocument();
    expect(await screen.findByTestId("today-table")).toBeInTheDocument();
  });

  it("restaura modo Período e colunas recolhidas ao reabrir Chamada", async () => {
    const user = userEvent.setup();
    const first = render(<DailyCallApp profile={profile("ADMIN")} initialDate={date} initialSnapshot={snapshot} />);
    await screen.findByTestId("today-table");
    await user.click(screen.getByRole("button", { name: "Período" }));
    await user.click(screen.getByRole("button", { name: "Recolher colunas de dados" }));
    await waitFor(() => expect(screen.queryByText("Salvando visualização…")).not.toBeInTheDocument());
    first.unmount();
    render(<DailyCallApp profile={profile("ADMIN")} initialDate={date} initialSnapshot={snapshot} />);
    await screen.findByTestId("period-grid");
    expect(screen.getByRole("button", { name: "Período" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Mostrar colunas de dados" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Gestor" })).not.toBeInTheDocument();
  });

  it("mantém atalhos e agrupamento no Período ao entrar e sair da tela cheia", async () => {
    const user = userEvent.setup();
    render(<DailyCallApp profile={profile("LEITURA")} initialDate={date} initialSnapshot={snapshot} />);
    await screen.findByTestId("today-table");
    await user.type(screen.getByRole("searchbox", { name: "Pesquisar colaborador por nome ou matrícula" }), "FICT-A");
    expect(screen.getByLabelText("Buscar colaborador")).toHaveValue("FICT-A");
    await user.click(screen.getByRole("button", { name: "Período" }));
    const grouping = screen.getByRole("checkbox", { name: "Agrupar por gestor" });
    expect(grouping).toBeEnabled();
    await user.click(grouping);
    expect(screen.getByRole("rowgroup", { name: "Equipe de Gestor Fictício" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tela cheia" }));
    const board = screen.getByRole("region", { name: "Lista da chamada" });
    expect(board).toHaveAttribute("data-fullscreen", "true");
    expect(screen.getByLabelText("Período rápido da chamada")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("FICT-A");
    await user.click(screen.getByRole("combobox", { name: "Colaborador rápido" }));
    await user.type(screen.getByPlaceholderText("Pesquisar na lista por nome ou matrícula"), "FICT-A");
    await user.click(screen.getByRole("option", { name: /Colaborador Fictício/ }));
    expect(screen.getByRole("combobox", { name: "Colaborador rápido" })).toHaveTextContent("Colaborador Fictício");
    await user.click(screen.getByRole("button", { name: "Sair da tela cheia" }));
    expect(board).toHaveAttribute("data-fullscreen", "false");
    expect(grouping).toBeChecked();
    expect(screen.getByRole("searchbox")).toHaveValue("FICT-A");
    expect(screen.getByRole("rowgroup", { name: "Equipe de Gestor Fictício" })).toBeInTheDocument();
  });
});
