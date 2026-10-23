export type AccessRequestStatus = "PENDENTE" | "APROVADO" | "BLOQUEADO";

export type UserRole = "ADMIN" | "RH" | "GESTOR" | "LEITURA";

export type AuthenticatedProfile = {
  id: string;
  nome_completo: string;
  status_usuario: AccessRequestStatus;
  papel_usuario: UserRole | null;
  gestor_id: string | null;
  visualizar_todos_gestores?: boolean;
  ultimo_acesso_em: string | null;
  created_at: string;
  updated_at: string;
};

export type AdministrativeUser = {
  id: string;
  nome_completo: string;
  cpf_mascarado: string;
  status_usuario: AccessRequestStatus;
  papel_usuario: UserRole | null;
  gestor_id: string | null;
  visualizar_todos_gestores?: boolean;
  created_at: string;
  aprovado_em: string | null;
  bloqueado_em: string | null;
};
