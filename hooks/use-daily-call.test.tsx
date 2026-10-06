import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDailyCall } from "./use-daily-call";
import type { DailyCallSnapshot } from "@/lib/daily-call-types";

const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: notifications }));

const date = "2026-10-06";
const employee = {
  id: "FICT-1", databaseId: "30000000-0000-0000-0000-000000000001",
  name: "Pessoa Fictícia", unit: "CD I" as const, manager: "Sem gestor definido",
  department: "Operação", role: "Auxiliar", situation: "Ativo" as const,
  admissionDate: "2025-01-01", plannedVacation: "-", bankDays: 2, bankHours: "+14:40",
  realBank: { measurementDate: "2026-09-28", effectiveFrom: "2026-09-28", workdayHours: 7.3333,
    balanceMinutes: 880, balanceDays: 2, pendingCompensationDays: 2, replacementDays: 0, usedCompensationDays: 0 },
  attendance: {}, observations: {}, attendanceVersions: {},
};
const snapshot: DailyCallSnapshot = { date, startDate: "2026-10-01", endDate: "2026-10-31", employees: [employee] };
const reply = (status: string | null, version = "2026-10-06T12:00:00Z", responseStatus = 200) => ({
  ok: responseStatus === 200, status: responseStatus,
  json: async () => responseStatus === 200 ? { changed: true, record: status ? { date, status, observation: null, updatedAt: version } : null }
    : { error: "Este lançamento foi alterado por outro usuário. Atualize os dados e tente novamente." },
});

describe("sincronização local da Chamada Diária", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn()); });

  it("salva Hoje, mantém o mesmo estado no Período e atualiza métricas", async () => {
    vi.mocked(fetch).mockResolvedValue(reply("P") as Response);
    const { result } = renderHook(() => useDailyCall(date, snapshot));
    await act(async () => { expect(await result.current.saveAttendance(result.current.employees[0], date, "P", null)).toBe(true); });
    expect(result.current.employees[0].attendance[date]).toBe("P");
    expect(result.current.metrics.present).toBe(1);
    act(() => result.current.setViewMode("period"));
    expect(result.current.filteredEmployees[0].attendance[date]).toBe("P");
    expect(notifications.success).toHaveBeenCalledWith("Lançamento salvo.");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({ employeeId: employee.databaseId, expectedUpdatedAt: null });
  });

  it("G reduz A COMPENSAR, trocar por P restaura e limpar remove", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply("G", "2026-10-06T12:00:00Z") as Response)
      .mockResolvedValueOnce(reply("P", "2026-10-06T12:01:00Z") as Response)
      .mockResolvedValueOnce(reply(null) as Response);
    const { result } = renderHook(() => useDailyCall(date, snapshot));
    await act(async () => { await result.current.saveAttendance(result.current.employees[0], date, "G", null); });
    expect(result.current.employees[0].realBank?.pendingCompensationDays).toBe(1);
    await act(async () => { await result.current.saveAttendance(result.current.employees[0], date, "P", null); });
    expect(result.current.employees[0].realBank?.pendingCompensationDays).toBe(2);
    await act(async () => { await result.current.saveAttendance(result.current.employees[0], date, null, null); });
    expect(result.current.employees[0].attendance[date]).toBeUndefined();
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).expectedUpdatedAt).toBe("2026-10-06T12:00:00Z");
  });

  it("falha de RPC não altera a linha e informa conflito", async () => {
    vi.mocked(fetch).mockResolvedValue(reply(null, "", 409) as Response);
    const { result } = renderHook(() => useDailyCall(date, snapshot));
    await act(async () => { expect(await result.current.saveAttendance(result.current.employees[0], date, "F", null)).toBe(false); });
    expect(result.current.employees[0].attendance[date]).toBeUndefined();
    expect(notifications.error).toHaveBeenCalled();
  });

  it("bloqueia duplo clique na mesma célula enquanto salva", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useDailyCall(date, snapshot));
    let first!: Promise<boolean>;
    act(() => { first = result.current.saveAttendance(result.current.employees[0], date, "P", null); });
    expect(result.current.isSaving(result.current.employees[0], date)).toBe(true);
    await act(async () => { expect(await result.current.saveAttendance(result.current.employees[0], date, "F", null)).toBe(false); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { finish(reply("P") as Response); await first; });
    expect(result.current.isSaving(result.current.employees[0], date)).toBe(false);
  });
});
