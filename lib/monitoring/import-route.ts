import { z } from "zod";
import { boundedJson, monitoringSession } from "./server";
import { importOptionsSchema, type ImportKind } from "./operations-contracts";
import { monitoringOperation, operationFailure } from "./operations-server";
import { ImportFileError, inspectImport, prepareImport } from "./import-file";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
import { httpBodyLimitBytes, importFileLimitMessage } from "./payload-limits";
const previewLimitMessage = "A prévia completa excede o limite de resposta. Divida o arquivo em partes menores e confira novamente. Esta consulta não aplicou linhas.";
function boundedImportJson(value: unknown) {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body, "utf8") > httpBodyLimitBytes) throw new ImportFileError("PREVIA_LIMITE_EXCEDIDO");
  return body;
}
function importResponse(value: unknown, confirmed = false) {
  try { return new Response(boundedImportJson(value), { headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } }); }
  catch (error) {
    if (confirmed && error instanceof ImportFileError) return Response.json({ error: "As linhas foram processadas, mas o resultado completo excede o limite de resposta. Confira o histórico das medições ou vínculos antes de continuar.", code: "RESULTADO_IMPORTACAO_LIMITE_EXCEDIDO" }, { status: 422, headers: { "Cache-Control": "private, no-store" } });
    throw error;
  }
}
export async function handleImport(request: Request, kind: ImportKind) {
  if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  const session = await monitoringSession(true); if (session.response) return session.response;
  try {
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      // Bound the multipart stream before formData allocates uploaded contents.
      const reader = request.body?.getReader(); if (!reader) throw new ImportFileError("ARQUIVO_OBRIGATORIO");
      const chunks: Uint8Array[] = []; let length = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > httpBodyLimitBytes) { await reader.cancel(); throw new ImportFileError("ARQUIVO_LIMITE_4_3MB"); } chunks.push(value); }
      const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type")! } }).formData();
      const file = form.get("file"); if (!(file instanceof File)) throw new ImportFileError("ARQUIVO_OBRIGATORIO");
      const options = importOptionsSchema.parse(JSON.parse(String(form.get("options") ?? "{}"))); const bytes = Buffer.from(await file.arrayBuffer());
      if (form.get("action") === "inspect") { const { cells: _cells, ...inspection } = await inspectImport(bytes, file.name, options); void _cells; return importResponse(inspection); }
      if (form.get("action") !== "preview") throw new ImportFileError("ACAO_INVALIDA");
      const stage = await prepareImport(bytes, file.name, kind, options);
      boundedImportJson(stage); // Reject JSON expansion before storing a preview.
      return importResponse(await monitoringOperation("operational_import", "preview", stage));
    }
    const input = z.object({ id: z.string().uuid(), expectedUpdatedAt: z.string().datetime({ offset: true }).optional(), lines: z.array(z.number().int().positive()).min(1).max(200).optional(), action: z.enum(["get", "confirm"]) }).strict().parse(await boundedJson(request));
    const result = await monitoringOperation("operational_import", input.action, input);
    return importResponse(result, input.action === "confirm");
  } catch (error) {
    if (error instanceof ImportFileError && error.code === "PREVIA_LIMITE_EXCEDIDO") return Response.json({ error: previewLimitMessage, code: error.code }, { status: 422, headers: { "Cache-Control": "private, no-store" } });
    if (error instanceof ImportFileError && error.code === "ARQUIVO_LIMITE_4_3MB") return Response.json({ error: importFileLimitMessage, code: error.code }, { status: 413 });
    if (error instanceof ImportFileError || error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: error instanceof ImportFileError ? `Revise o arquivo: ${error.code}.` : "Revise o mapeamento e os campos.", code: error instanceof ImportFileError ? error.code : "IMPORT_INVALID" }, { status: 400 });
    return operationFailure(error);
  }
}
