export const attendanceCodes = ["P", "F", "A", "I", "B", "X", "H", "G", "D", "AF"] as const;

export type AttendanceStatusCode = (typeof attendanceCodes)[number];
export type AttendanceCode = AttendanceStatusCode;
export type AttendanceOrigin = "punch" | "automatic_absence" | "manual" | "schedule";
/** Unit codes come from the authorized organization register. */
export type UnitCode = string;
export type EmployeeSituation = "Ativo" | "Férias" | "Novo admitido" | "Afastado" | "Desligado" | "Aviso prévio" | "Licença-maternidade" | "Acidente de trabalho" | "Outro afastamento";
export type BankSituation = "Em dia" | "A compensar" | "A repor" | "Sem extrato";

export type Unit = { id: string; name: UnitCode };
export type Manager = { id: string; name: string; unitIds: Unit["id"][] };
export type AttendanceStatus = { code: AttendanceStatusCode; label: string; shortLabel: string };
export type AttendanceRecord = { employeeId: string; date: string; status: AttendanceStatusCode; observation?: string };
export type BankHoursSummary = {
  balanceDays: number | null;
  balanceHours: string;
  pendingCompensationDays: number;
  replacementDays: number;
  usedCompensationDays: number;
  situation: BankSituation;
};

export type RealBankSnapshot = {
  measurementDate: string;
  effectiveFrom: string;
  workdayHours: number;
  balanceMinutes: number;
  balanceDays: number;
  pendingCompensationDays: number;
  replacementDays: number;
  usedCompensationDays: number;
};

export type Employee = {
  id: string;
  additionalEmployeeNumbers?: string[];
  databaseId?: string;
  name: string;
  unit: UnitCode;
  manager: Manager["name"];
  department: string;
  role: string;
  situation: EmployeeSituation;
  admissionDate: string;
  terminationDate?: string | null;
  expectedReturnDate?: string | null;
  pendingTerminationDates?: string[];
  activeInSystem?: boolean;
  canWrite?: boolean;
  plannedVacation: string;
  bankDays: number | null;
  bankHours: string | null;
  realBank?: RealBankSnapshot | null;
  attendance: Record<string, AttendanceStatusCode>;
  observations: Record<string, string>;
  attendanceVersions?: Record<string, string>;
  attendanceSources?: Record<string, AttendanceOrigin>;
};

export type DailyCallStatusFilter = "Todos" | "Presente" | "Folga" | "Atestado" | "Injustificado" | "Férias" | "INSS" | "Outros";
export type DailyCallFilters = {
  unit: "Todas" | UnitCode;
  manager: "Todos" | Manager["name"];
  query: string;
  employeeId?: string;
  bank: "Todos" | BankSituation;
  status: DailyCallStatusFilter;
  situation?: string;
  startDate: string;
  endDate: string;
};
export type DailyCallMetrics = { collaborators: number; present: number; daysOff: number; absences: number; compensate: number; replace: number };
export type DailyCallSnapshot = { date: string; startDate: string; endDate: string; employees: Employee[]; payrollPeriods?: string[]; loadedAt?: string };
