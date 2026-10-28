import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ profile: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/auth/server-authorization", () => ({ requireApprovedProfile: mocks.profile }));
vi.mock("@/lib/monitoring/server", () => ({ loadMonitoring: mocks.load }));
vi.mock("@/components/monitoring/monitoring-app", () => ({ MonitoringApp: () => null }));
import MonitoringPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile.mockResolvedValue({ papel_usuario: "RH" });
  mocks.load.mockResolvedValue({ rows: [], total: 0 });
});

describe("carregamento inicial do Monitoramento", () => {
  it.each(["configuracao", "importacao", "conciliacao"])("abre %s sem calcular a consulta mensal", async tab => {
    const result = await MonitoringPage({ searchParams: Promise.resolve({ tab }) });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(result.props.initialSnapshot).toBeNull();
    expect(result.props.initialTab).not.toBe("query");
  });

  it("carrega os indicadores ao entrar na consulta", async () => {
    const result = await MonitoringPage({ searchParams: Promise.resolve({}) });
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(result.props.initialTab).toBe("query");
    expect(result.props.initialSnapshot).toEqual({ rows: [], total: 0 });
  });

  it("mantém gestor na consulta mesmo com parâmetro administrativo", async () => {
    mocks.profile.mockResolvedValue({ papel_usuario: "GESTOR" });
    const result = await MonitoringPage({ searchParams: Promise.resolve({ tab: "configuracao" }) });
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(result.props.initialTab).toBe("query");
  });
});
