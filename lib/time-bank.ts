import type { WorkforceSituation } from "@/lib/workforce";

export type TimeBankClassification = "POSITIVO" | "ZERO" | "NEGATIVO" | "SEM_EXTRATO";

export type TimeBankEmployee = {
  id: string;
  employeeNumber: string;
  name: string;
  unit: string;
  manager: string | null;
  managerId: string | null;
  department: string | null;
  role: string | null;
  situation: WorkforceSituation;
  workdayHours: number;
  measurementDate: string | null;
  effectiveFrom: string | null;
  measuredMinutes: number | null;
  measuredDays: number | null;
  usedCompensationDays: number;
  pendingCompensationDays: number | null;
  replacementDays: number | null;
  effectiveDays: number | null;
};

export type TimeBankSnapshot = {
  asOfDate: string;
  employees: TimeBankEmployee[];
};

export type TimeBankFilters = {
  query: string;
  unit: string;
  managerId: string;
  situation: string;
  classification: string;
};

export const defaultTimeBankFilters: TimeBankFilters = {
  query: "", unit: "", managerId: "", situation: "", classification: "",
};
