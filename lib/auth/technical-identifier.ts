import { normalizeCPF } from "@/lib/auth/cpf";

export const TECHNICAL_AUTH_DOMAIN = "auth.administrativo-cd.invalid";

export async function buildTechnicalEmail(cpf: string): Promise<string> {
  const normalizedCPF = normalizeCPF(cpf);
  const bytes = new TextEncoder().encode(normalizedCPF);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const localPart = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");

  return `${localPart}@${TECHNICAL_AUTH_DOMAIN}`;
}
