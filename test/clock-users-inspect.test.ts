import { describe, it, expect } from "vitest";
import { bridgeClockUsers, clockIdentifier, parseClockUsers } from "../scripts/clock-users-inspect.mjs";

const cpf = "01234567890"; // Synthetic identifier with valid check digits.
const pis = "12345678900";
const source = (kind: string, id: string, name = "COLABORADOR TESTE", matricula = "000123") => Buffer.from(`${kind};nome;administrador;matricula;rfid;codigo;senha;barras;faces\n${id};${name};0;${matricula};0;0;secret;0;biometric\n`);

describe("cadastros dos relógios", () => {
  it("usa o cabeçalho e recompõe apenas zeros iniciais, sem converter PIS em CPF", () => {
    expect(clockIdentifier(cpf.slice(1), "cpf")).toEqual({ value: cpf, valid: true, padded: true });
    expect(clockIdentifier(cpf, "pis").valid).toBe(false);
    expect(clockIdentifier("0" + pis, "pis").valid).toBe(false);
    expect(clockIdentifier("0", "cpf").valid).toBe(false);
  });
  it("descarta senhas e biometria e conserva evidência de linha", () => {
    const result = parseClockUsers(source("cpf", cpf), "clock.txt");
    expect(result.entries[0]).toMatchObject({ cpf, pis: null, employeeNumber: "123", sourceRow: 2, conflicts: [] });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("biometric");
  });
  it("decodifica exportação Windows-1252 sem perder acentos", () => {
    const result = parseClockUsers(Buffer.from(source("cpf", cpf, "JOSÉ TESTE").toString(), "latin1"), "clock.txt");
    expect(result.summary.encoding).toBe("windows-1252");
    expect(result.entries[0].fullName).toBe("JOSÉ TESTE");
  });
  it("bloqueia identidade com dois nomes e matrícula ausente", () => {
    const bytes = Buffer.from(source("cpf", cpf).toString() + `${cpf};OUTRO NOME;0;0;0;0;;0;\n`);
    const result = parseClockUsers(bytes, "clock.txt");
    expect(result.entries[0].conflicts).toContain("IDENTITY_MULTIPLE_NAMES");
    expect(result.entries[1].conflicts).toContain("MISSING_EMPLOYEE_NUMBER");
  });
  it("cruza somente matrícula e nome coincidentes entre os relógios", () => {
    const a = parseClockUsers(source("cpf", cpf), "cpf.txt").entries;
    const b = parseClockUsers(source("pis", pis), "pis.txt").entries;
    expect(bridgeClockUsers([...a, ...b]).bridges).toHaveLength(1);
    b[0].fullName = "OUTRO NOME";
    expect(bridgeClockUsers([...a, ...b])).toMatchObject({ bridges: [], conflicts: [{ code: "CROSS_CLOCK_CONFLICT" }] });
  });
  it("recusa estrutura desconhecida e linhas com colunas a mais", () => {
    expect(() => parseClockUsers(Buffer.from("id;nome;matricula\n"), "bad.txt")).toThrow("UNSUPPORTED_CLOCK_USER_HEADER");
    const result = parseClockUsers(Buffer.from(source("cpf", cpf).toString().trimEnd() + ";extra\n"), "bad.txt");
    expect(result.entries).toHaveLength(0);
    expect(result.rejectedRows).toHaveLength(1);
  });
});
