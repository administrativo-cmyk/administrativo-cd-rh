import { z } from "zod";
import type { DailyCallSnapshot, Employee, EmployeeSituation, UnitCode } from "@/lib/daily-call-types";

const recordSchema = z.object({
  date: z.string(),
  status: z.enum(["P", "F", "A", "I", "B", "X", "H", "G", "D", "AF"]),
  observation: z.string().nullable(),
});

const employeeSchema = z.object({
  id: z.string().uuid(),
  employeeNumber: z.string(),
  name: z.string(),
  unit: z.enum(["CD I", "CD II", "CD FLV"]),
  department: z.string().nullable(),
  role: z.string().nullable(),
  situation: z.enum(["ATIVO", "FERIAS", "NOVO_ADMITIDO"]),
  manager: z.string().nullable(),
  admissionDate: z.string().nullable(),
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
});

const situations: Record<"ATIVO" | "FERIAS" | "NOVO_ADMITIDO", EmployeeSituation> = {
  ATIVO: "Ativo", FERIAS: "Férias", NOVO_ADMITIDO: "Novo admitido",
};

export function formatBalanceMinutes(value: number): string {
  const sign = value < 0 ? "-" : value > 0 ? "+" : "";
  const minutes = Math.abs(value);
  return `${sign}${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function mapDailyCallSnapshot(raw: unknown): DailyCallSnapshot {
  const result = resultSchema.parse(raw);
  return {
    date: result.date,
    startDate: result.startDate,
    endDate: result.endDate,
    employees: result.employees.map((row): Employee => {
      const attendance: Employee["attendance"] = {};
      const observations: Employee["observations"] = {};
      for (const record of row.attendance) {
        attendance[record.date] = record.status;
        if (record.observation) observations[record.date] = record.observation;
      }
      const hasMeasurement = row.balanceMinutes !== null;
      if (hasMeasurement && (
        row.balanceDays === null || row.measurementDate === null || row.effectiveFrom === null
        || row.workdayHours === null || row.pendingCompensationDays === null || row.replacementDays === null
      )) throw new Error("Medição incompleta na resposta da Chamada Diária");
      return {
        id: row.employeeNumber,
        name: row.name,
        unit: row.unit as UnitCode,
        manager: row.manager ?? "Sem gestor definido",
        department: row.department ?? "Não informado",
        role: row.role ?? "Não informada",
        situation: situations[row.situation],
        admissionDate: row.admissionDate ?? "",
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
      };
    }),
  };
}
