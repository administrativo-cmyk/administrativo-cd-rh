const EXCEL_EPOCH_1900 = Date.UTC(1899, 11, 30);
const EXCEL_EPOCH_1904 = Date.UTC(1904, 0, 1);

export function normalizedText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function comparableText(value: unknown): string {
  return normalizedText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

export function normalizedHeader(value: unknown): string {
  return comparableText(value).replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function parseMatricula(value: unknown, numberFormat = "General"): string | null {
  if (typeof value === "string") {
    const key = normalizedText(value);
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key) ? key : null;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  const plain = String(value);
  return /^0+$/.test(numberFormat) ? plain.padStart(numberFormat.length, "0") : plain;
}

export type UnitCode = "CD I" | "CD II" | "CD FLV";

export function normalizeUnit(value: unknown): UnitCode | null {
  const key = comparableText(value);
  if (key === "CENTRO DE DISTRIBUICAO" || key === "CD I") return "CD I";
  if (key === "CENTRO DE DISTRIBUICAO II" || key === "CD II") return "CD II";
  if (key === "CD FLV") return "CD FLV";
  return null;
}

export type EmployeeSituation =
  | "ATIVO" | "FERIAS" | "AFASTADO" | "DESLIGADO" | "AVISO_PREVIO"
  | "LICENCA_MATERNIDADE" | "ACIDENTE_TRABALHO" | "OUTRO_AFASTAMENTO";

export function normalizeSituation(value: unknown): EmployeeSituation | null {
  const key = comparableText(value).replace(/\./g, " ").replace(/\s+/g, " ").trim();
  const map: Record<string, EmployeeSituation> = {
    ATIVO: "ATIVO",
    FERIAS: "FERIAS",
    "AF PREVIDENCIA": "AFASTADO",
    "AF AC TRABALHO": "ACIDENTE_TRABALHO",
    "AF ACID TRABALHO": "ACIDENTE_TRABALHO",
    "AVISO PREVIO": "AVISO_PREVIO",
    "LICENCA MATER": "LICENCA_MATERNIDADE",
    "LICENCA MATERNIDADE": "LICENCA_MATERNIDADE",
    OUTROS: "OUTRO_AFASTAMENTO",
    DESLIGADO: "DESLIGADO",
  };
  return map[key] ?? null;
}

export function isMeasured(situation: EmployeeSituation): boolean {
  return situation === "ATIVO" || situation === "FERIAS";
}

export function journeyMinutesForFunction(value: unknown): number {
  const key = comparableText(value);
  if (key.includes("APOIO PREVENCAO E PERDAS")) return 720;
  if (key.includes("MENOR APRENDIZ")) return 240;
  if (key.includes("APRENDIZ") || key.includes("PCD")) return 360;
  return 440;
}

export function parseSignedHhMm(value: string): number | null {
  const match = /^([+-]?)(\d+):([0-5]\d)$/.exec(normalizedText(value));
  if (!match) return null;
  const hours = Number(match[2]);
  if (!Number.isSafeInteger(hours)) return null;
  const minutes = hours * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

export function parseExcelDurationMinutes(value: unknown, date1904 = false): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 1440);
  if (typeof value === "string") return parseSignedHhMm(value);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const epoch = date1904 ? EXCEL_EPOCH_1904 : EXCEL_EPOCH_1900;
    const minutes = Math.round((value.getTime() - epoch) / 60000);
    return Number.isSafeInteger(minutes) ? minutes : null;
  }
  return null;
}

export function parseExcelDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "string") {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(normalizedText(value));
    if (match) {
      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = Number(match[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
        return date.toISOString().slice(0, 10);
      }
    }
  }
  return null;
}
