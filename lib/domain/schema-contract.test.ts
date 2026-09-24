import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { attendanceCodes } from "@/lib/daily-call-types";
import { operationalEmployeeSituations } from "./administrative";

const attendanceMigration = readFileSync(
  path.resolve("supabase/migrations/20260923204015_daily_attendance.sql"),
  "utf8",
);
const domainMigration = readFileSync(
  path.resolve("supabase/migrations/20260923204012_domain_foundation.sql"),
  "utf8",
);

function enumValues(sql: string, enumName: string): string[] {
  const match = sql.match(new RegExp(`create type public\\.${enumName} as enum \\(([\\s\\S]*?)\\);`, "i"));
  if (!match) throw new Error(`Enum ${enumName} not found`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

describe("database/domain contract", () => {
  it("keeps attendance codes aligned with the PostgreSQL enum", () => {
    expect(enumValues(attendanceMigration, "codigo_chamada")).toEqual(attendanceCodes);
  });

  it("keeps operational employee situations represented in PostgreSQL", () => {
    const databaseSituations = enumValues(domainMigration, "situacao_colaborador");
    expect(operationalEmployeeSituations.every((situation) => databaseSituations.includes(situation))).toBe(true);
  });
});
