export const workforceSituations = [
  "ATIVO", "FERIAS", "NOVO_ADMITIDO", "AFASTADO", "DESLIGADO",
  "AVISO_PREVIO", "LICENCA_MATERNIDADE", "ACIDENTE_TRABALHO", "OUTRO_AFASTAMENTO",
] as const;

export type WorkforceSituation = (typeof workforceSituations)[number];

export const situationLabels: Record<WorkforceSituation, string> = {
  ATIVO: "Ativo",
  FERIAS: "Férias",
  NOVO_ADMITIDO: "Novo admitido",
  AFASTADO: "Afastado",
  DESLIGADO: "Desligado",
  AVISO_PREVIO: "Aviso prévio",
  LICENCA_MATERNIDADE: "Licença-maternidade",
  ACIDENTE_TRABALHO: "Acidente de trabalho",
  OUTRO_AFASTAMENTO: "Outro afastamento",
};

export type WorkforceEmployee = {
  id: string;
  employeeNumber: string;
  name: string;
  unit: string;
  manager: string | null;
  managerId: string | null;
  department: string | null;
  role: string | null;
  situation: WorkforceSituation;
  category: string | null;
  admissionDate: string | null;
  workdayHours: number;
  activeInSystem: boolean;
  bankMeasurementDate: string | null;
  bankBalanceMinutes: number | null;
  bankBalanceDays: number | null;
};

export type WorkforceFilters = {
  query: string;
  unit: string;
  managerId: string;
  situation: string;
};

export const defaultWorkforceFilters: WorkforceFilters = {
  query: "", unit: "", managerId: "", situation: "",
};
