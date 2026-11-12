import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { registerWorkbookMime } from "@/lib/administration/register-workbook-contracts";

const mocks = vi.hoisted(() => ({ session: vi.fn(), administration: vi.fn(), bank: vi.fn(), bankList: vi.fn() }));
vi.mock("@/lib/monitoring/server", async load => ({ ...await load<typeof import("@/lib/monitoring/server")>(), monitoringSession: mocks.session }));
vi.mock("@/lib/administration/server", () => ({ administrationQuery: mocks.administration }));
vi.mock("@/lib/time-bank-admin/server", () => ({ bankAdminQuery: mocks.bank, loadBankAdmin: mocks.bankList }));

import { GET, POST } from "./route";

const id = "ad000001-0000-4000-8000-000000000001";
const version = "2026-11-12T15:04:01.712Z";
const reason = "Conferência da planilha";
const request = (body: BodyInit, contentType: string, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/administration/workbook", {
  method: "POST", body, headers: { Origin: origin, "Content-Type": contentType },
});
const operation = { entity: "unit", line: 2, data: { id, expectedUpdatedAt: version, code: "001", name: "Unidade revisada" } };
const snapshot = {
  total: 0, datasetVersion: "v1", rows: [], options: { units: [], managers: [], employees: [], catalogs: [] }, permissions: { canManageRegisters: true },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  mocks.session.mockResolvedValue({ userId: id, profile: { papel_usuario: "RH" } });
  mocks.administration.mockImplementation(async (entity, action) => action === "list"
    ? entity === "unit" ? { ...snapshot, total: 1, rows: [{ id, updatedAt: version, code: "001", name: "Unidade original" }] } : snapshot
    : { changed: true });
  mocks.bankList.mockResolvedValue({ total: 0, rows: [], employees: [] });
  mocks.bank.mockResolvedValue({ changed: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("API Excel do RH", () => {
  it("baixa, revisa sem gravar e aplica o mesmo arquivo com a versão exportada", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(registerWorkbookMime);
    expect(response.headers.get("content-disposition")).toContain(".xlsx");
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    workbook.getWorksheet("Unidades")!.getCell("B2").value = "Unidade revisada";
    const review = await POST(request(new Uint8Array(await workbook.xlsx.writeBuffer()), registerWorkbookMime));
    expect(review.status).toBe(200);
    const preview = await review.json();
    expect(preview.changes).toMatchObject([operation]);
    expect(mocks.administration.mock.calls.every(([, action]) => action === "list")).toBe(true);

    const save = await POST(request(JSON.stringify({ operations: [operation], reason }), "application/json"));
    expect(await save.json()).toEqual({ results: [{ entity: "unit", line: 2, ok: true }] });
    expect(mocks.administration).toHaveBeenCalledWith("unit", "save", { ...operation.data, reason });
  });

  it("valida o lote inteiro e devolve conflito de versão na linha", async () => {
    const invalid = { ...operation, data: { ...operation.data, expectedUpdatedAt: undefined } };
    expect((await POST(request(JSON.stringify({ operations: [operation, invalid], reason }), "application/json"))).status).toBe(400);
    expect(mocks.administration).not.toHaveBeenCalled();

    mocks.administration.mockRejectedValueOnce(new Error("Este cadastro foi alterado por outra pessoa. Atualize antes de salvar."));
    const bank = { entity: "bank", line: 2, data: { id, expectedUpdatedAt: version, employeeId: id, measurementDate: "2026-11-11", effectiveFrom: "2026-11-12", workdayHours: 8, balanceMinutes: 0 } };
    const response = await POST(request(JSON.stringify({ operations: [operation, bank], reason }), "application/json"));
    expect(await response.json()).toMatchObject({ results: [{ entity: "unit", ok: false, error: expect.stringContaining("alterado") }, { entity: "bank", ok: true }] });
    expect(mocks.bank).toHaveBeenCalledWith("save", expect.objectContaining({ balanceMinutes: 0, reason }));
  });

  it("protege o download e rejeita origem externa antes de gravar", async () => {
    mocks.session.mockResolvedValue({ response: Response.json({}, { status: 403 }) });
    expect((await GET()).status).toBe(403);
    expect(mocks.session).toHaveBeenCalledWith(true);
    expect((await POST(request(JSON.stringify({ operations: [operation], reason }), "application/json", "https://other.example"))).status).toBe(403);
    expect(mocks.administration).not.toHaveBeenCalled();
  });
});
