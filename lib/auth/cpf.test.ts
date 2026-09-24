import { describe, expect, it } from "vitest";
import { formatCPF, isValidCPF, normalizeCPF } from "@/lib/auth/cpf";

describe("utilitários de CPF", () => {
  it("normaliza pontuação e limita o valor a onze dígitos", () => {
    expect(normalizeCPF("529.982.247-25abc999")).toBe("52998224725");
  });

  it("formata o CPF progressivamente", () => {
    expect(formatCPF("52998224725")).toBe("529.982.247-25");
    expect(formatCPF("52998")).toBe("529.98");
  });

  it("aceita um CPF com dígitos verificadores válidos", () => {
    expect(isValidCPF("529.982.247-25")).toBe(true);
  });

  it("rejeita CPF repetido ou com dígito verificador inválido", () => {
    expect(isValidCPF("111.111.111-11")).toBe(false);
    expect(isValidCPF("529.982.247-24")).toBe(false);
  });
});
