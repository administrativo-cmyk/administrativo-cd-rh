import { z } from "zod";
import { workforceSituations } from "@/lib/workforce";
import type { TimeBankSnapshot } from "@/lib/time-bank";

const employeeSchema = z.object({
  id: z.string().uuid(),
  employeeNumber: z.string(),
  name: z.string(),
  unit: z.string(),
  manager: z.string().nullable(),
  managerId: z.string().uuid().nullable(),
  department: z.string().nullable(),
  role: z.string().nullable(),
  situation: z.enum(workforceSituations),
  workdayHours: z.number().positive(),
  measurementDate: z.string().nullable(),
  effectiveFrom: z.string().nullable(),
  measuredMinutes: z.number().int().nullable(),
  measuredDays: z.number().int().nullable(),
  usedCompensationDays: z.number().int().nonnegative(),
  pendingCompensationDays: z.number().int().nonnegative().nullable(),
  replacementDays: z.number().int().nonnegative().nullable(),
  effectiveDays: z.number().int().nullable(),
});

const snapshotSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employees: z.array(employeeSchema),
});

export function mapTimeBankSnapshot(raw: unknown): TimeBankSnapshot {
  const snapshot = snapshotSchema.parse(raw);
  for (const row of snapshot.employees) {
    const measured = row.measuredMinutes !== null;
    if ([row.measurementDate, row.effectiveFrom, row.measuredDays,
      row.pendingCompensationDays, row.replacementDays, row.effectiveDays]
      .some((value) => (value !== null) !== measured)) {
      throw new Error("Medição incompleta na resposta do Banco de Horas");
    }
    if (!measured && row.usedCompensationDays !== 0) {
      throw new Error("Colaborador sem extrato não pode ter dias G vinculados à medição");
    }
    if (measured && row.effectiveDays !== (
      row.measuredDays! < 0 ? -row.replacementDays! : row.pendingCompensationDays!
    )) {
      throw new Error("Saldo efetivo inconsistente na resposta do Banco de Horas");
    }
  }
  return snapshot;
}
