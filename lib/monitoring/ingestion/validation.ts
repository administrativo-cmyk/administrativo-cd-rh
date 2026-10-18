import { createHash } from "node:crypto";
import type { IdentifierType } from "./types.ts";

export class ImportError extends Error {
  readonly code: string;
  readonly httpStatus?: number;
  readonly apiCode?: string;
  readonly correlationId?: string;
  constructor(code: string, context?: { httpStatus: number; apiCode?: string; correlationId?: string }) {
    super(code); this.code = code; this.name = "ImportError";
    if (context) { this.httpStatus = context.httpStatus; this.apiCode = context.apiCode; this.correlationId = context.correlationId; }
  }
}

export const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
export const normalizeLabel = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
export function stableHash(value: unknown): string {
  const stable = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(stable) : entry && typeof entry === "object" ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : entry;
  return sha256(JSON.stringify(stable(value)));
}

/** Layout padding is explicit. Invalid identifiers never undergo truncation. */
export function normalizeIdentifier(raw: string, type: IdentifierType, layoutPadding = false): string {
  let value = raw.trim();
  if (type === "defense") {
    if (!value || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value)) throw new ImportError("INVALID_DEFENSE_ID");
    return value;
  }
  if (layoutPadding && /^0\d{11}$/.test(value)) value = value.slice(1);
  if (!/^\d{11}$/.test(value)) throw new ImportError(`INVALID_${type.toUpperCase()}_LENGTH`);
  if (/^(\d)\1+$/.test(value)) throw new ImportError(`INVALID_${type.toUpperCase()}_CHECK_DIGIT`);
  const numbers = value.split("").map(Number);
  if (type === "cpf") {
    for (const size of [9, 10]) {
      const sum = numbers.slice(0, size).reduce((total, digit, index) => total + digit * (size + 1 - index), 0);
      const digit = ((sum * 10) % 11) % 10;
      if (numbers[size] !== digit) throw new ImportError("INVALID_CPF_CHECK_DIGIT");
    }
  } else {
    const weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const result = 11 - numbers.slice(0, 10).reduce((total, digit, index) => total + digit * weights[index], 0) % 11;
    if (numbers[10] !== (result >= 10 ? 0 : result)) throw new ImportError("INVALID_PIS_CHECK_DIGIT");
  }
  return value;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const localParts = (epoch: number, timeZone: string): number[] => {
  let formatter = formatters.get(timeZone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); formatters.set(timeZone, formatter); }
  const values = formatter.formatToParts(new Date(epoch));
  return ["year", "month", "day", "hour", "minute", "second"].map(key => Number(values.find(value => value.type === key)?.value));
};

export function parseLocalTimestamp(value: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new ImportError("INVALID_TIMESTAMP");
  const parts = match.slice(1).map(Number);
  const naive = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  if (parts[0] < 1900 || parts[0] > 2200 || new Date(naive).toISOString().slice(0, 19) !== value.replace(" ", "T")) throw new ImportError("INVALID_TIMESTAMP");
  let guess = naive;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const actual = localParts(guess, timeZone);
      guess += naive - Date.UTC(actual[0], actual[1] - 1, actual[2], actual[3], actual[4], actual[5]);
    }
    if (localParts(guess, timeZone).some((part, index) => part !== parts[index])) throw new ImportError("NONEXISTENT_LOCAL_TIMESTAMP");
    // Reject ambiguous DST times rather than silently choosing one offset.
    for (const delta of [-7_200_000, -3_600_000, 3_600_000, 7_200_000]) {
      if (localParts(guess + delta, timeZone).every((part, index) => part === parts[index])) throw new ImportError("AMBIGUOUS_LOCAL_TIMESTAMP");
    }
    return new Date(guess).toISOString();
  } catch (error) { if (error instanceof ImportError) throw error; throw new ImportError("INVALID_SOURCE_TIME_ZONE"); }
}

export function parseOffsetTimestamp(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([+-])(\d{2})(\d{2})$/.exec(value);
  if (!match || Number(match[3]) > 14 || Number(match[4]) > 59 || (Number(match[3]) === 14 && Number(match[4]) !== 0)) throw new ImportError("INVALID_TIMESTAMP_OFFSET");
  parseLocalTimestamp(match[1], "UTC");
  const epoch = Date.parse(`${match[1]}${match[2]}${match[3]}:${match[4]}`);
  if (!Number.isFinite(epoch)) throw new ImportError("INVALID_TIMESTAMP");
  return new Date(epoch).toISOString();
}

export const errorCode = (error: unknown): string => error instanceof ImportError ? error.code : "IMPORT_UNEXPECTED_ERROR";
