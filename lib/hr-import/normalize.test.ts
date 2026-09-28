import { describe, expect, it } from "vitest";
import { convertHoursToDays } from "../domain/bank-hours";
import {
  comparableText, journeyMinutesForFunction, normalizeSituation, normalizeUnit,
  normalizedHeader, normalizedText, parseExcelDate, parseExcelDurationMinutes,
  parseMatricula, parseSignedHhMm,
} from "./normalize";

describe("normalização da fonte RH", () => {
  it("preserva matrícula textual e zeros à esquerda", () => {
    expect(parseMatricula("  001234  ")).toBe("001234");
    expect(parseMatricula(1234, "000000")).toBe("001234");
    expect(parseMatricula(1234)).toBe("1234");
    expect(parseMatricula(12.5)).toBeNull();
    expect(parseMatricula(null)).toBeNull();
    expect(parseMatricula("=HYPERLINK(\"https://example.invalid\")")).toBeNull();
  });

  it("normaliza somente espaços do nome e compara sem fundir identidades", () => {
    expect(normalizedText("  Ana   Exemplo  ")).toBe("Ana Exemplo");
    expect(comparableText("Gestora Árvore")).toBe("GESTORA ARVORE");
    expect(comparableText("Gestora Árvore")).not.toBe(comparableText("Gestora Ribeiro"));
    expect(normalizedHeader("  Nome\nFuncão ")).toBe("NOME FUNCAO");
  });

  it.each([
    ["CENTRO DE DISTRIBUICAO", "CD I"],
    ["CENTRO DE DISTRIBUICAO II", "CD II"],
    ["CD FLV", "CD FLV"],
    ["Unidade inventada", null],
  ])("mapeia unidade %s", (source, expected) => {
    expect(normalizeUnit(source)).toBe(expected);
  });

  it.each([
    ["Ativo", "ATIVO"], ["Férias", "FERIAS"], ["Af.Previdência", "AFASTADO"],
    ["Aviso Prévio", "AVISO_PREVIO"], ["Licença Mater.", "LICENCA_MATERNIDADE"],
    ["Af.Ac.Trabalho", "ACIDENTE_TRABALHO"], ["Outros", "OUTRO_AFASTAMENTO"],
    ["Valor novo", null],
  ])("mapeia situação %s", (source, expected) => {
    expect(normalizeSituation(source)).toBe(expected);
  });

  it.each([
    ["ARMAZENISTA", 440], ["APOIO PREVENCAO E PERDAS", 720],
    ["APRENDIZ ADM", 360], ["PCD", 360], ["MENOR APRENDIZ LOJA", 240],
  ])("deriva jornada de %s", (role, minutes) => {
    expect(journeyMinutesForFunction(role)).toBe(minutes);
  });
});

describe("tempo e saldo assinados", () => {
  it.each([
    ["07:17", 437], ["+07:17", 437], ["-07:17", -437],
    ["00:00", 0], ["27:35", 1655], ["07:60", null], ["abc", null],
  ])("interpreta HH:MM %s", (source, expected) => {
    expect(parseSignedHhMm(source)).toBe(expected);
  });

  it("converte fração de dia Excel, inclusive sinal e valores acima de 24h", () => {
    expect(parseExcelDurationMinutes(0.5)).toBe(720);
    expect(parseExcelDurationMinutes(0.25)).toBe(360);
    expect(parseExcelDurationMinutes(-0.5)).toBe(-720);
    expect(parseExcelDurationMinutes(new Date("1899-12-31T04:35:00.000Z"))).toBe(1715);
    expect(parseExcelDurationMinutes(new Date("1899-12-29T16:43:00.000Z"))).toBe(-437);
  });

  it("converte minutos em dias com limite estrito de 5 horas, reaproveitando o domínio", () => {
    expect(convertHoursToDays(300 / 60, 440 / 60)).toBe(0);
    expect(convertHoursToDays(301 / 60, 440 / 60)).toBe(1);
    expect(convertHoursToDays(-300 / 60, 440 / 60)).toBe(0);
    expect(convertHoursToDays(-301 / 60, 440 / 60)).toBe(-1);
    expect(convertHoursToDays(17, 12)).toBe(1);
    expect(convertHoursToDays(11, 6)).toBe(1);
    expect(convertHoursToDays(9, 4)).toBe(2);
  });

  it("valida datas de admissão sem adivinhar formato", () => {
    expect(parseExcelDate(new Date("2026-09-13T00:00:00Z"))).toBe("2026-09-13");
    expect(parseExcelDate("13/09/2026")).toBe("2026-09-13");
    expect(parseExcelDate("31/02/2026")).toBeNull();
  });
});
