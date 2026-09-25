import { beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseAuthService } from "@/lib/auth/supabase-auth-service";

const signUpMock = vi.hoisted(() => vi.fn());
const signOutMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signUp: signUpMock,
      signOut: signOutMock,
    },
  }),
}));

const input = {
  fullName: "Pessoa de Teste",
  cpf: "52998224725",
  password: "segura123",
};

describe("SupabaseAuthService signup", () => {
  beforeEach(() => {
    signUpMock.mockReset();
    signOutMock.mockReset();
  });

  it.each([
    "User already registered",
    "Database error saving new user",
  ])("normaliza a falha pública sem enumerar o CPF: %s", async (providerMessage) => {
    signUpMock.mockResolvedValue({ data: { user: null }, error: { message: providerMessage } });

    await expect(new SupabaseAuthService().signUp(input)).rejects.toMatchObject({
      code: "UNEXPECTED",
      message: "Não foi possível concluir o cadastro. Verifique os dados ou procure o RH ou administrador responsável.",
    });
  });
});
