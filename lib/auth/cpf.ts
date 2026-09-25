const CPF_LENGTH = 11;

export function normalizeCPF(value: string): string {
  return value.replace(/\D/g, "").slice(0, CPF_LENGTH);
}

export function formatCPF(value: string): string {
  const digits = normalizeCPF(value);

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;

  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function maskCPF(value: string): string {
  const digits = normalizeCPF(value);
  return `***.***.***-${digits.slice(-2).padStart(2, "*")}`;
}

function calculateDigit(digits: string, factor: number): number {
  const total = digits.split("").reduce((sum, digit) => sum + Number(digit) * factor--, 0);
  const remainder = total % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCPF(value: string): boolean {
  const digits = normalizeCPF(value);
  if (digits.length !== CPF_LENGTH || /^(\d)\1{10}$/.test(digits)) return false;

  const firstDigit = calculateDigit(digits.slice(0, 9), 10);
  const secondDigit = calculateDigit(`${digits.slice(0, 9)}${firstDigit}`, 11);

  return digits.endsWith(`${firstDigit}${secondDigit}`);
}
