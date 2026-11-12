import { z } from "zod";
import { administrationEntities, saveSchemas } from "./contracts";
import { bankMeasurementInputSchema } from "@/lib/time-bank-admin/contracts";

export const registerWorkbookEntities = [...administrationEntities, "bank"] as const;
export type RegisterWorkbookEntity = (typeof registerWorkbookEntities)[number];
export const registerWorkbookMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const registerWorkbookEndpoint = "/api/administration/workbook";
export const registerWorkbookChunkSize = 20;
export const registerWorkbookReasonSchema = z.string().trim().min(5).max(1000);

const operationSchema = z.object({
  entity: z.enum(registerWorkbookEntities),
  line: z.number().int().min(2).max(12001),
  data: z.record(z.string(), z.unknown()),
}).strict();
export type RegisterWorkbookOperation = z.infer<typeof operationSchema>;
export type RegisterWorkbookChange = RegisterWorkbookOperation & { label: string; fields: string[] };
export type RegisterWorkbookIssue = { sheet: string; line: number; message: string };
export type RegisterWorkbookPreview = { changes: RegisterWorkbookChange[]; issues: RegisterWorkbookIssue[]; unchanged: number };
export const registerWorkbookApplySchema = z.object({
  operations: z.array(operationSchema).min(1).max(registerWorkbookChunkSize),
  reason: registerWorkbookReasonSchema,
}).strict();

export function validateWorkbookOperation(operation: RegisterWorkbookOperation, reason: string) {
  const input = { ...operation.data, reason };
  const schema = operation.entity === "bank" ? bankMeasurementInputSchema : saveSchemas[operation.entity];
  const parsed = schema.parse(input);
  if (!parsed.id || !parsed.expectedUpdatedAt) throw new Error("Use uma linha existente da planilha exportada.");
  return parsed;
}
