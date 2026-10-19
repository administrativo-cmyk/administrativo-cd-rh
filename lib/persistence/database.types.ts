import type { AccessRequestStatus, AdministrativeUser, AuthenticatedProfile, UserRole } from "@/lib/auth/types";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type DatabaseEmployeeSituation =
  | "ATIVO"
  | "FERIAS"
  | "NOVO_ADMITIDO"
  | "AFASTADO"
  | "DESLIGADO"
  | "AVISO_PREVIO"
  | "LICENCA_MATERNIDADE"
  | "ACIDENTE_TRABALHO"
  | "OUTRO_AFASTAMENTO";

export type DatabaseAttendanceCode = "P" | "F" | "A" | "I" | "B" | "X" | "H" | "G" | "D" | "AF";

export type UnitRow = {
  id: string;
  codigo: string;
  nome: string;
  ativo: boolean;
  created_at: string;
  updated_at: string;
};

export type ManagerRow = {
  id: string;
  nome: string;
  ativo: boolean;
  unidade_referencia_id: string | null;
  created_at: string;
  updated_at: string;
};

export type EmployeeRow = {
  id: string;
  matricula: string;
  nome: string;
  unidade_id: string;
  gestor_id: string | null;
  setor: string | null;
  funcao: string | null;
  situacao: DatabaseEmployeeSituation;
  categoria: string | null;
  admissao: string | null;
  movimento: string | null;
  jornada_horas_dia_atual: number;
  ativo_no_sistema: boolean;
  observacao: string | null;
  ultimo_lote_importacao_id: string | null;
  created_at: string;
  updated_at: string;
};

export type BankHoursMeasurementRow = {
  id: string;
  colaborador_id: string;
  data_medicao: string;
  aplica_a_partir_de: string;
  jornada_horas_dia: number;
  saldo_minutos: number;
  origem: string | null;
  lote_importacao_id: string | null;
  created_at: string;
};

export type DailyAttendanceRow = {
  id: string;
  colaborador_id: string;
  data: string;
  status: DatabaseAttendanceCode;
  observacao: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type ImportBatchRow = {
  id: string;
  tipo: "EXCEL" | "GOOGLE_SHEETS" | "OUTRO";
  fonte: string | null;
  nome_arquivo: string | null;
  data_referencia: string | null;
  status: "PENDENTE" | "PROCESSANDO" | "CONCLUIDO" | "CONCLUIDO_COM_ERROS" | "FALHOU";
  registros_processados: number;
  registros_com_erro: number;
  source_hash: string | null;
  started_at: string | null;
  completed_at: string | null;
  warnings_agregados: Json;
  created_at: string;
  created_by: string | null;
};

export type ProfileRow = AuthenticatedProfile & {
  cpf_normalizado: string;
  aprovado_em: string | null;
  aprovado_por: string | null;
  bloqueado_em: string | null;
  bloqueado_por: string | null;
};

export type DailyAttendanceAuditRow = {
  id: string; chamada_id: string; colaborador_id: string; data: string;
  status_anterior: DatabaseAttendanceCode | null; status_novo: DatabaseAttendanceCode | null;
  observacao_anterior: string | null; observacao_nova: string | null;
  operacao: "INSERT" | "UPDATE" | "CLEAR"; alterado_por: string; alterado_em: string;
};

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: [];
};

// Public persistence contract through existing_integrity. Runtime schemas still
// validate JSON RPC snapshots. Private helpers are deliberately not exposed here.
export type Database = {
  public: {
    Tables: {
      unidades: Table<UnitRow, "codigo" | "nome">;
      gestores: Table<ManagerRow, "nome">;
      colaboradores: Table<EmployeeRow, "matricula" | "nome" | "unidade_id">;
      banco_horas_medicoes: Table<BankHoursMeasurementRow, "colaborador_id" | "data_medicao" | "aplica_a_partir_de" | "jornada_horas_dia" | "saldo_minutos">;
      chamada_diaria: Table<DailyAttendanceRow, "colaborador_id" | "data" | "status">;
      chamada_diaria_auditoria: Table<DailyAttendanceAuditRow, "chamada_id" | "colaborador_id" | "data" | "operacao" | "alterado_por">;
      lotes_importacao: Table<ImportBatchRow, "tipo">;
      perfis: Table<ProfileRow, "id" | "nome_completo" | "cpf_normalizado">;
    };
    Views: Record<never, never>;
    Functions: {
      daily_call_read: { Args: { p_date: string; p_start: string; p_end: string; p_situation?: string | null }; Returns: Json };
      ler_chamada_diaria: { Args: { p_data: string; p_inicio: string; p_fim: string }; Returns: Json };
      salvar_chamada_diaria: { Args: { p_colaborador_id: string; p_data: string; p_status: DatabaseAttendanceCode | null; p_observacao: string | null; p_expected_updated_at: string | null }; Returns: Json };
      ler_banco_horas_atual: { Args: { p_data: string }; Returns: Json };
      ler_quadro_atual: { Args: Record<string, never>; Returns: Json };
      listar_usuarios: { Args: { p_status?: AccessRequestStatus | null; p_papel?: UserRole | null; p_busca?: string | null }; Returns: AdministrativeUser[] };
      listar_gestores_quadro: { Args: Record<string, never>; Returns: { id: string; nome: string }[] };
      aprovar_usuario: { Args: { p_usuario_id: string; p_papel: UserRole; p_gestor_id?: string | null }; Returns: undefined };
      bloquear_usuario: { Args: { p_usuario_id: string }; Returns: undefined };
      reativar_usuario: { Args: { p_usuario_id: string }; Returns: undefined };
      vincular_gestor_usuario: { Args: { p_usuario_id: string; p_gestor_id: string }; Returns: undefined };
      registrar_ultimo_acesso: { Args: Record<string, never>; Returns: undefined };
    };
    Enums: { situacao_colaborador: DatabaseEmployeeSituation; codigo_chamada: DatabaseAttendanceCode; status_usuario: AccessRequestStatus; papel_usuario: UserRole; tipo_importacao: ImportBatchRow["tipo"]; status_importacao: ImportBatchRow["status"] };
    CompositeTypes: Record<never, never>;
  };
};
