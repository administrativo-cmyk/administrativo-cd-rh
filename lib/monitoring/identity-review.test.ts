import { describe, expect, it } from "vitest";
import { identityReviewCandidates } from "./identity-review";

describe("candidatos para conferência", () => {
  const employees = [
    { id: "one", name: "Ana Lúcia Sintética", employeeNumber: "000001" },
    { id: "two", name: "ANA LUCIA SINTETICA", employeeNumber: "000002" },
    { id: "three", name: "Ana Lúcia Sintética Silva", employeeNumber: "000003" },
  ];
  it("mostra todos os homônimos, preserva identificadores e não altera cadastros", () => {
    const before = JSON.stringify(employees);
    expect(identityReviewCandidates("  ana   lucia sintética ", employees).map((person) => person.employeeNumber)).toEqual(["000001", "000002"]);
    expect(JSON.stringify(employees)).toBe(before);
  });
  it.each([null, undefined, "", "Ana", "Ana Lúcia", "Sintética Ana Lúcia", "Ana L. Sintética", "000001"])("não aproxima nome ou matrícula %s", (name) => {
    expect(identityReviewCandidates(name, employees)).toEqual([]);
  });
});
