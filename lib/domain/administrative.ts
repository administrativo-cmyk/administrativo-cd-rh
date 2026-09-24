import type { AttendanceStatusCode } from "@/lib/daily-call-types";

export const operationalEmployeeSituations = ["ATIVO", "FERIAS", "NOVO_ADMITIDO"] as const;

export type EmployeeSituationCode =
  | (typeof operationalEmployeeSituations)[number]
  | "AFASTADO"
  | "DESLIGADO"
  | "AVISO_PREVIO"
  | "LICENCA_MATERNIDADE"
  | "ACIDENTE_TRABALHO"
  | "OUTRO_AFASTAMENTO";

export type UnitEntity = {
  id: string;
  code: string;
  name: string;
  active: boolean;
};

export type ManagerEntity = {
  id: string;
  name: string;
  active: boolean;
  referenceUnitId: string | null;
};

export type EmployeeEntity = {
  id: string;
  employeeNumber: string;
  name: string;
  unitId: string;
  managerId: string | null;
  department: string | null;
  role: string | null;
  situation: EmployeeSituationCode;
  category: string | null;
  admissionDate: string | null;
  movement: string | null;
  currentWorkdayHours: number;
  activeInSystem: boolean;
  observation: string | null;
};

export type DailyAttendanceEntity = {
  id?: string;
  employeeId: string;
  date: string;
  status: AttendanceStatusCode;
  observation?: string | null;
};

export type BankHoursMeasurementEntity = {
  id?: string;
  employeeId: string;
  measurementDate: string;
  effectiveFrom: string;
  workdayHours: number;
  balanceMinutes: number;
  source?: string | null;
  importBatchId?: string | null;
};

export function isOperationalEmployee(
  employee: Pick<EmployeeEntity, "activeInSystem" | "situation">,
): boolean {
  return employee.activeInSystem
    && operationalEmployeeSituations.includes(
      employee.situation as (typeof operationalEmployeeSituations)[number],
    );
}
