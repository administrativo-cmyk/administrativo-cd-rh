export type AccessRequestStatus = "PENDENTE" | "APROVADO" | "BLOQUEADO";

export interface SignInInput {
  cpf: string;
  password: string;
}

export interface SignUpInput extends SignInInput {
  fullName: string;
}

export interface AuthService {
  signIn(input: SignInInput): Promise<{ demo: true }>;
  signUp(input: SignUpInput): Promise<{ status: AccessRequestStatus }>;
  signOut(): Promise<void>;
  resetPassword(cpf: string): Promise<{ available: false }>;
}

function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class MockAuthService implements AuthService {
  constructor(private readonly delayMilliseconds = 650) {}

  async signIn(): Promise<{ demo: true }> {
    await delay(this.delayMilliseconds);
    return { demo: true };
  }

  async signUp(): Promise<{ status: AccessRequestStatus }> {
    await delay(this.delayMilliseconds);
    return { status: "PENDENTE" };
  }

  async signOut(): Promise<void> {
    await delay(0);
  }

  async resetPassword(): Promise<{ available: false }> {
    await delay(250);
    return { available: false };
  }
}

export const mockAuthService = new MockAuthService();
