import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LogoutButton } from "@/components/auth/logout-button";
import type { AuthService } from "@/lib/auth/auth-service";

const replaceMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock }),
}));

describe("logout", () => {
  it("encerra a sessão real e retorna ao login", async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    const service: AuthService = {
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut,
      resetPassword: vi.fn(),
    };
    const user = userEvent.setup();

    render(<LogoutButton service={service} />);
    await user.click(screen.getByRole("button", { name: "Sair" }));

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    expect(replaceMock).toHaveBeenCalledWith("/login");
    expect(refreshMock).toHaveBeenCalledOnce();
  });
});
