import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccessStatus } from "@/components/auth/access-status";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

describe("páginas de status de acesso", () => {
  it("explica que o acesso está pendente sem usar vídeo", () => {
    const { container } = render(<AccessStatus variant="pending" />);
    expect(screen.getByRole("heading", { name: "Seu acesso está aguardando aprovação." })).toBeInTheDocument();
    expect(screen.getByText("Assim que seu cadastro for aprovado, você poderá acessar o Administrativo CD.")).toBeInTheDocument();
    expect(container.querySelector("video")).toBeNull();
  });

  it("explica o bloqueio e oferece saída", () => {
    render(<AccessStatus variant="blocked" />);
    expect(screen.getByRole("heading", { name: "Seu acesso está bloqueado." })).toBeInTheDocument();
    expect(screen.getByText("Procure a administração responsável para revisar seu acesso.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voltar para o login" })).toHaveAttribute("href", "/login");
  });
});
