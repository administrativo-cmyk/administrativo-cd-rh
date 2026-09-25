import type { AccessRequestStatus, UserRole } from "@/lib/auth/types";

export type { AccessRequestStatus, UserRole } from "@/lib/auth/types";

export interface SignInInput {
  cpf: string;
  password: string;
}

export interface SignUpInput extends SignInInput {
  fullName: string;
}

export type SignInResult = {
  status: AccessRequestStatus;
  role: UserRole | null;
};

export interface AuthService {
  signIn(input: SignInInput): Promise<SignInResult>;
  signUp(input: SignUpInput): Promise<{ status: "PENDENTE" }>;
  signOut(): Promise<void>;
  resetPassword(cpf: string): Promise<{ available: false }>;
}

export class AuthFlowError extends Error {
  constructor(
    public readonly code: "INVALID_CREDENTIALS" | "PROFILE_UNAVAILABLE" | "UNEXPECTED",
    message: string,
  ) {
    super(message);
    this.name = "AuthFlowError";
  }
}

function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class MockAuthService implements AuthService {
  constructor(
    private readonly delayMilliseconds = 650,
    private readonly result: SignInResult = { status: "APROVADO", role: "LEITURA" },
  ) {}

  async signIn(): Promise<SignInResult> {
    await delay(this.delayMilliseconds);
    return this.result;
  }

  async signUp(): Promise<{ status: "PENDENTE" }> {
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
