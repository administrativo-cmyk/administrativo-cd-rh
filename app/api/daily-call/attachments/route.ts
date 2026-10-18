import { z } from "zod";
import { attachmentMutationSchema, attachmentQuerySchema, attachmentUploadSchema } from "@/lib/daily-call-operations";
import { dailyCallSession, operationFailure, operationHeaders, uploadValidatedAttachment } from "@/lib/daily-call-operations-server";
import { InvalidAttachmentError, validateAttachment } from "@/lib/daily-call-attachment-validation";
import { boundedJson } from "@/lib/monitoring/server";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
export const runtime = "nodejs";
export async function GET(request: Request) {
 const auth = await dailyCallSession(true); if (auth.response) return auth.response;
 const params = Object.fromEntries(new URL(request.url).searchParams);
 const download = z.object({ id: z.string().uuid() }).strict().safeParse(params);
 const list = attachmentQuerySchema.safeParse(params);
 if (!download.success && !list.success) return Response.json({ error: "Consulta inválida." }, { status: 400 });
 try {
  const { data, error } = await auth.client.rpc("daily_call_attachments", { p_action: download.success ? "download" : "list", p_data: download.success ? download.data : list.data! });
  if (error) throw error;
  if (!download.success) return Response.json(data, { headers: operationHeaders });
  const file = z.object({ fileName: z.string(), mediaType: z.string(), content: z.string() }).parse(data);
  return new Response(new Uint8Array(Buffer.from(file.content, "base64")), { headers: { ...operationHeaders, "Content-Type": file.mediaType, "Content-Disposition": `attachment; filename="anexo"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`, "Content-Security-Policy": "sandbox; default-src 'none'" } });
 } catch (error) { return operationFailure(error); }
}
export async function POST(request: Request) {
 if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
 const auth = await dailyCallSession(true); if (auth.response) return auth.response;
 let raw: unknown; try { raw = await boundedJson(request, 2850000); } catch { return Response.json({ error: "Arquivo excede o limite de 2 MiB ou dados inválidos." }, { status: 400 }); }
 const upload = attachmentUploadSchema.safeParse(raw);
 const mutation = attachmentMutationSchema.safeParse(raw);
 if (!upload.success && !mutation.success) return Response.json({ error: "Confira o arquivo, a descrição e o motivo." }, { status: 400 });
 try {
  if (upload.success) {
   const scope = await auth.client.rpc("daily_call_attachments", { p_action: "list", p_data: { employeeId: upload.data.employeeId, date: upload.data.date } });
   if (scope.error) throw scope.error;
   const bytes = Buffer.from(upload.data.content, "base64");
   await validateAttachment(bytes, upload.data.mediaType);
   const { data, error } = await uploadValidatedAttachment(auth.actor, upload.data);
   if (error) throw error; return Response.json(data, { status: 201, headers: operationHeaders });
  }
  const { data, error } = await auth.client.rpc("daily_call_attachments", { p_action: mutation.data!.action, p_data: mutation.data!.data });
  if (error) throw error; return Response.json(data, { headers: operationHeaders });
 } catch (error) { return error instanceof InvalidAttachmentError ? Response.json({ error: error.message }, { status: 400, headers: operationHeaders }) : operationFailure(error); }
}
