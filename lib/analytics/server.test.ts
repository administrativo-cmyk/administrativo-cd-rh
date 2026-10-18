import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ bank: vi.fn(), workforce: vi.fn() }));
vi.mock("@/lib/data/supabase-time-bank-repository", () => ({ SupabaseTimeBankRepository: class { load = mocks.bank; } }));
vi.mock("@/lib/data/supabase-workforce-repository", () => ({ SupabaseWorkforceRepository: class { load = mocks.workforce; } }));
import { loadAnalysis } from "./server";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.bank.mockResolvedValue({ asOfDate: "2026-09-01", employees: [] });
  mocks.workforce.mockResolvedValue([]);
});
describe("carregamento de análises", () => {
  it.each(["top-20-banco-horas", "top-por-gestor"] as const)("%s consulta saldo na referência com repositório autenticado", async (kind) => {
    const result = await loadAnalysis(kind, { end: "2026-09-01" });
    expect(mocks.bank).toHaveBeenCalledWith("2026-09-01");
    expect(mocks.workforce).not.toHaveBeenCalled();
    expect(result.domain).toBe(kind);
    expect(result.end).toBe("2026-09-01");
  });
  it("situações consultam cadastro atual sem fingir fotografia histórica", async () => {
    const result = await loadAnalysis("afastados-e-outros", { end: "2020-01-01" });
    expect(mocks.workforce).toHaveBeenCalledWith();
    expect(mocks.bank).not.toHaveBeenCalled();
    expect(result.end).not.toBe("2020-01-01");
  });
  it("propaga erro da fonte sem fallback sintético", async () => {
    mocks.bank.mockRejectedValue(new Error("source unavailable"));
    await expect(loadAnalysis("top-por-gestor")).rejects.toThrow("source unavailable");
  });
});
