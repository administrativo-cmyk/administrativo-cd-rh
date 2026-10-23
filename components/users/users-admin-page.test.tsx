import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdministrativeUser, AuthenticatedProfile } from "@/lib/auth/types";

const mocks = vi.hoisted(() => ({ list: vi.fn(), listManagers: vi.fn(), approve: vi.fn(), edit: vi.fn(), linkManager: vi.fn(), block: vi.fn(), reactivate: vi.fn() }));
vi.mock("@/lib/auth/user-admin-service", () => ({ userAdminService: mocks }));

import { UsersAdminPage } from "./users-admin-page";

const managerA = "20000000-0000-4000-8000-000000000001";
const managerB = "20000000-0000-4000-8000-000000000002";
const actor: AuthenticatedProfile = {
  id: "10000000-0000-4000-8000-000000000001", nome_completo: "RH Fictício",
  status_usuario: "APROVADO", papel_usuario: "RH", gestor_id: null,
  ultimo_acesso_em: null, created_at: "2026-10-07", updated_at: "2026-10-07",
};
const target: AdministrativeUser = {
  id: "10000000-0000-4000-8000-000000000002", nome_completo: "Usuário Fictício",
  cpf_mascarado: "***.***.***-00", status_usuario: "PENDENTE", papel_usuario: null,
  gestor_id: null, created_at: "2026-10-07", aprovado_em: null, bloqueado_em: null,
};

describe("vínculo de gestor em /usuarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([target]);
    mocks.listManagers.mockResolvedValue([
      { id: managerA, nome: "Gestor A Fictício" },
      { id: managerB, nome: "Gestor B Fictício" },
    ]);
    mocks.approve.mockResolvedValue(undefined);
    mocks.linkManager.mockResolvedValue(undefined);
  });

  it("RH só aprova GESTOR após selecionar um gestor real", async () => {
    const user = userEvent.setup();
    render(<UsersAdminPage profile={actor} />);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Papel para Usuário Fictício" }), "GESTOR");
    const approve = screen.getByRole("button", { name: "Aprovar" });
    expect(approve).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "Gestor do quadro para Usuário Fictício" }), managerA);
    expect(approve).toBeEnabled();
    await user.click(approve);
    expect(mocks.approve).toHaveBeenCalledWith(target.id, "GESTOR", managerA);
  });

  it("RH pode trocar o vínculo de um GESTOR existente sem gerir ADMIN", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue([
      { ...target, status_usuario: "APROVADO", papel_usuario: "GESTOR", gestor_id: managerA, updated_at: "2026-10-17T12:00:00Z" },
      { ...target, id: "10000000-0000-4000-8000-000000000003", nome_completo: "Admin Fictício", status_usuario: "APROVADO", papel_usuario: "ADMIN" },
    ]);
    render(<UsersAdminPage profile={actor} />);
    await user.click(await screen.findByRole("button", { name: "Editar usuário" }));
    const selector = screen.getByRole("combobox", { name: "Gestor do quadro" });
    expect(screen.getByText("Sem permissão para gerenciar")).toBeInTheDocument();
    await user.selectOptions(selector, managerB);
    await user.type(screen.getByRole("textbox", { name: "Justificativa da edição" }), "Transferência de equipe confirmada");
    expect(screen.getByRole("combobox", { name: "Papel do usuário" }).querySelector('option[value="ADMIN"]')).toBeNull();
    await user.click(screen.getByRole("button", { name: "Salvar edição" }));
    expect(mocks.edit).toHaveBeenCalledWith(expect.objectContaining({ id: target.id, managerId: managerB, expectedUpdatedAt: "2026-10-17T12:00:00Z", role: "GESTOR" }));
  });

  it("habilita visualização global mantendo papel GESTOR e vínculo", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue([{ ...target, status_usuario: "APROVADO", papel_usuario: "GESTOR", gestor_id: managerA, updated_at: "2026-10-17T12:00:00Z", visualizar_todos_gestores: false }]);
    render(<UsersAdminPage profile={actor} />);
    await user.click(await screen.findByRole("button", { name: "Editar usuário" }));
    const checkbox = screen.getByRole("checkbox", { name: "Visualizar todos os gestores" });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toHaveAccessibleDescription(/Alterações operacionais continuam restritas à equipe vinculada/);
    await user.click(checkbox);
    await user.type(screen.getByRole("textbox", { name: "Justificativa da edição" }), "Gerente responsável por todas as equipes");
    await user.click(screen.getByRole("button", { name: "Salvar edição" }));
    expect(mocks.edit).toHaveBeenCalledWith(expect.objectContaining({ role: "GESTOR", managerId: managerA, viewAllManagers: true }));
  });

  it("restaura opção salva e limpa ao trocar papel", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue([{ ...target, status_usuario: "APROVADO", papel_usuario: "GESTOR", gestor_id: managerA, updated_at: "2026-10-17T12:00:00Z", visualizar_todos_gestores: true }]);
    render(<UsersAdminPage profile={actor} />);
    expect(await screen.findByText("Visualiza todos os gestores")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Editar usuário" }));
    expect(screen.getByRole("checkbox", { name: "Visualizar todos os gestores" })).toBeChecked();
    await user.selectOptions(screen.getByRole("combobox", { name: "Papel do usuário" }), "LEITURA");
    expect(screen.queryByRole("checkbox", { name: "Visualizar todos os gestores" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Justificativa da edição" }), "Novo papel conferido");
    await user.click(screen.getByRole("button", { name: "Salvar edição" }));
    expect(mocks.edit).toHaveBeenCalledWith(expect.objectContaining({ role: "LEITURA", managerId: null, viewAllManagers: false }));
  });
});
