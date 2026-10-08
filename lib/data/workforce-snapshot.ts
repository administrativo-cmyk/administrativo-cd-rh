import { z } from "zod";
import { workforceSituations, type WorkforceEmployee } from "@/lib/workforce";

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
  category: z.string().nullable(),
  admissionDate: z.string().nullable(),
  workdayHours: z.number().positive(),
  activeInSystem: z.boolean(),
  bankMeasurementDate: z.string().nullable(),
  bankBalanceMinutes: z.number().int().nullable(),
  bankBalanceDays: z.number().int().nullable(),
});

const snapshotSchema = z.object({ employees: z.array(employeeSchema) });

export function mapWorkforceSnapshot(raw: unknown): WorkforceEmployee[] {
  const employees = snapshotSchema.parse(raw).employees;
  for (const employee of employees) {
    const hasMeasurement = employee.bankMeasurementDate !== null;
    if (hasMeasurement !== (employee.bankBalanceMinutes !== null)
      || hasMeasurement !== (employee.bankBalanceDays !== null)) {
      throw new Error("Medição incompleta na resposta do Quadro Atual");
    }
  }
  return employees;
}
