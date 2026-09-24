import { isValidCPF } from "@/lib/auth/cpf";

export type LoginErrors = {
  cpf?: string;
  password?: string;
};

export type RegistrationErrors = LoginErrors & {
  fullName?: string;
  confirmation?: string;
};

export type RegistrationValidationInput = {
  fullName: string;
  cpf: string;
  password: string;
  confirmation: string;
};

export function validateLogin(cpf: string, password: string): LoginErrors {
  const errors: LoginErrors = {};

  if (!isValidCPF(cpf)) errors.cpf = "Informe um CPF válido";
  if (!password) errors.password = "Digite sua senha";
  else if (password.length < 6) errors.password = "Use pelo menos 6 caracteres";

  return errors;
}

export function validateRegistration({ fullName, cpf, password, confirmation }: RegistrationValidationInput): RegistrationErrors {
  const errors: RegistrationErrors = {};

  if (!fullName.trim()) errors.fullName = "Preencha seu nome";
  else if (fullName.trim().split(/\s+/).length < 2) errors.fullName = "Informe seu nome completo";
  if (!isValidCPF(cpf)) errors.cpf = "Informe um CPF válido";
  if (!password) errors.password = "Crie uma senha";
  else if (password.length < 6) errors.password = "Use pelo menos 6 caracteres";
  if (!confirmation) errors.confirmation = "Confirme sua senha";
  else if (password !== confirmation) errors.confirmation = "As senhas não coincidem";

  return errors;
}
