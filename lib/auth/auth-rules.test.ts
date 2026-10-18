import { describe, expect, it } from "vitest";
import { assignableRolesFor, canManageRole } from "@/lib/auth/admin-permissions";
import { maskCPF } from "@/lib/auth/cpf";
import { routeRedirectForAccess } from "@/lib/auth/route-access";
import { buildTechnicalEmail, TECHNICAL_AUTH_DOMAIN } from "@/lib/auth/technical-identifier";

describe("identificador técnico de autenticação", () => {
  it("é determinístico para CPF formatado ou normalizado", async () => {
    await expect(buildTechnicalEmail("529.982.247-25")).resolves.toBe(await buildTechnicalEmail("52998224725"));
  });

  it("não expõe o CPF e usa domínio reservado", async () => {
    const email = await buildTechnicalEmail("52998224725");
    expect(email).not.toContain("52998224725");
    expect(email.endsWith(`@${TECHNICAL_AUTH_DOMAIN}`)).toBe(true);
  });

  it("mascara o CPF por padrão", () => {
    expect(maskCPF("52998224725")).toBe("***.***.***-25");
  });
});

describe("proteção de rotas", () => {
  it("envia usuário sem sessão para o login", () => {
    expect(routeRedirectForAccess("/", null)).toBe("/login");
  });

  it("mantém as páginas públicas acessíveis sem sessão", () => {
    expect(routeRedirectForAccess("/cadastro", null)).toBeNull();
    expect(routeRedirectForAccess("/acesso-pendente", null)).toBeNull();
  });

  it("impede pendente de entrar na aplicação", () => {
    expect(routeRedirectForAccess("/", { status: "PENDENTE", role: null })).toBe("/acesso-pendente");
  });

  it("impede bloqueado de entrar na aplicação", () => {
    expect(routeRedirectForAccess("/", { status: "BLOQUEADO", role: "LEITURA" })).toBe("/acesso-bloqueado");
  });

  it("permite aprovado entrar na aplicação", () => {
    expect(routeRedirectForAccess("/", { status: "APROVADO", role: "LEITURA" })).toBeNull();
  });

  it("impede GESTOR e LEITURA de acessar usuários", () => {
    expect(routeRedirectForAccess("/usuarios", { status: "APROVADO", role: "GESTOR" })).toBe("/");
    expect(routeRedirectForAccess("/usuarios", { status: "APROVADO", role: "LEITURA" })).toBe("/");
  });

  it("permite RH e ADMIN acessar usuários", () => {
    expect(routeRedirectForAccess("/usuarios", { status: "APROVADO", role: "RH" })).toBeNull();
    expect(routeRedirectForAccess("/usuarios", { status: "APROVADO", role: "ADMIN" })).toBeNull();
  });

  it("restringe os cadastros organizacionais e mantém dashboards no escopo de cada papel", () => {
    for (const role of ["GESTOR", "LEITURA"] as const) {
      expect(routeRedirectForAccess("/administracao/colaboradores", { status: "APROVADO", role })).toBe("/");
      expect(routeRedirectForAccess("/dashboards/quadro-atual", { status: "APROVADO", role })).toBeNull();
    }
    expect(routeRedirectForAccess("/administracao/unidades", { status: "APROVADO", role: "RH" })).toBeNull();
  });
});

describe("regras administrativas", () => {
  it("ADMIN pode definir qualquer papel", () => {
    expect(assignableRolesFor("ADMIN")).toEqual(["ADMIN", "RH", "GESTOR", "LEITURA"]);
  });

  it("RH aprova somente GESTOR e LEITURA", () => {
    expect(assignableRolesFor("RH")).toEqual(["GESTOR", "LEITURA"]);
  });

  it("GESTOR e LEITURA não atribuem papéis", () => {
    expect(assignableRolesFor("GESTOR")).toEqual([]);
    expect(assignableRolesFor("LEITURA")).toEqual([]);
  });

  it("RH não gerencia ADMIN nem RH", () => {
    expect(canManageRole("RH", "ADMIN")).toBe(false);
    expect(canManageRole("RH", "RH")).toBe(false);
    expect(canManageRole("RH", "GESTOR")).toBe(true);
    expect(canManageRole("RH", "LEITURA")).toBe(true);
  });
});
