import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsersAdminPage } from "@/components/users/users-admin-page";
import { userAdminService } from "@/lib/auth/user-admin-service";
import type { AdministrativeUser, AuthenticatedProfile } from "@/lib/auth/types";

vi.mock("@/components/app-header", () => ({ AppHeader: () => <div /> }));
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => <div /> }));
vi.mock("@/lib/auth/user-admin-service", () => ({
  userAdminService: {
    list: vi.fn(),
    approve: vi.fn(),
    block: vi.fn(),
    reactivate: vi.fn(),
  },
}));

const profile: AuthenticatedProfile = {
  id: "admin-current",
  nome_completo: "Admin Atual",
  status_usuario: "APROVADO",
  papel_usuario: "ADMIN",
  gestor_id: null,
  ultimo_acesso_em: null,
  created_at: "2026-09-25T00:00:00.000Z",
  updated_at: "2026-09-25T00:00:00.000Z",
};

const users: AdministrativeUser[] = [
  {
    id: profile.id,
    nome_completo: profile.nome_completo,
    cpf_mascarado: "***.***.***-01",
    status_usuario: "APROVADO",
    papel_usuario: "ADMIN",
    gestor_id: null,
    created_at: profile.created_at,
    aprovado_em: profile.created_at,
    bloqueado_em: null,
  },
  {
    id: "admin-other",
    nome_completo: "Outro Admin",
    cpf_mascarado: "***.***.***-02",
    status_usuario: "APROVADO",
    papel_usuario: "ADMIN",
    gestor_id: null,
    created_at: profile.created_at,
    aprovado_em: profile.created_at,
    bloqueado_em: null,
  },
];

describe("UsersAdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userAdminService.list).mockResolvedValue(users);
  });

  it("desabilita o bloqueio da própria conta, mas permite gerenciar outro admin", async () => {
    render(<UsersAdminPage profile={profile} />);

    await waitFor(() => expect(screen.getByText("Admin Atual")).toBeInTheDocument());
    const ownBlockButton = screen.getAllByRole("button", { name: "Bloquear" })[0];

    expect(ownBlockButton).toBeDisabled();
    expect(ownBlockButton).toHaveAttribute("title", "Você não pode bloquear seu próprio acesso.");
    expect(screen.getAllByRole("button", { name: "Bloquear" })[1]).toBeEnabled();
    expect(screen.getByText("***.***.***-01")).toBeInTheDocument();
    expect(screen.getByText("***.***.***-02")).toBeInTheDocument();
  });

  it("envia os filtros de status e busca ao serviço administrativo", async () => {
    const user = userEvent.setup();
    render(<UsersAdminPage profile={profile} />);

    await screen.findByText("Admin Atual");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar por status" }), "BLOQUEADO");
    await waitFor(() => expect(userAdminService.list).toHaveBeenLastCalledWith({
      status: "BLOQUEADO",
      role: null,
      search: "",
    }));

    await user.type(screen.getByRole("textbox", { name: "Buscar por nome ou CPF" }), "Pessoa Exemplo");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(userAdminService.list).toHaveBeenLastCalledWith({
      status: "BLOQUEADO",
      role: null,
      search: "Pessoa Exemplo",
    }));
  });
});
