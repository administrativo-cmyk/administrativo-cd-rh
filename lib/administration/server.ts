import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/persistence/database.types";
import type { AdministrationAction, AdministrationEntity } from "./contracts";

type AdministrationDatabase = { public: { Tables: Record<never, never>; Views: Record<never, never>; Functions: { administration: { Args: { p_entity: string; p_action: string; p_data: Json }; Returns: Json } }; Enums: Record<never, never>; CompositeTypes: Record<never, never> } };
const errors: Record<string, string> = {
  ADMINISTRATION_FORBIDDEN: "Acesso não autorizado.", ADMINISTRATION_INVALID_INPUT: "Revise os campos informados.", ADMINISTRATION_NOT_FOUND: "Cadastro não encontrado.",
  ADMINISTRATION_STALE: "Este cadastro foi alterado por outra pessoa. Atualize antes de salvar.", ADMINISTRATION_INACTIVE_REFERENCE: "Selecione referências ativas: unidade, gestor, pessoa, setor, cargo e categoria.",
  ADMINISTRATION_REFERENCED: "Há cadastros ativos vinculados. Transfira ou desative os vínculos antes de arquivar.", ADMINISTRATION_VACATION_OVERLAP: "Já há férias aprovadas nesse período.",
  ADMINISTRATION_VACATION_LOCKED: "Esta programação exige revisão de ADMIN ou RH.", ADMINISTRATION_DUPLICATE: "Já existe um cadastro equivalente com esse nome, código ou matrícula.",
  ADMINISTRATION_ARCHIVED: "Restaure o cadastro antes de editá-lo.",
  EMPLOYEE_LIFECYCLE_DATES: "Informe datas válidas: desligamento, início da situação e retorno previsto. Ao reativar, informe a data efetiva do retorno.",
  EMPLOYEE_IDENTIFIER_INVALID: "CPF ou PIS inválido. Informe os 11 dígitos.",
  EMPLOYEE_IDENTIFIER_CONFLICT: "CPF ou PIS já pertence a outro colaborador. Confira os vínculos na Conciliação.",
};
export async function administrationQuery(entity: AdministrationEntity, action: AdministrationAction, data: unknown) {
  const client = await createClient<AdministrationDatabase>();
  const result = await client.rpc("administration", { p_entity: entity, p_action: action, p_data: data as Json });
  if (result.error) {
    const code = Object.keys(errors).find(key => result.error.message.includes(key)) ?? (result.error.code === "23505" ? "ADMINISTRATION_DUPLICATE" : result.error.code);
    throw Object.assign(new Error(errors[code] ?? "Não foi possível concluir a operação administrativa."), { code });
  }
  return result.data;
}
export function administrationFailure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "ADMINISTRATION_UNAVAILABLE";
  const status = code === "42501" || code === "ADMINISTRATION_FORBIDDEN" ? 403 : code === "ADMINISTRATION_NOT_FOUND" ? 404 : code === "ADMINISTRATION_INVALID_INPUT" || code === "22023" ? 400 : errors[code] ? 409 : 503;
  return Response.json({ code, error: errors[code] ?? "Administração indisponível. Confira a instalação e tente novamente." }, { status, headers: { "Cache-Control": "private, no-store" } });
}
