import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdministrativeUser, AuthenticatedProfile } from "@/lib/auth/types";

const mocks = vi.hoisted(() => ({ list: vi.fn(), listManagers: vi.fn(), approve: vi.fn(), linkManager: vi.fn(), block: vi.fn(), reactivate: vi.fn() }));
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
      { ...target, status_usuario: "APROVADO", papel_usuario: "GESTOR", gestor_id: managerA },
      { ...target, id: "10000000-0000-4000-8000-000000000003", nome_completo: "Admin Fictício", status_usuario: "APROVADO", papel_usuario: "ADMIN" },
    ]);
    render(<UsersAdminPage profile={actor} />);
    const selector = await screen.findByRole("combobox", { name: "Gestor do quadro de Usuário Fictício" });
    expect(screen.getByText("Sem permissão para gerenciar")).toBeInTheDocument();
    await user.selectOptions(selector, managerB);
    await user.click(screen.getByRole("button", { name: "Vincular" }));
    expect(mocks.linkManager).toHaveBeenCalledWith(target.id, managerB);
  });
});
