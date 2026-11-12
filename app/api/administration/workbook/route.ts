import { type AdministrationEntity, type AdministrationSnapshot } from "@/lib/administration/contracts";
import { administrationQuery } from "@/lib/administration/server";
import { createRegisterWorkbook, maxWorkbookRows, previewRegisterWorkbook } from "@/lib/administration/register-workbook";
import { registerWorkbookApplySchema, registerWorkbookMime, validateWorkbookOperation } from "@/lib/administration/register-workbook-contracts";
import { loadBankAdmin, bankAdminQuery } from "@/lib/time-bank-admin/server";
import { boundedBody, boundedJson, monitoringSession } from "@/lib/monitoring/server";
import { httpBodyLimitBytes, importFileLimitBytes } from "@/lib/monitoring/payload-limits";
import { guardWorkbook } from "@/lib/monitoring/import-file";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";

const headers = { "Cache-Control": "private, no-store" };

async function registerPage<E extends AdministrationEntity>(entity: E, offset = 0, limit = 500) {
  return await administrationQuery(entity, "list", { offset, limit, includeArchived: false }) as AdministrationSnapshot<E>;
}

async function registerPages<E extends AdministrationEntity>(entity: E) {
  const limit = 500;
  const first = await registerPage(entity, 0, limit);
  if (!first.permissions.canManageRegisters) throw new Error("Apenas ADMIN e RH podem exportar.");
  if (first.total > maxWorkbookRows) throw new Error("O cadastro excede o limite do Excel.");
  const rows = [...first.rows];
  for (let offset = limit; offset < first.total; offset += limit) {
    const next = await registerPage(entity, offset, limit);
    if (next.datasetVersion !== first.datasetVersion || next.total !== first.total) throw new Error("Os cadastros mudaram durante a consulta. Tente novamente.");
    rows.push(...next.rows);
  }
  if (rows.length !== first.total || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("A consulta de cadastros está incompleta. Tente novamente.");
  return { ...first, rows };
}

async function bankPages() {
  const limit = 200;
  const read = (offset: number) => loadBankAdmin({ query: "", state: "active", limit, offset });
  const first = await read(0);
  if (first.total > maxWorkbookRows) throw new Error("O Banco de Horas excede o limite do Excel.");
  const rows = [...first.rows];
  for (let offset = limit; offset < first.total; offset += limit) {
    const next = await read(offset);
    if (next.total !== first.total) throw new Error("As medições mudaram durante a consulta. Tente novamente.");
    rows.push(...next.rows);
  }
  if (rows.length !== first.total || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("A consulta de medições está incompleta. Tente novamente.");
  return rows;
}

function failure(error: unknown, status: number, fallback: string) {
  const message = error instanceof Error && error.message.length <= 300 ? error.message : fallback;
  return Response.json({ error: message }, { status, headers });
}

export async function GET() {
  const session = await monitoringSession(true);
  if (session.response) return session.response;
  try {
    const [employee, unit, manager, vacation, bank] = await Promise.all([
      registerPages("employee"), registerPages("unit"), registerPages("manager"), registerPages("vacation"), bankPages(),
    ]);
    const catalogs = (employee.options.catalogs ?? []).filter(row => row.active);
    const file = await createRegisterWorkbook({
      options: employee.options, bank,
      registers: {
        employee: employee.rows, unit: unit.rows, manager: manager.rows, vacation: vacation.rows,
        department: catalogs.filter(row => row.kind === "department"), job: catalogs.filter(row => row.kind === "job"),
        category: catalogs.filter(row => row.kind === "category"),
      },
    });
    if (file.length > importFileLimitBytes) throw new Error("A planilha excede 4,3 MB. Não foi possível gerar uma cópia reimportável.");
    guardWorkbook(file);
    return new Response(new Uint8Array(file), {
      headers: { ...headers, "Content-Type": registerWorkbookMime, "Content-Disposition": 'attachment; filename="RH-Conect-' + todayInSaoPaulo() + '.xlsx"' },
    });
  } catch (error) { return failure(error, 503, "Não foi possível gerar o Excel."); }
}

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  const session = await monitoringSession(true);
  if (session.response) return session.response;
  const contentType = request.headers.get("content-type");
  if (contentType === registerWorkbookMime) {
    try {
      const bytes = await boundedBody(request, importFileLimitBytes);
      const { options } = await registerPage("employee", 0, 1);
      const preview = await previewRegisterWorkbook(bytes, options);
      const body = JSON.stringify(preview);
      if (Buffer.byteLength(body) > httpBodyLimitBytes) throw new Error("A prévia ficou muito grande. Edite menos linhas por envio.");
      return new Response(body, { headers: { ...headers, "Content-Type": "application/json" } });
    } catch (error) {
      if (error instanceof Error && error.message === "BODY_TOO_LARGE") return Response.json({ error: "Envie um arquivo XLSX de até 4,3 MB." }, { status: 413, headers });
      return failure(error, 400, "Não foi possível validar a planilha exportada.");
    }
  }
  if (contentType?.split(";")[0] !== "application/json") return Response.json({ error: "Envie o Excel exportado pelo RH Conect." }, { status: 415, headers });
  try {
    const { operations, reason } = registerWorkbookApplySchema.parse(await boundedJson(request));
    const updates = operations.map(operation => ({ ...operation, input: validateWorkbookOperation(operation, reason) }));
    if (new Set(updates.map(row => row.entity + ":" + row.input.id)).size !== updates.length) throw new Error("O lote tem registros duplicados.");
    const results = [];
    for (const { entity, line, input } of updates) {
      try {
        const saved = entity === "bank" ? await bankAdminQuery("save", input) : await administrationQuery(entity, "save", input);
        if (!saved || typeof saved !== "object" || !("changed" in saved) || saved.changed !== true) throw new Error("O sistema não confirmou a gravação desta linha.");
        results.push({ entity, line, ok: true as const });
      } catch (error) {
        results.push({ entity, line, ok: false as const, error: error instanceof Error ? error.message : "Falha ao salvar." });
      }
    }
    return Response.json({ results }, { headers });
  } catch (error) { return failure(error, 400, "Revise as linhas e o motivo da atualização."); }
}
