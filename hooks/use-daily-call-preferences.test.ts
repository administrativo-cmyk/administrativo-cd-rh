import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyCallPreferences } from "@/lib/workspace/contracts";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workspace/client", () => ({ workspaceRequest: request }));
import { useDailyCallPreferences } from "./use-daily-call-preferences";

const firstUser = "10000000-0000-4000-8000-000000000001";
const secondUser = "10000000-0000-4000-8000-000000000002";
const defaults = (userId = firstUser): DailyCallPreferences => ({ userId, viewMode: "today", columnsCollapsed: false, updatedAt: null });
const saved = { ...defaults(), viewMode: "period" as const, columnsCollapsed: true, updatedAt: "2026-10-20T12:00:00Z" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => { request.mockReset(); localStorage.clear(); });

describe("preferências pessoais da Chamada", () => {
  it("restaura Hoje/Período e colunas ao reabrir sem gravar valores padrão", async () => {
    request.mockResolvedValue(saved);
    const first = renderHook(() => useDailyCallPreferences(firstUser));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current).toMatchObject({ viewMode: "period", columnsCollapsed: true });
    first.unmount();
    const reopened = renderHook(() => useDailyCallPreferences(firstUser));
    await waitFor(() => expect(reopened.result.current.loading).toBe(false));
    expect(reopened.result.current).toMatchObject({ viewMode: "period", columnsCollapsed: true });
    expect(request.mock.calls.every(([action]) => action === "daily_call_preferences")).toBe(true);
  });

  it("mantém ação feita durante a leitura e grava apenas campo alterado", async () => {
    const loading = deferred<DailyCallPreferences>();
    request.mockReturnValueOnce(loading.promise).mockResolvedValueOnce({ ...saved, viewMode: "today" });
    const { result } = renderHook(() => useDailyCallPreferences(firstUser));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    act(() => result.current.setViewMode("today"));
    await act(async () => loading.resolve(saved));
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(result.current).toMatchObject({ viewMode: "today", columnsCollapsed: true });
    expect(request.mock.calls[1]).toEqual(["save_daily_call_preferences", { expectedUserId: firstUser, expectedUpdatedAt: saved.updatedAt, viewMode: "today" }, undefined, { keepalive: true }]);
  });

  it("serializa cliques rápidos e não deixa resposta antiga desfazer última escolha", async () => {
    const saving = deferred<DailyCallPreferences>();
    request.mockResolvedValueOnce(defaults()).mockReturnValueOnce(saving.promise).mockResolvedValueOnce({ ...saved, viewMode: "today" });
    const { result } = renderHook(() => useDailyCallPreferences(firstUser));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setViewMode("period"));
    act(() => { result.current.setColumnsCollapsed(true); result.current.setViewMode("today"); });
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ viewMode: "today", columnsCollapsed: true, saving: true });
    await act(async () => saving.resolve({ ...defaults(), viewMode: "period" }));
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(request.mock.calls[2][1]).toEqual({ expectedUserId: firstUser, expectedUpdatedAt: null, viewMode: "today", columnsCollapsed: true });
    expect(result.current).toMatchObject({ viewMode: "today", columnsCollapsed: true });
  });

  it("isola troca de conta e ignora leitura antiga que chega depois", async () => {
    const oldRead = deferred<DailyCallPreferences>();
    request.mockReturnValueOnce(oldRead.promise).mockResolvedValueOnce(defaults(secondUser));
    const { result, rerender } = renderHook(({ userId }) => useDailyCallPreferences(userId), { initialProps: { userId: firstUser } });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    rerender({ userId: secondUser });
    expect(result.current).toMatchObject({ userId: secondUser, loading: true, viewMode: "today", columnsCollapsed: false });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => oldRead.resolve(saved));
    expect(result.current).toMatchObject({ userId: secondUser, viewMode: "today", columnsCollapsed: false });
    expect(request.mock.calls[0][2].aborted).toBe(true);
    expect(request.mock.calls[1][1]).toEqual({ expectedUserId: secondUser });
  });

  it("sinaliza falha de gravação, conserva escolha e permite tentar novamente", async () => {
    request.mockResolvedValueOnce(defaults()).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ...defaults(), columnsCollapsed: true });
    const { result } = renderHook(() => useDailyCallPreferences(firstUser));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setColumnsCollapsed(true));
    await waitFor(() => expect(result.current.error).toMatch(/salvar/));
    expect(result.current.columnsCollapsed).toBe(true);
    act(() => result.current.retry());
    await waitFor(() => expect({ error: result.current.error, saving: result.current.saving }).toEqual({ error: null, saving: false }));
    expect(result.current.saving).toBe(false);
    expect(request.mock.calls[2][1]).toEqual({ expectedUserId: firstUser, expectedUpdatedAt: null, columnsCollapsed: true });
    expect(localStorage.length).toBe(0);
  });

  it("recupera escolha ainda não enviada após atualização e não a aplica em outra conta", async () => {
    const loading = deferred<DailyCallPreferences>();
    request.mockReturnValueOnce(loading.promise);
    const first = renderHook(() => useDailyCallPreferences(firstUser));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    act(() => { first.result.current.setViewMode("period"); first.result.current.setColumnsCollapsed(true); });
    first.unmount();
    request.mockResolvedValueOnce(defaults(secondUser));
    const other = renderHook(() => useDailyCallPreferences(secondUser));
    await waitFor(() => expect(other.result.current.loading).toBe(false));
    expect(other.result.current).toMatchObject({ viewMode: "today", columnsCollapsed: false });
    other.unmount();
    request.mockResolvedValueOnce(defaults()).mockResolvedValueOnce(saved);
    const reopened = renderHook(() => useDailyCallPreferences(firstUser));
    await waitFor(() => expect(reopened.result.current.loading || reopened.result.current.saving).toBe(false));
    expect(reopened.result.current).toMatchObject({ viewMode: "period", columnsCollapsed: true });
    expect(request.mock.calls[3][1]).toEqual({ expectedUserId: firstUser, expectedUpdatedAt: null, viewMode: "period", columnsCollapsed: true });
    expect(localStorage.length).toBe(0);
  });

  it("falha de leitura não provoca gravação de padrões nem bloqueia uso", async () => {
    request.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(saved);
    const { result } = renderHook(() => useDailyCallPreferences(firstUser));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/carregar/);
    expect(request).toHaveBeenCalledTimes(1);
    act(() => result.current.retry());
    await waitFor(() => expect({ error: result.current.error, loading: result.current.loading }).toEqual({ error: null, loading: false }));
    expect(result.current).toMatchObject({ viewMode: "period", columnsCollapsed: true });
  });

  it("rejeita resposta de conta diferente", async () => {
    request.mockResolvedValue(defaults(secondUser));
    const { result } = renderHook(() => useDailyCallPreferences(firstUser));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ userId: firstUser, viewMode: "today", columnsCollapsed: false });
    expect(result.current.error).toMatch(/carregar/);
  });

  it("reconsulta versão em conflito e reaplica somente sua escolha sem apagar outro campo", async () => {
    request.mockResolvedValueOnce(defaults())
      .mockRejectedValueOnce(Object.assign(new Error("changed"), { code: "WORKSPACE_STALE" }))
      .mockResolvedValueOnce({ ...saved, viewMode: "today" })
      .mockResolvedValueOnce(saved);
    const { result } = renderHook(() => useDailyCallPreferences(firstUser));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setViewMode("period"));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(result.current.loading || result.current.saving).toBe(false));
    expect(request.mock.calls[3][1]).toEqual({ expectedUserId: firstUser, expectedUpdatedAt: saved.updatedAt, viewMode: "period" });
    expect(result.current).toMatchObject({ viewMode: "period", columnsCollapsed: true, error: null });
  });

  it("reload com duas escolhas pendentes não permite keepalive antigo sobrescrever a escolha nova", async () => {
    let database = defaults();
    const oldWrite = deferred<DailyCallPreferences>();
    let writes = 0;
    request.mockImplementation(async (action, data) => {
      if (action === "daily_call_preferences") return { ...database };
      writes += 1;
      if (writes === 1) return oldWrite.promise;
      if (data.expectedUpdatedAt !== database.updatedAt) throw Object.assign(new Error("changed"), { code: "WORKSPACE_STALE" });
      database = { ...database, ...data, updatedAt: "2026-10-20T13:00:00Z" };
      return { ...database };
    });
    const first = renderHook(() => useDailyCallPreferences(firstUser));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    act(() => first.result.current.setViewMode("period"));
    act(() => first.result.current.setViewMode("today"));
    first.unmount();
    const reopened = renderHook(() => useDailyCallPreferences(firstUser));
    await waitFor(() => expect(writes).toBe(2));
    await waitFor(() => expect(reopened.result.current.loading || reopened.result.current.saving).toBe(false));
    const oldRequest = request.mock.calls.find(([action]) => action === "save_daily_call_preferences")![1];
    expect(oldRequest.expectedUpdatedAt).not.toEqual(database.updatedAt);
    await act(async () => oldWrite.reject(Object.assign(new Error("changed"), { code: "WORKSPACE_STALE" })));
    expect(writes).toBe(2); // The unmounted session must not retry its obsolete choice.
    expect(database.viewMode).toBe("today");
    expect(reopened.result.current.viewMode).toBe("today");
    expect(localStorage.length).toBe(0);
  });

  it("outra aba que já salvou escolha mais recente impede retry do rascunho antigo", async () => {
    let database = defaults();
    const oldWrite = deferred<DailyCallPreferences>();
    let writes = 0;
    request.mockImplementation(async (action, data) => {
      if (action === "daily_call_preferences") return { ...database };
      writes += 1;
      if (writes === 1) return oldWrite.promise;
      database = { ...database, ...data, updatedAt: "2026-10-20T13:00:00Z" };
      return { ...database };
    });
    const first = renderHook(() => useDailyCallPreferences(firstUser));
    const second = renderHook(() => useDailyCallPreferences(firstUser));
    await waitFor(() => expect(first.result.current.loading || second.result.current.loading).toBe(false));
    act(() => first.result.current.setViewMode("period"));
    act(() => second.result.current.setViewMode("today"));
    await waitFor(() => expect(second.result.current.saving).toBe(false));
    await act(async () => oldWrite.reject(Object.assign(new Error("changed"), { code: "WORKSPACE_STALE" })));
    await waitFor(() => expect(first.result.current.loading || first.result.current.saving).toBe(false));
    expect(writes).toBe(2);
    expect(first.result.current.viewMode).toBe("today");
    expect(second.result.current.viewMode).toBe("today");
    expect(localStorage.length).toBe(0);
  });
});
