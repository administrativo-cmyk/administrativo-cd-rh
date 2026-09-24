import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CpfField } from "@/components/auth/cpf-field";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { RegistrationSuccess } from "@/components/auth/registration-success";
import { MockAuthService, type AuthService } from "@/lib/auth/auth-service";

const pushMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

function CpfFieldHarness() {
  const [value, setValue] = useState("");
  return <CpfField id="cpf-test" label="CPF" value={value} onChange={setValue} />;
}

async function fillValidRegistration(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nome"), "Marina Duarte");
  await user.type(screen.getByLabelText("Usuário"), "52998224725");
  await user.type(screen.getByLabelText("Senha", { exact: true }), "segura123");
  await user.type(screen.getByLabelText("Confirmar senha"), "segura123");
}

describe("experiência visual de autenticação", () => {
  beforeEach(() => pushMock.mockClear());

  it("renderiza a tela de Login", () => {
    render(<LoginForm service={new MockAuthService(0)} />);
    expect(screen.getByRole("heading", { name: "Bem-vindo(a) de volta!" })).toBeInTheDocument();
    expect(screen.getByLabelText("Usuário")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
  });

  it("formata o CPF durante a digitação", async () => {
    const user = userEvent.setup();
    render(<CpfFieldHarness />);
    await user.type(screen.getByLabelText("CPF"), "52998224725");
    expect(screen.getByLabelText("CPF")).toHaveValue("529.982.247-25");
  });

  it("exibe erro para CPF inválido", async () => {
    const user = userEvent.setup();
    render(<LoginForm service={new MockAuthService(0)} />);
    await user.type(screen.getByLabelText("Usuário"), "11111111111");
    await user.type(screen.getByLabelText("Senha"), "segura123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(screen.getByText("Informe um CPF válido")).toBeInTheDocument();
  });

  it("permite mostrar e ocultar a senha", async () => {
    const user = userEvent.setup();
    render(<LoginForm service={new MockAuthService(0)} />);
    const password = screen.getByLabelText("Senha");
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(password).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Ocultar senha" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("oferece navegação de Login para Cadastro", () => {
    render(<LoginForm service={new MockAuthService(0)} />);
    expect(screen.getByRole("link", { name: "Cadastre-se" })).toHaveAttribute("href", "/cadastro");
  });

  it("informa quando senha e confirmação divergem", async () => {
    const user = userEvent.setup();
    render(<RegisterForm service={new MockAuthService(0)} />);
    await user.type(screen.getByLabelText("Nome"), "Marina Duarte");
    await user.type(screen.getByLabelText("Usuário"), "52998224725");
    await user.type(screen.getByLabelText("Senha", { exact: true }), "segura123");
    await user.type(screen.getByLabelText("Confirmar senha"), "outrasenha");
    await user.click(screen.getByRole("button", { name: "Cadastrar" }));
    expect(screen.getByText("As senhas não coincidem")).toBeInTheDocument();
  });

  it("envia um cadastro válido com CPF normalizado e status pendente", async () => {
    const user = userEvent.setup();
    const signUp = vi.fn().mockResolvedValue({ status: "PENDENTE" as const });
    const service: AuthService = {
      signIn: vi.fn(),
      signUp,
      signOut: vi.fn(),
      resetPassword: vi.fn(),
    };
    render(<RegisterForm service={service} />);
    await fillValidRegistration(user);
    await user.click(screen.getByRole("button", { name: "Cadastrar" }));
    await waitFor(() => expect(signUp).toHaveBeenCalledWith({ fullName: "Marina Duarte", cpf: "52998224725", password: "segura123" }));
  });

  it("navega para a tela de sucesso após o cadastro", async () => {
    const user = userEvent.setup();
    render(<RegisterForm service={new MockAuthService(0)} />);
    await fillValidRegistration(user);
    await user.click(screen.getByRole("button", { name: "Cadastrar" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/cadastro/sucesso"));
  });

  it("mantém a tela de sucesso minimalista com vídeo e botão", () => {
    render(<RegistrationSuccess />);
    expect(screen.getByTestId("registration-success-video")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Voltar para o login" })).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("reproduz o vídeo automaticamente, em loop, silencioso e sem controles", () => {
    render(<RegistrationSuccess />);
    const video = screen.getByTestId("registration-success-video") as HTMLVideoElement;
    expect(video).toHaveAttribute("autoplay");
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute("loop");
    expect(video.muted).toBe(true);
    expect(video).not.toHaveAttribute("controls");
  });

  it("mantém o botão Voltar para o login acessível", () => {
    render(<RegistrationSuccess />);
    expect(screen.getByRole("button", { name: "Voltar para o login" })).toBeInTheDocument();
  });

  it("mostra fallback visual quando o vídeo falha", () => {
    render(<RegistrationSuccess />);
    fireEvent.error(screen.getByTestId("registration-success-video"));
    expect(screen.getByTestId("registration-success-fallback")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Voltar para o login" })).toBeInTheDocument();
  });

  it("volta ao login somente quando o usuário aciona o botão", async () => {
    const user = userEvent.setup();
    render(<RegistrationSuccess />);
    await user.click(screen.getByRole("button", { name: "Voltar para o login" }));
    expect(pushMock).toHaveBeenCalledWith("/login");
  });

  it("mantém Google como ação visual sem OAuth", async () => {
    const user = userEvent.setup();
    const service = new MockAuthService(0);
    const signIn = vi.spyOn(service, "signIn");
    render(<LoginForm service={service} />);
    await user.click(screen.getByRole("button", { name: "Entrar com Google" }));
    expect(screen.getByRole("status")).toHaveTextContent("Integração Google será habilitada em breve.");
    expect(signIn).not.toHaveBeenCalled();
  });
});
