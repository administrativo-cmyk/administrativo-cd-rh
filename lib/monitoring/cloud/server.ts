import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { workerClient } from "@/lib/monitoring/server";
import { allowedIngestSource } from "@/lib/monitoring/ingest-security";
import type { Json } from "@/lib/monitoring/database";

export const cloudBucket = "monitoramento-originais";
export const cloudMaxFileBytes = 20 * 1024 * 1024;
const sourceSchema = z.object({
  id: z.string().min(1).max(80), kind: z.enum(["afd", "defense-access", "defense-person"]),
  timeZone: z.string().min(1), identityNamespace: z.string().min(1), sourceIdentityConfirmed: z.boolean(),
  declaredCoverage: z.object({ from: z.string(), to: z.string(), continuous: z.boolean() }).nullish(),
  afdProfile: z.enum(["legacy", "iso"]).optional(), encoding: z.enum(["utf8", "latin1"]).optional(),
});
export const cloudJobSchema = z.object({
  id: z.string().uuid(), sourceId: z.string(), source: sourceSchema,
  fileName: z.string().min(1).max(240), objectPath: z.string().min(1), bucket: z.literal(cloudBucket),
  byteLength: z.number().int().positive().max(cloudMaxFileBytes), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  parserVersion: z.string(), status: z.enum(["uploading", "queued", "processing", "completed", "failed", "cancelled"]),
  cursor: z.number().int().nonnegative(), processedRows: z.number().int().nonnegative(),
  totalRows: z.number().int().nonnegative().nullable(), totalBatches: z.number().int().positive().nullable(),
  attempts: z.number().int().nonnegative(), maxAttempts: z.number().int().positive(),
  nextRetryAt: z.string().nullable(), lastError: z.string().nullable(),
  createdAt: z.string(), updatedAt: z.string(), completedAt: z.string().nullable(),
  plan: z.unknown().nullish(), leaseToken: z.string().uuid().optional(), leaseExpiresAt: z.string().optional(),
});
export type CloudJob = z.infer<typeof cloudJobSchema>;
type CloudDatabase = { public: { Tables: Record<never, never>; Views: Record<never, never>; Enums: Record<never, never>; CompositeTypes: Record<never, never>; Functions: {
  monitoring_cloud_admin: { Args: { p_action: string; p_data: Json }; Returns: Json };
} } };

export class CloudError extends Error {
  constructor(readonly code: string) { super(code); }
}
function rpcError(error: { code?: string; message?: string }): never {
  const businessCode = error.message?.match(/\b(?:CLOUD|SOURCE|MONITORING)_[A-Z_]+\b/)?.[0];
  const code = error.code ?? "";
  const transient = !code || /^(08|53|57P|PGRST00)/.test(code) || ["40001", "40P01", "57014"].includes(code);
  throw new CloudError(businessCode ?? (transient ? "CLOUD_UNAVAILABLE" : code));
}
export async function cloudAdmin(action: string, data: unknown = {}) {
  const client = await createClient<CloudDatabase>();
  const result = await client.rpc("monitoring_cloud_admin", { p_action: action, p_data: data as Json });
  if (result.error) rpcError(result.error);
  return result.data;
}
export async function cloudWorker(action: string, data: unknown = {}, signal?: AbortSignal) {
  const query = workerClient().rpc("monitoring_cloud_worker", { p_action: action, p_data: data as Json });
  const result = await (signal ? query.abortSignal(signal) : query);
  if (result.error) rpcError(result.error);
  return result.data;
}
export function cloudJob(value: unknown): CloudJob {
  return z.object({ job: cloudJobSchema }).parse(value).job;
}
export function publicCloudJob(job: CloudJob) {
  return {
    id: job.id, fileName: job.fileName, sourceId: job.sourceId, status: job.status, bytes: job.byteLength,
    batchesDone: job.cursor, totalBatches: job.totalBatches, processedRows: job.processedRows, totalRows: job.totalRows,
    attempts: job.attempts, maxAttempts: job.maxAttempts, nextRetryAt: job.nextRetryAt, errorCode: job.lastError,
    createdAt: job.createdAt, updatedAt: job.updatedAt, completedAt: job.completedAt,
  };
}
export function assertCloudSource(sourceId: string) {
  if (!allowedIngestSource(sourceId)) throw new CloudError("CLOUD_SOURCE_FORBIDDEN");
}
export function cloudObjectPath(job: CloudJob) {
  // Only the opaque path assigned by the database may reach Storage. Never accept a URL or client path.
  if (!job.objectPath.startsWith(`${job.id}/`) || !/^[a-zA-Z0-9/_.-]+$/.test(job.objectPath)
    || job.objectPath.split("/").some(part => !part || part === "." || part === "..")) throw new CloudError("CLOUD_OBJECT_INVALID");
  return job.objectPath;
}
export function dispatchHash(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) throw new CloudError("CLOUD_DISPATCH_INVALID");
  return createHash("sha256").update(token).digest("hex");
}
const messages: Record<string, string> = {
  CLOUD_INVALID: "Revise o arquivo e a fonte selecionada.", CLOUD_NOT_FOUND: "Envio não encontrado.",
  CLOUD_STALE: "O envio mudou. Atualize a lista e tente novamente.", CLOUD_SOURCE_FORBIDDEN: "Fonte não autorizada neste servidor.",
  CLOUD_SOURCE_CHANGED: "A configuração da fonte mudou. Revise a fonte antes de enviar novamente.",
  CLOUD_SOURCE_DISABLED: "A fonte está desativada.", SOURCE_DISABLED: "A fonte está desativada.",
  CLOUD_UPLOAD_MISSING: "O arquivo ainda não chegou ao servidor. Conclua o envio antes de confirmar.",
  CLOUD_UPLOAD_INVALID: "O arquivo armazenado diverge do envio. Selecione o arquivo novamente.",
  CLOUD_QUOTA: "O limite da fila ou dos arquivos armazenados foi atingido. Solicite a revisão ao administrador.",
  CLOUD_STATE: "Esta ação não está disponível para o estado atual do envio.", CLOUD_ATTEMPTS_EXHAUSTED: "O limite de tentativas foi atingido. Revise o erro antes de enviar novamente.",
  CLOUD_DISPATCH_INVALID: "Chamada automática inválida ou expirada.", CLOUD_FORBIDDEN: "Acesso não autorizado.",
  CLOUD_INVALID_FILE: "Revise o formato, o nome e o tamanho do arquivo.", CLOUD_SOURCE_UNAVAILABLE: "A fonte não existe ou está desativada.",
  CLOUD_DUPLICATE_DIFFERENT_SOURCE: "Este arquivo já foi recebido com outra configuração. Revise a fonte e o histórico.",
  CLOUD_INVALID_STATE: "O estado do envio não permite esta ação. Atualize a lista.",
  CLOUD_RETRY_UNAVAILABLE: "Não é possível repetir este envio. Confira o erro antes de enviar o arquivo novamente.",
  CLOUD_AUTOMATION_DISABLED: "A importação na nuvem aguarda ativação do agendamento. O envio será liberado após a configuração.",
};
export function cloudFailure(error: unknown) {
  const code = error instanceof CloudError ? error.code : error instanceof z.ZodError || error instanceof SyntaxError ? "CLOUD_INVALID" : "CLOUD_UNAVAILABLE";
  const status = code === "CLOUD_DISPATCH_INVALID" ? 401 : code === "42501" || code.endsWith("FORBIDDEN") ? 403 : code === "CLOUD_NOT_FOUND" ? 404 : ["CLOUD_INVALID", "CLOUD_INVALID_FILE"].includes(code) ? 400 : messages[code] ? 409 : 503;
  // Errors from Storage/SQL can contain object paths or data; expose only the stable code.
  return Response.json({ error: messages[code] ?? "Não foi possível concluir a importação. Tente novamente.", code }, { status, headers: { "Cache-Control": "private, no-store" } });
}
