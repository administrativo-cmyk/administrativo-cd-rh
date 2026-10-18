import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MonitoringSnapshot } from "@/lib/monitoring/contracts";
const mocks = vi.hoisted(() => ({ claims: vi.fn(), profile: vi.fn(), workforce: vi.fn(), daily: vi.fn(), bank: vi.fn(), monitoring: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: mocks.claims }, from: () => ({ select: () => ({ eq: () => ({ abortSignal: () => ({ single: mocks.profile }) }) }) }) }) }));
vi.mock("@/lib/data/supabase-workforce-repository", () => ({ SupabaseWorkforceRepository: class { load = mocks.workforce; } }));
vi.mock("@/lib/data/supabase-daily-call-repository", () => ({ SupabaseDailyCallRepository: class { load = mocks.daily; } }));
vi.mock("@/lib/data/supabase-time-bank-repository", () => ({ SupabaseTimeBankRepository: class { load = mocks.bank; } }));
vi.mock("@/lib/monitoring/server", () => ({ loadMonitoring: mocks.monitoring }));
import { dashboardSession, loadDashboard } from "./server";

const day = "2026-10-17";
function monitoringPage(offset: number, total: number, version = "1:1"): MonitoringSnapshot {
  return { rows: Array.from({ length: Math.min(500, total - offset) }, (_, index) => ({ employeeId: `20000000-0000-4000-8000-${String(offset + index).padStart(12, "0")}`, employeeNumber: String(offset + index), name: "Pessoa sintética", unit: "CD I", manager: null, managerId: null, date: day, quality: "complete", dirty: false, computedAt: day, ruleVersion: "test", summary: { workedSeconds: 60, outsideSeconds: 0, late: false } })), total, people: total, pending: 0, excluded: 0, totals: {}, datasetVersion: version, timezone: "America/Sao_Paulo", queriedAt: `${day}T15:00:00Z`, start: day, end: day };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.claims.mockResolvedValue({ data: { claims: { sub: "session-user" } }, error: null });
  mocks.profile.mockResolvedValue({ data: { papel_usuario: "ADMIN", status_usuario: "APROVADO" } });
  mocks.workforce.mockResolvedValue([]);
  mocks.bank.mockResolvedValue({ asOfDate: day, employees: [] });
  mocks.daily.mockResolvedValue({ date: day, startDate: day, endDate: day, employees: [] });
});
describe("sessão de dashboard", () => {
  it("bloqueia sessão ausente antes de consultar perfil", async () => {
    mocks.claims.mockResolvedValue({ data: null, error: new Error("expired") });
    expect((await dashboardSession()).response?.status).toBe(401);
    expect(mocks.profile).not.toHaveBeenCalled();
  });
  it.each(["PENDENTE", "BLOQUEADO"])("bloqueia perfil%s", async (status_usuario) => {
    mocks.profile.mockResolvedValue({ data: { papel_usuario: "ADMIN", status_usuario } });
    expect((await dashboardSession()).response?.status).toBe(403);
  });
  it("falha fechada para perfil inexistente ou papel desconhecido", async () => {
    mocks.profile.mockResolvedValue({ data: null });
    expect((await dashboardSession()).response?.status).toBe(403);
    mocks.profile.mockResolvedValue({ data: { papel_usuario: "UNKNOWN", status_usuario: "APROVADO" } });
    expect((await dashboardSession()).response?.status).toBe(403);
  });
  it.each(["ADMIN", "RH", "GESTOR", "LEITURA"])("permite consulta ao papel aprovado%s", async (papel_usuario) => {
    mocks.profile.mockResolvedValue({ data: { papel_usuario, status_usuario: "APROVADO" } });
    expect(await dashboardSession()).toMatchObject({ userId: "session-user", role: papel_usuario });
  });
  it("limita verificação de sessão travada a15s sem consultar dados do dashboard", async () => {
    vi.useFakeTimers();
    try {
      mocks.claims.mockImplementation(() => new Promise(() => {}));
      const response = dashboardSession();
      await vi.advanceTimersByTimeAsync(15_000);
      expect((await response).response?.status).toBe(503);
      expect(mocks.profile).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
describe("carregamento completo e consistente das fontes", () => {
  it("agrega600resultados de duas páginas, nunca sóosprimeiros500", async () => {
    mocks.monitoring.mockImplementation(async ({ offset }: { offset: number }) => monitoringPage(offset, 600));
    const result = await loadDashboard("monitoramento", { start: day, end: day });
    expect(mocks.monitoring).toHaveBeenCalledTimes(2);
    expect(result.metrics.find((row) => row.id === "workedMinutes")?.value).toBe(600);
    expect(result.metrics.find((row) => row.id === "lateRate")).toMatchObject({ numerator: 0, denominator: 600, value: 0 });
  });
  it("recusa mudança de versão entre páginas", async () => {
    mocks.monitoring.mockImplementation(async ({ offset }: { offset: number }) => monitoringPage(offset, 600, offset ? "2:2" : "1:1"));
    await expect(loadDashboard("monitoramento", { start: day, end: day })).rejects.toMatchObject({ code: "DASHBOARD_SOURCE_CHANGED", status: 409 });
  });
  it("recusa página faltante ou duplicada", async () => {
    mocks.monitoring.mockImplementation(async ({ offset }: { offset: number }) => ({ ...monitoringPage(offset, 600), ...(offset ? { rows: [] } : {}) }));
    await expect(loadDashboard("monitoramento", { start: day, end: day })).rejects.toMatchObject({ code: "DASHBOARD_SOURCE_CHANGED" });
    mocks.monitoring.mockImplementation(async ({ offset }: { offset: number }) => ({ ...monitoringPage(offset, 600), ...(offset ? { rows: monitoringPage(0, 600).rows.slice(0, 100) } : {}) }));
    await expect(loadDashboard("monitoramento", { start: day, end: day })).rejects.toMatchObject({ code: "DASHBOARD_SOURCE_CHANGED" });
  });
  it("limita20milresultados antes de ler páginas adicionais", async () => {
    mocks.monitoring.mockResolvedValue(monitoringPage(0, 20001));
    await expect(loadDashboard("monitoramento", { start: day, end: day })).rejects.toMatchObject({ status: 422 });
    expect(mocks.monitoring).toHaveBeenCalledOnce();
  });
  it("não fornece dados de demonstração na falha deuma fonte", async () => {
    mocks.workforce.mockRejectedValue(new Error("protected source unavailable"));
    await expect(loadDashboard("quadro-atual")).rejects.toThrow("protected source unavailable");
  });
  it("saldo usa datafim; Chamada consultaduas fontes autenticadas sem solicitar outroescopo", async () => {
    mocks.bank.mockResolvedValue({ asOfDate: "2026-09-01", employees: [] });
    expect((await loadDashboard("banco-de-horas", { end: "2026-09-01" })).start).toBe("2026-09-01");
    expect(mocks.bank).toHaveBeenCalledWith("2026-09-01");
    await loadDashboard("chamada-diaria", { start: day, end: day });
    expect(mocks.daily).toHaveBeenCalledWith(day, day, day);
    expect(mocks.workforce).toHaveBeenCalledWith();
  });
  it("filtro de gestor não acrescenta pessoas fora do snapshot protegido", async () => {
    mocks.monitoring.mockResolvedValue(monitoringPage(0, 1));
    const managerId = "30000000-0000-4000-8000-000000000001";
    const result = await loadDashboard("monitoramento", { start: day, end: day, managerId });
    expect(mocks.monitoring).toHaveBeenCalledWith(expect.objectContaining({ managerId }), expect.any(AbortSignal));
    expect(result.metrics.find((row) => row.id === "people")?.value).toBe(0);
  });
  it("interrompe consulta bloqueada em25s e cancela a requisição de origem", async () => {
    vi.useFakeTimers();
    try {
      mocks.monitoring.mockImplementation(() => new Promise(() => {}));
      const result = loadDashboard("monitoramento", { start: day, end: day });
      const rejected = expect(result).rejects.toMatchObject({ code: "DASHBOARD_TIMEOUT", status: 503 });
      await vi.advanceTimersByTimeAsync(25_000);
      await rejected;
      expect(mocks.monitoring.mock.calls[0][1].aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
