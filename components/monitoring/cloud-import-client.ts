import { z } from "zod";

export const cloudFileLimit = 20 * 1024 * 1024;
export const cloudStatusSchema = z.enum(["uploading", "queued", "processing", "completed", "failed", "cancelled"]);
export const cloudJobSchema = z.object({
  archivedRows:z.number().int().nonnegative().optional(),
  id: z.string().min(1), fileName: z.string(), sourceId: z.string(), status: cloudStatusSchema,
  rejectedRows: z.number().int().nonnegative().optional(), canReinspect: z.boolean().optional(), autoDetect: z.boolean().optional(), bytes: z.number().int().nonnegative(), createdAt: z.string(), updatedAt: z.string(),
  batchesDone: z.number().int().nonnegative(), totalBatches: z.number().int().nonnegative().nullable(), errorCode: z.string().nullable(),
});
export const cloudSnapshotSchema = z.object({
  sources: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(["afd", "defense-access", "defense-person"]), afdProfile: z.enum(["legacy", "iso"]).optional().nullable() })),
  jobs: z.array(cloudJobSchema), maxFileBytes: z.number().int().positive(), automationReady: z.boolean().default(false),
});
const cloudUploadReservationSchema = z.object({ id: z.string().min(1), upload: z.object({ url: z.string().url(), token: z.string().min(1), path: z.string().min(1), bucket: z.string().min(1) }) });
export const cloudReservationSchema = z.union([cloudUploadReservationSchema, z.object({ id: z.string().min(1), status: z.enum(["queued", "processing", "completed"]), alreadyUploaded: z.literal(true) })]);
export const cloudActionSchema = z.object({ id: z.string().min(1), status: cloudStatusSchema, updatedAt: z.string().optional() });
export type CloudJob = z.infer<typeof cloudJobSchema>;
export type CloudSnapshot = z.infer<typeof cloudSnapshotSchema>;
export type CloudReservation = z.infer<typeof cloudUploadReservationSchema>;
export type CloudPhase = "idle" | "hashing" | "authorizing" | "uploading" | "confirming";
export const cloudStatusLabels: Record<CloudJob["status"], string> = { uploading: "Aguardando confirmação do envio", queued: "Na fila da nuvem", processing: "Processando na nuvem", completed: "Concluído", failed: "Falhou", cancelled: "Cancelado" };
const errorLabels: Record<string, string> = {
  ARCHIVE_MAINTENANCE:"O histórico está em manutenção. Os arquivos e lotes confirmados estão preservados.",
  ARCHIVE_DATABASE_CAPACITY:"A importação foi pausada antes do limite do banco. Solicite a conferência da manutenção do histórico.",
  ARCHIVE_STORAGE_BUDGET_EXCEEDED:"O histórico se aproxima do limite gratuito de armazenamento. Solicite a revisão ao administrador.",
  "25006": "O banco está em somente leitura. Revise a capacidade do Supabase antes de retomar a importação.",
  "53100": "O banco está sem espaço disponível. Revise a capacidade do Supabase; os lotes confirmados permanecem preservados.",
  INVALID_FILE_ENCODING: "A codificação do AFD não foi reconhecida. Clique em Tentar novamente para reler o original com detecção automática.",
  CLOUD_IDENTITY_AMBIGUOUS: "Não foi possível distinguir CPF de PIS com segurança. O original foi preservado; solicite a conferência ao administrador.",
  CLOUD_IDENTITY_TYPE_REQUIRED: "O leitor foi atualizado. Clique em Tentar novamente para identificar CPF/PIS.",
  CLOUD_FORMAT_UNKNOWN: "Conteúdo não reconhecido. Envie a exportação AFD ou Defense original.",
  CLOUD_FORMAT_AMBIGUOUS: "O arquivo mistura formatos. Exporte cada relatório separadamente.",
  CLOUD_ROUTE_AMBIGUOUS: "Mais de uma fonte corresponde ao arquivo. Solicite a revisão da configuração ao administrador.",
  CLOUD_AUTOMATION_DISABLED: "A importação aguarda ativação da automação no servidor. Solicite a ativação ao administrador e atualize os envios.",
  CLOUD_INVALID: "Revise o arquivo, a fonte e o formato selecionado antes de enviar novamente.",
  CLOUD_INVALID_FILE: "Revise o arquivo, a fonte e o formato selecionado antes de enviar novamente.",
  CLOUD_NOT_FOUND: "Envio não encontrado. Atualize o histórico.",
  CLOUD_SOURCE_FORBIDDEN: "Esta fonte não está autorizada no servidor. Confira a configuração com o administrador.",
  CLOUD_SOURCE_CHANGED: "A configuração da fonte mudou. Revise a fonte antes de enviar novamente.",
  CLOUD_SOURCE_DISABLED: "A fonte foi desativada. Atualize a lista e escolha uma fonte ativa.",
  CLOUD_SOURCE_UNAVAILABLE: "A fonte não está disponível. Atualize a lista e confira se ela está ativa.",
  CLOUD_DUPLICATE_DIFFERENT_SOURCE: "Este arquivo já possui um envio com outra configuração da fonte. Confira o histórico e a configuração antes de prosseguir.",
  CLOUD_UPLOAD_MISSING: "O arquivo ainda não foi recebido. Aguarde o envio ou selecione o arquivo novamente.",
  CLOUD_UPLOAD_INVALID: "O arquivo recebido difere do selecionado. Cancele este envio e envie o original novamente.",
  CLOUD_SNAPSHOT_HASH_MISMATCH: "O arquivo recebido difere do selecionado. Cancele este envio e envie o original novamente.",
  CLOUD_SNAPSHOT_TOO_LARGE: "O arquivo excede o limite permitido. Envie uma exportação menor.",
  CLOUD_AFD_PROFILE_MISMATCH: "O envio antigo usou outro formato. Clique em Tentar novamente para identificar automaticamente o original armazenado.",
  CLOUD_PARSER_VERSION_CHANGED: "O leitor de arquivos foi atualizado. Envie o original novamente para usar a versão atual.",
  CLOUD_QUOTA: "O limite da fila ou do armazenamento foi atingido. Solicite a revisão ao administrador.",
  CLOUD_STATE: "Esta ação não está disponível na situação atual do envio. Atualize o histórico.",
  CLOUD_INVALID_STATE: "Esta ação não está disponível na situação atual do envio. Atualize o histórico.",
  CLOUD_RETRY_UNAVAILABLE: "Não é possível repetir este envio. Confira se ele atingiu o limite de tentativas ou já foi recebido em outro envio.",
  CLOUD_ATTEMPTS_EXHAUSTED: "O limite de tentativas foi atingido. Confira o erro e a fonte antes de enviar o arquivo novamente.",
  CLOUD_STALE: "Este envio mudou em outra sessão. Atualize o histórico antes de tentar novamente.",
  CLOUD_UNAVAILABLE: "A leitura foi interrompida no servidor. Tentar novamente retoma os lotes confirmados sem duplicar batidas.",
  CLOUD_STORAGE_UNAVAILABLE: "O armazenamento não está disponível. Solicite a conferência da instalação ao administrador.",
  SOURCE_DISABLED: "A fonte foi desativada. Atualize a lista e escolha uma fonte ativa.",
  SOURCE_NOT_FOUND: "Fonte não encontrada. Atualize a lista antes de enviar.",
  FILE_TOO_LARGE: "O arquivo excede o limite permitido. Envie uma exportação menor.",
  FILE_HASH_MISMATCH: "O arquivo recebido difere do selecionado. Cancele este envio e envie o original novamente.",
  HASH_MISMATCH: "O arquivo recebido difere do selecionado. Cancele este envio e envie o original novamente.",
  UPLOAD_NOT_FOUND: "O arquivo ainda não foi recebido. Aguarde o envio ou selecione o arquivo novamente.",
  OBJECT_NOT_FOUND: "O arquivo ainda não foi recebido. Aguarde o envio ou selecione o arquivo novamente.",
  INVALID_AFD: "Não foi possível ler o AFD. Confira o formato selecionado e a exportação do relógio.",
  AFD_PARSE_FAILED: "Não foi possível ler o AFD. Confira o formato selecionado e a exportação do relógio.",
  INVALID_XLSX: "Não foi possível ler a planilha. Envie a exportação XLSX original do Defense.",
  JOB_STALE: "Este envio mudou em outra sessão. Atualize o histórico antes de tentar novamente.",
  STALE_VERSION: "Este envio mudou em outra sessão. Atualize o histórico antes de tentar novamente.",
};
export function cloudError(code: string | null) {
  return code && errorLabels[code] ? errorLabels[code] : "O processamento não foi concluído. Confira o arquivo e a fonte antes de tentar novamente.";
}
export function validateCloudFile(file: File | null, source: CloudSnapshot["sources"][number] | undefined, profile: string, max: number): string | null {
  if (profile !== "auto" && !source) return "Selecione a fonte do arquivo.";
  if (source?.kind === "afd" && profile !== "legacy" && profile !== "iso") return "Selecione o formato AFD informado pelo exportador do relógio.";
  if (!file) return "Selecione um arquivo para enviar.";
  if (file.name.length > 200) return "O nome do arquivo excede 200 caracteres. Encurte o nome antes de enviar.";
  if (!file.size) return "O arquivo está vazio. Selecione uma exportação com conteúdo.";
  if (file.size > Math.min(cloudFileLimit, max)) return `O arquivo excede o limite de ${Math.min(cloudFileLimit, max) / 1024 / 1024} MiB.`;
  if (profile === "auto") return /\.(txt|xlsx)$/i.test(file.name) ? null : "Envie um AFD .txt ou uma planilha Defense .xlsx.";
  if (!file.name.toLowerCase().endsWith(source!.kind === "afd" ? ".txt" : ".xlsx")) return source!.kind === "afd" ? "A fonte de ponto aceita somente AFD em arquivo .txt." : "A fonte Defense aceita somente planilha .xlsx.";
  return null;
}
export async function cloudRequest<S extends z.ZodTypeAny>(url: string, schema: S, signal: AbortSignal, body?: unknown): Promise<z.output<S>> {
  const response = await fetch(url, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]), ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) }).catch(() => {
    signal.throwIfAborted(); throw new Error("A conexão com o servidor não concluiu a solicitação. Atualize o histórico antes de tentar novamente.");
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = value && typeof value === "object" && "code" in value && typeof value.code === "string" ? value.code : null;
    if (code && errorLabels[code]) throw new Error(errorLabels[code]);
    if (response.status === 401 || response.status === 403) throw new Error("Sua sessão não permite esta operação. Entre novamente com um perfil de RH ou administrador.");
    if (response.status === 409) throw new Error(errorLabels.JOB_STALE);
    if (response.status === 413) throw new Error(errorLabels.FILE_TOO_LARGE);
    throw new Error(code ? cloudError(code) : "Não foi possível consultar o envio. Atualize o histórico e tente novamente.");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("A resposta do servidor não confirmou a operação. Atualize o histórico antes de tentar novamente.");
  return parsed.data;
}
export async function cloudFileHash(file: File, signal: AbortSignal): Promise<string> {
  if (!crypto.subtle) throw new Error("Este navegador não permite conferir o arquivo. Abra o sistema por HTTPS em um navegador atualizado.");
  const content = await file.arrayBuffer(); signal.throwIfAborted();
  const hash = await crypto.subtle.digest("SHA-256", content); signal.throwIfAborted();
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
}
export async function uploadCloudFile(reservation: CloudReservation, file: File, signal: AbortSignal): Promise<void> {
  // A scoped client allows aborting this transfer without changing the shared authenticated client.
  const [{ createClient }, { getSupabasePublicConfig }] = await Promise.all([import("@supabase/supabase-js"), import("@/lib/supabase/config")]);
  signal.throwIfAborted();
  const { url, publishableKey } = getSupabasePublicConfig();
  const uploadSignal = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
  const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: uploadSignal }) } });
  const body = new Blob([file], { type: "application/octet-stream" });
  const { error } = await client.storage.from(reservation.upload.bucket).uploadToSignedUrl(reservation.upload.path, reservation.upload.token, body, { upsert: false, cacheControl: "0", contentType: "application/octet-stream" }).catch(() => ({ error: true }));
  signal.throwIfAborted();
  if (error) throw new Error("O envio do arquivo não foi confirmado. Confira sua conexão e tente enviar novamente. Se o arquivo já chegou, use Confirmar envio no histórico.");
}
