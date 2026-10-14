import { formatSignedMinutes } from "@/lib/domain/bank-hours";

export function formatWorkforceDate(value: string | null): string {
  if (!value) return "Não informada";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00Z`));
}

export function formatWorkforceBalance(value: number | null): string {
  return value === null ? "Sem extrato" : formatSignedMinutes(value);
}
