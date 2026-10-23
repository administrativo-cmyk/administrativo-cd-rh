import { workforceSituations, situationLabels, type WorkforceSituation } from "@/lib/workforce";
import { z } from "zod";
import type { DailyCallSnapshot, Employee, EmployeeSituation, UnitCode } from "@/lib/daily-call-types";
import { formatSignedMinutes } from "@/lib/domain/bank-hours";

const recordSchema = z.object({
  date: z.string(),
  status: z.enum(["P", "F", "A", "I", "B", "X", "H", "G", "D", "AF"]),
  observation: z.string().nullable(),
  updatedAt: z.string().optional(),
  origin: z.enum(["punch", "automatic_absence", "manual"]).optional(),
});

const employeeSchema = z.object({
  id: z.string().uuid(),
  employeeNumber: z.string(),
  name: z.string(),
  unit: z.string().trim().min(1),
  department: z.string().nullable(),
  role: z.string().nullable(),
  situation: z.enum(workforceSituations),
  manager: z.string().nullable(),
  admissionDate: z.string().nullable(),
  terminationDate: z.string().nullable().optional(),
  expectedReturnDate: z.string().nullable().optional(),
  pendingTerminationDates: z.array(z.string()).optional(),
  activeInSystem: z.boolean().optional(),
  measurementDate: z.string().nullable(),
  effectiveFrom: z.string().nullable(),
  workdayHours: z.number().nullable(),
  balanceMinutes: z.number().int().nullable(),
  balanceDays: z.number().int().nullable(),
  usedCompensationDays: z.number().int(),
  pendingCompensationDays: z.number().int().nullable(),
  replacementDays: z.number().int().nullable(),
  attendance: z.array(recordSchema),
});

const resultSchema = z.object({
  date: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  employees: z.array(employeeSchema),
  payrollPeriods: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).optional(),
});

const situations = situationLabels as Record<WorkforceSituation, EmployeeSituation>;

export function formatBalanceMinutes(value: number): string {
  return formatSignedMinutes(value);
}

export function mapDailyCallSnapshot(raw: unknown): DailyCallSnapshot {
  const result = resultSchema.parse(raw);
  return {
    date: result.date,
    payrollPeriods: result.payrollPeriods,
    startDate: result.startDate,
    endDate: result.endDate,
    employees: result.employees.map((row): Employee => {
      const attendance: Employee["attendance"] = {};
      const observations: Employee["observations"] = {};
      const attendanceVersions: Record<string, string> = {};
      const attendanceSources: NonNullable<Employee["attendanceSources"]> = {};
      for (const record of row.attendance) {
        attendance[record.date] = record.status;
        if (record.observation) observations[record.date] = record.observation;
        if (record.updatedAt) attendanceVersions[record.date] = record.updatedAt;
        attendanceSources[record.date] = record.origin ?? "manual";
      }
      const hasMeasurement = row.balanceMinutes !== null;
      if (hasMeasurement && (
        row.balanceDays === null || row.measurementDate === null || row.effectiveFrom === null
        || row.workdayHours === null || row.pendingCompensationDays === null || row.replacementDays === null
      )) throw new Error("Medição incompleta na resposta da Chamada Diária");
      return {
        id: row.employeeNumber,
        databaseId: row.id,
        name: row.name,
        unit: row.unit as UnitCode,
        manager: row.manager ?? "Sem gestor definido",
        department: row.department ?? "Não informado",
        role: row.role ?? "Não informada",
        situation: situations[row.situation],
        admissionDate: row.admissionDate ?? "",
        terminationDate: row.terminationDate,
        expectedReturnDate: row.expectedReturnDate,
        pendingTerminationDates: row.pendingTerminationDates,
        activeInSystem: row.activeInSystem,
        plannedVacation: "—",
        bankDays: row.balanceDays,
        bankHours: hasMeasurement ? formatBalanceMinutes(row.balanceMinutes!) : null,
        realBank: hasMeasurement ? {
          measurementDate: row.measurementDate!,
          effectiveFrom: row.effectiveFrom!,
          workdayHours: row.workdayHours!,
          balanceMinutes: row.balanceMinutes!,
          balanceDays: row.balanceDays!,
          pendingCompensationDays: row.pendingCompensationDays!,
          replacementDays: row.replacementDays!,
          usedCompensationDays: row.usedCompensationDays,
        } : null,
        attendance,
        observations,
        attendanceVersions,
        attendanceSources,
      };
    }),
  };
}
