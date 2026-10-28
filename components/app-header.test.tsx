import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedProfile } from "@/lib/auth/types";
import type { WorkspaceSettings } from "@/lib/workspace/contracts";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/workspace/client", () => ({ workspaceRequest: mocks.request }));
import { AppHeader } from "./app-header";

const profile: AuthenticatedProfile = {
  id: "header-cache-test", nome_completo: "Pessoa Sintética", papel_usuario: "RH", status_usuario: "APROVADO",
  gestor_id: null, ultimo_acesso_em: null, created_at: "2026-10-28", updated_at: "2026-10-28",
};
const settings: WorkspaceSettings = {
  defaultDashboard: "index", compactTables: false, notificationsEnabled: true,
  updatedAt: null, profileName: profile.nome_completo, profileUpdatedAt: profile.updated_at,
};
beforeEach(() => { vi.clearAllMocks(); });

describe("consultas do cabeçalho durante navegação", () => {
  it("reaproveita consultas pendentes e resultados ao trocar de página", async () => {
    let resolve!: (value: WorkspaceSettings) => void;
    const pending = new Promise<WorkspaceSettings>(done => { resolve = done; });
    mocks.request.mockImplementation(action => action === "settings" ? pending : Promise.resolve({ unread: 3 }));
    const header = () => <AppHeader profile={profile} title="Teste" onMobileOpen={() => {}} />;
    render(header()).unmount();
    const second = render(header());
    await act(async () => { resolve(settings); });
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("link", { name: "Notificações: 3 não lidas" })).toBeInTheDocument();
    second.unmount();
    render(header());
    await act(async () => {});
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it("não sobrescreve preferência salva com uma consulta antiga ainda pendente", async () => {
    let resolve!: (value: WorkspaceSettings) => void;
    const pending = new Promise<WorkspaceSettings>(done => { resolve = done; });
    mocks.request.mockImplementation(action => action === "settings" ? pending : Promise.resolve({ unread: 3 }));
    const header = () => <AppHeader profile={{ ...profile, id: "header-cache-race" }} title="Teste" onMobileOpen={() => {}} />;
    const view = render(header());
    act(() => window.dispatchEvent(new CustomEvent("workspace-preferences", { detail: { ...settings, compactTables: true, notificationsEnabled: false } })));
    await act(async () => { resolve(settings); });
    expect(screen.getByRole("link", { name: "Notificações" })).toBeInTheDocument();
    view.unmount();
    render(header());
    await act(async () => {});
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(screen.getByRole("link", { name: "Notificações" })).toBeInTheDocument();
  });
});
