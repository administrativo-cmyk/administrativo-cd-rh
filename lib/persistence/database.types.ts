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
  created_at: string;
  created_by: string | null;
};

// Persistence-only contract. Regenerate from the local database with the
// Supabase CLI once Docker is available; UI components must not import it.
