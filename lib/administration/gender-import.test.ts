import { describe, expect, it } from "vitest";
import { planConfirmedGenderImport } from "./gender-import";

const people = [{ id: "a", employeeNumber: "000123", name: "Pessoa Ágata Sintética", updatedAt: "v1" }, { id: "b", employeeNumber: "456", name: "Outra Pessoa", updatedAt: "v2" }];
describe("importação de gênero explicitamente informado", () => {
  it("usa sexo da fonte, matrícula e nome normalizado, preservando zeros", () => {
    const result = planConfirmedGenderImport([{ row: 2, employeeNumber: "000123", name: " PESSOA AGATA  SINTÉTICA ", sex: "M" }], people);
    expect(result.assignments).toMatchObject([{ employeeId: "a", gender: "masculino", sourceRows: [2] }]);
    expect(result.blank).toMatchObject([{ employeeId: "b" }]);
  });
  it("aceita matrícula adicional confirmada, sem usar nome como classificação", () => {
    expect(planConfirmedGenderImport([{ row: 3, employeeNumber: "999", name: people[0].name, sex: "F" }], people, [{ number: "999", employeeId: "a" }]).assignments[0].gender).toBe("feminino");
  });
  it("não preenche quando só o nome coincide, o nome diverge ou o sexo está vazio", () => {
    const result = planConfirmedGenderImport([
      { row: 2, employeeNumber: "999", name: people[0].name, sex: "F" },
      { row: 3, employeeNumber: "456", name: people[0].name, sex: "M" },
      { row: 4, employeeNumber: "000123", name: people[0].name, sex: "" },
    ], people);
    expect(result.assignments).toEqual([]); expect(result.blank).toHaveLength(2); expect(result.rejected).toHaveLength(3);
  });
  it("bloqueia valores conflitantes e matrículas ambíguas", () => {
    const rows = ["M", "F"].map((sex, index) => ({ row: index + 2, employeeNumber: "000123", name: people[0].name, sex }));
    expect(planConfirmedGenderImport(rows, people).assignments).toEqual([]);
    expect(planConfirmedGenderImport(rows.slice(0, 1), people, [{ number: "000123", employeeId: "b" }]).assignments).toEqual([]);
  });
  it("confere chapa com zeros de preenchimento sem alterar matrícula e rejeita colisões", () => {
    const row = { row: 2, employeeNumber: "000456", name: people[1].name, sex: "M" };
    expect(planConfirmedGenderImport([row], people).assignments[0]).toMatchObject({ employeeId: "b", employeeNumber: "456" });
    expect(planConfirmedGenderImport([row], [...people, { ...people[0], employeeNumber: "0456" }]).assignments).toEqual([]);
  });
});
