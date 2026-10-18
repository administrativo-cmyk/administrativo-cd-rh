import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedProfile } from "@/lib/auth/types";
import { SettingsApp } from "./settings-app";
import { NotificationsApp } from "./notifications-app";

vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const id = "11111111-1111-4111-8111-111111111111";
const version = "2026-10-17T15:00:00Z";
const profile: AuthenticatedProfile = { id, nome_completo: "Pessoa de teste", papel_usuario: "ADMIN", status_usuario: "APROVADO", gestor_id: null, ultimo_acesso_em: null, created_at: version, updated_at: version };
const settings = { defaultDashboard: "index", compactTables: false, notificationsEnabled: true, updatedAt: version, profileName: "Pessoa de teste", profileUpdatedAt: version };
const notice = { id, title: "Aviso de teste", body: "Conteúdo de teste", audienceRole: null, managerId: null, createdAt: version, updatedAt: version, archivedAt: null };
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
afterEach(() => vi.unstubAllGlobals());

describe("preferências e notificações", () => {
  it("preserva preferências e versão consultada ao falhar salvamento", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(settings)).mockResolvedValueOnce(response({ error: "Preferências alteradas em outra sessão." }, 409));
    vi.stubGlobal("fetch", fetcher);
    render(<SettingsApp profile={profile} />);
    await screen.findByDisplayValue("Pessoa de teste");
    await screen.findByRole("button", { name: "Salvar preferências" });
    // The query resolves asynchronously; the select becomes editable with the stored version.
    const select = screen.getByLabelText("Página inicial");
    await vi.waitFor(() => expect(select).toBeEnabled());
    fireEvent.change(select, { target: { value: "quadro-atual" } });
    fireEvent.click(screen.getByLabelText("Tabelas compactas"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("outra sessão");
    expect(select).toHaveValue("quadro-atual");
    expect(screen.getByLabelText("Tabelas compactas")).toBeChecked();
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ action: "save_preferences", data: { defaultDashboard: "quadro-atual", compactTables: true, expectedUpdatedAt: version } });
  });

  it("mantém nome digitado após conflito e não expõe links administrativos a leitura", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(settings)).mockResolvedValueOnce(response({ error: "Perfil alterado em outra sessão." }, 409)));
    render(<SettingsApp profile={{ ...profile, papel_usuario: "LEITURA" }} />);
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Salvar nome" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Nome novo de teste" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nome" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Perfil alterado");
    expect(screen.getByLabelText("Nome completo")).toHaveValue("Nome novo de teste");
    expect(screen.queryByRole("link", { name: "Administrar avisos" })).not.toBeInTheDocument();
  });

  it("aviso mantém título, conteúdo, motivo e CAS após erro de publicação", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ rows: [notice], total: 1, managers: [] })).mockResolvedValueOnce(response({ error: "Aviso alterado por outra pessoa." }, 409));
    vi.stubGlobal("fetch", fetcher);
    render(<NotificationsApp profile={profile} initialManage />);
    fireEvent.click(await screen.findByRole("button", { name: /^Editar/ }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Título"), { target: { value: "Título revisado" } });
    fireEvent.change(dialog.getByLabelText("Conteúdo"), { target: { value: "Conteúdo ainda não salvo" } });
    fireEvent.change(dialog.getByLabelText("Motivo"), { target: { value: "Revisão de teste" } });
    fireEvent.click(dialog.getByRole("button", { name: "Publicar aviso" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("alterado por outra pessoa");
    expect(dialog.getByLabelText("Título")).toHaveValue("Título revisado");
    expect(dialog.getByLabelText("Conteúdo")).toHaveValue("Conteúdo ainda não salvo");
    expect(dialog.getByLabelText("Motivo")).toHaveValue("Revisão de teste");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ action: "save_notice", data: { id, expectedUpdatedAt: version, title: "Título revisado" } });
  });

  it("perfil leitura recebe sua caixa e não alcança gerenciamento pela propriedade inicial", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ rows: [], total: 0, unread: 0 }));
    vi.stubGlobal("fetch", fetcher);
    render(<NotificationsApp profile={{ ...profile, papel_usuario: "LEITURA" }} initialManage />);
    await screen.findByText("Nenhuma notificação neste filtro.");
    expect(screen.queryByRole("button", { name: "Administrar avisos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Criar aviso" })).not.toBeInTheDocument();
    expect(JSON.parse(fetcher.mock.calls[0][1].body).action).toBe("notifications");
  });

  it("envia busca, período, tipo e não lidas ao servidor", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response({ rows: [], total: 0, unread: 0 })));
    vi.stubGlobal("fetch", fetcher);
    render(<NotificationsApp profile={profile} />);
    await screen.findByText("Nenhuma notificação neste filtro.");
    fireEvent.change(screen.getByLabelText("Buscar título ou conteúdo"), { target: { value: "Pendências" } });
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-10-17" } });
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "daily" } });
    fireEvent.click(screen.getByLabelText("Somente não lidas"));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ action: "notifications", data: { query: "Pendências", start: "2026-10-01", end: "2026-10-17", type: "daily", unreadOnly: true, offset: 0, limit: 25 } });
  });

  it("operação em lote envia apenas seleção atual e mantém filtros ao detectar concorrência", async () => {
    const rows = [1, 2].map(n => ({ key: `daily:fixture-${n}`, title: `Pendência sintética ${n}`, body: "Revisão necessária", createdAt: version, readAt: null, archivedAt: null, updatedAt: n === 1 ? version : null, href: "/", type: "daily" }));
    const fetcher = vi.fn().mockResolvedValueOnce(response({ rows, total: 2, unread: 2 })).mockResolvedValueOnce(response({ error: "Notificação alterada em outra sessão." }, 409));
    vi.stubGlobal("fetch", fetcher);
    render(<NotificationsApp profile={profile} />);
    await screen.findByText("Pendência sintética 1");
    fireEvent.change(screen.getByLabelText("Buscar título ou conteúdo"), { target: { value: "Rascunho do filtro" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar Pendência sintética 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Arquivar seleção" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("outra sessão");
    expect(screen.getByLabelText("Buscar título ou conteúdo")).toHaveValue("Rascunho do filtro");
    expect(screen.getByRole("button", { name: "Minha caixa (2 não lidas)" })).toBeInTheDocument();
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ action: "notification_state_batch", data: { operation: "archive", items: [{ key: rows[0].key, expectedUpdatedAt: version }] } });
  });
});
