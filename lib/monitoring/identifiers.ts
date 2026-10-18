import { isValidCPF } from "@/lib/auth/cpf";

/** Browser-safe validation. No formatting, truncation or implicit layout padding. */
export function isStrictMonitoringIdentifier(value: string, type: "cpf" | "pis"): boolean {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  // Guarding the original length above makes the UI formatter's truncation unreachable.
  if (type === "cpf") return isValidCPF(value);
  const weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
  const remainder = 11 - (sum % 11);
  return Number(value[10]) === (remainder >= 10 ? 0 : remainder);
}
