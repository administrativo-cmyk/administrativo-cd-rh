export const attendanceCodes = ["P", "F", "A", "I", "B", "X", "H", "G", "D", "AF"] as const;

export type AttendanceStatusCode = (typeof attendanceCodes)[number];
export type AttendanceCode = AttendanceStatusCode;
export type UnitCode = "CD I" | "CD II" | "CD FLV";
export type EmployeeSituation = "Ativo" | "Férias" | "Novo admitido" | "Afastado";
export type BankSituation = "Em dia" | "A compensar" | "A repor";

export type Unit = { id: string; name: UnitCode };
export type Manager = { id: string; name: string; unitIds: Unit["id"][] };
export type AttendanceStatus = { code: AttendanceStatusCode; label: string; shortLabel: string };
export type AttendanceRecord = { employeeId: string; date: string; status: AttendanceStatusCode; observation?: string };
export type BankHoursSummary = {
  balanceDays: number;
  balanceHours: string;
  pendingCompensationDays: number;
  replacementDays: number;
  usedCompensationDays: number;
  situation: BankSituation;
};

export type Employee = {
  id: string;
  name: string;
  unit: UnitCode;
  manager: Manager["name"];
  department: string;
  role: string;
  situation: EmployeeSituation;
  admissionDate: string;
  plannedVacation: string;
  bankDays: number;
  bankHours: string;
  attendance: Record<string, AttendanceStatusCode>;
  observations: Record<string, string>;
};

export type DailyCallStatusFilter = "Todos" | "Presente" | "Folga" | "Atestado" | "Injustificado" | "Férias" | "INSS" | "Outros";
export type DailyCallFilters = {
  unit: "Todas" | UnitCode;
  manager: "Todos" | Manager["name"];
  query: string;
  bank: "Todos" | BankSituation;
  status: DailyCallStatusFilter;
  startDate: string;
  endDate: string;
};
export type DailyCallMetrics = { collaborators: number; present: number; daysOff: number; absences: number; compensate: number; replace: number };
export type DemoState = "ready" | "loading" | "empty" | "error";
