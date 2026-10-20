import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MonitoringApp } from "./monitoring-app";
import { MonitoringAdmin } from "./monitoring-admin";
import { SettingsForm } from "./settings-form";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { filtersSchema, type MonitoringSnapshot } from "@/lib/monitoring/contracts";
import type { AuthenticatedProfile } from "@/lib/auth/types";
import type { AdminSnapshot } from "./admin-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("./use-group-catalog", () => ({ useGroupCatalog: () => ({ catalog: { groups: ["COZINHA JK", "ENT-14H JK VESP"], queriedAt: "2026-10-20T13:00:00Z" }, error: "", retry: () => {} }) }));
const employeeId = "30000000-0000-4000-8000-000000000001";
const profile: AuthenticatedProfile = { id: "10000000-0000-4000-8000-000000000001", nome_completo: "Usuário Sintético", status_usuario: "APROVADO", papel_usuario: "RH", gestor_id: null, ultimo_acesso_em: null, created_at: "2026-10-17", updated_at: "2026-10-17" };
const filters = filtersSchema.parse({ start: "2026-10-17", end: "2026-10-17" });
const snapshot: MonitoringSnapshot = { rows: [{ employeeId, name: "Ana Sintética", employeeNumber: "FICT-001", unit: "CD I", manager: "Gestor Sintético", managerId: "20000000-0000-4000-8000-000000000001", date: "2026-10-17", quality: "partial", dirty: false, computedAt: "2026-10-17T18:00:00Z", ruleVersion: "test-1", summary: { workedSeconds: 28800, outsideSeconds: 1200, cafeteriaSeconds: null, lateSeconds: null } }], total: 1, people: 1, pending: 0, excluded: 0, totals: { workedSeconds: 28800, outsideSeconds: 1200, cafeteriaSeconds: null, lateJourneys: 0, assessedJourneys: 1, unknownSeconds: 900 }, timezone: "America/Sao_Paulo", queriedAt: "2026-10-17T18:00:00Z", start: filters.start, end: filters.end };
const admin: AdminSnapshot = { sources: [{ id: "defense-test", kind: "defense-access", timezone: "America/Sao_Paulo", heartbeat_at: "2000-01-01T00:00:00Z", worker_state: "idle", last_success_at: null }], files: [], settings: [], bindings: [], employees: [{ id: employeeId, name: "Ana Sintética", employeeNumber: "FICT-001" }], users: [{ id: profile.id, name: profile.nome_completo }], pending: [{ source_id: "defense-test", identity_type: "defense", identity_value: "000123", name: "Ana Sintética" }], audit: [] };
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });

describe("Monitoramento integrado", () => {
  it("pesquisa e seleciona grupo sem consultar antes de aplicar; exporta o grupo aplicado", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(response(snapshot));
    render(<MonitoringApp profile={profile} initialFilters={filters} initialSnapshot={snapshot} />);
    await user.click(screen.getByRole("combobox", { name: "Grupo" }));
    await user.type(screen.getByRole("combobox", { name: "Pesquisar grupos" }), "cozinha");
    expect(screen.queryByRole("option", { name: "ENT-14H JK VESP" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "COZINHA JK" }));
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith("/api/monitoring?"))).toHaveLength(0);
    expect(screen.getByRole("link", { name: /Exportar consulta/ })).toHaveAttribute("href", expect.stringContaining("group=&"));
    await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await waitFor(() => expect(screen.getByRole("link", { name: /Exportar consulta/ })).toHaveAttribute("href", expect.stringContaining("group=COZINHA+JK")));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("group=COZINHA+JK"), expect.anything());
    await user.click(screen.getByRole("button", { name: "Limpar campos" }));
    expect(screen.getByRole("combobox", { name: "Grupo" })).toHaveTextContent("Todos os grupos");
  });
  it("mantém parcial e não apurável distintos de zero; exporta filtros aplicados", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(response({ ...snapshot, rows: [], total: 0, people: 0 }));
    render(<MonitoringApp profile={profile} initialFilters={filters} initialSnapshot={snapshot} />);
    expect(screen.getByRole("table")).toHaveTextContent("Parcial");
    expect(screen.getByRole("table")).toHaveTextContent("Não apurável");
    await user.type(screen.getByRole("textbox", { name: "Buscar colaborador" }), "Bruno");
    expect(screen.getByRole("link", { name: /Exportar consulta/ })).toHaveAttribute("href", expect.stringContaining("query=&"));
    await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await waitFor(() => expect(screen.getByRole("link", { name: /Exportar consulta/ })).toHaveAttribute("href", expect.stringContaining("query=Bruno")));
    expect(screen.getByText("Nenhum colaborador encontrado nos filtros e permissões atuais.")).toBeInTheDocument();
  });
  it.each(["GESTOR", "LEITURA"] as const)("%s não recebe controles administrativos", (role) => {
    render(<MonitoringApp profile={{ ...profile, papel_usuario: role }} initialFilters={filters} initialSnapshot={snapshot} />);
    expect(screen.queryByRole("button", { name: "Conciliação" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Importação" })).not.toBeInTheDocument();
  });
  it("falha explícita preserva dados da última consulta sem anunciar sincronização", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(response({ error: "Falha simulada", correlationId: "fixture-reference" }, false));
    render(<MonitoringApp profile={profile} initialFilters={filters} initialSnapshot={snapshot} />);
    await user.click(screen.getByRole("button", { name: "Atualizar consulta" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("fixture-reference"));
    expect(screen.getByRole("alert")).toHaveTextContent("última consulta concluída");
    expect(screen.getByRole("table")).toHaveTextContent("Ana Sintética");
  });
  it("abre o dia escolhido da mesma pessoa e reinicia eventos ao trocar a data", async () => {
    const user = userEvent.setup();
    const period = { ...filters, start: "2026-10-16" };
    const events = Array.from({ length: 100 }, (_, index) => ({ id: `event-${index}`, timestamp: "2026-10-17T11:00:00Z", type: "access", device: "Leitor sintético", classification: "authorized", eligible: true, conflicted: false, provenance: [] }));
    vi.mocked(fetch).mockResolvedValue(response({ results: [], events }));
    render(<MonitoringApp profile={profile} initialFilters={period} initialSnapshot={{ ...snapshot, start: period.start, rows: [{ ...snapshot.rows[0], date: "2026-10-16" }, snapshot.rows[0]], total: 2 }} />);
    await user.click(screen.getAllByRole("button", { name: "Detalhes de Ana Sintética" })[1]);
    expect(screen.getByLabelText("Data operacional")).toHaveValue("2026-10-17");
    await waitFor(() => expect(screen.getByRole("button", { name: "Próximos eventos" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Próximos eventos" }));
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining("offset=100"), expect.anything()));
    await waitFor(() => expect(screen.getByRole("button", { name: "Eventos anteriores" })).toBeEnabled());
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => {}));
    fireEvent.change(screen.getByLabelText("Data operacional"), { target: { value: "2026-10-16" } });
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining("date=2026-10-16&offset=0"), expect.anything()));
    expect(screen.getByText("Carregando detalhes…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eventos anteriores" })).toBeDisabled();
  });
  it("atalho mensal preenche datas sem alterar consulta antes de aplicar", () => {
    render(<MonitoringApp profile={profile} initialFilters={filters} initialSnapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText("Preencher período por mês"), { target: { value: "2028-02" } });
    expect(screen.getByLabelText("Data inicial")).toHaveValue("2028-02-01");
    expect(screen.getByLabelText("Data final")).toHaveValue("2028-02-29");
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith("/api/monitoring"))).toHaveLength(0);
    expect(screen.getByRole("link", { name: /Exportar consulta/ })).toHaveAttribute("href", expect.stringContaining("start=2026-10-17"));
  });
  it("salva regras no alvo global reconhecido pelo cálculo", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(true);
    render(<SettingsForm employees={admin.employees} users={admin.users} today={filters.start} save={save} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Configuração" }), "rule");
    await user.type(screen.getByRole("textbox", { name: "Justificativa" }), "Revisão sintética das regras");
    await user.click(screen.getByRole("button", { name: "Salvar configuração" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: "rule", target: "global", payload: expect.objectContaining({ initialLookbackSeconds: 3600, maxJourneyHours: 18 }) }));
  });
  it("mostra fonte sem heartbeat recente como pendência, não concluída", async () => {
    vi.mocked(fetch).mockResolvedValue(response(admin));
    render(<MonitoringAdmin section="import" today={filters.start} />);
    await screen.findByText("Sem sinal recente do processo local");
    expect(screen.getByText("Nenhum arquivo processado.")).toBeInTheDocument();
  });
  it("conciliação preserva zeros e rascunho após erro", async () => {
    const user = userEvent.setup();
    const twoIdentities = { ...admin, pending: [...admin.pending, { ...admin.pending[0], identity_value: "000124", name: "Outro Cadastro" }] };
    vi.mocked(fetch).mockImplementation(async (_url, options) => response(options?.method === "POST" ? { error: "Conflito de vínculo" } : twoIdentities, options?.method !== "POST"));
    render(<MonitoringAdmin section="reconcile" today={filters.start} />);
    await user.click(await screen.findByRole("button", { name: /Ana Sintética.*Conferir vínculo/ }));
    const form = within(screen.getByRole("form", { name: "Vincular identidade" }));
    expect(form.getByRole("textbox", { name: "Identificador completo" })).toHaveValue("000123");
    await user.selectOptions(form.getByRole("combobox", { name: "Colaborador RH" }), employeeId);
    await user.type(form.getByRole("textbox", { name: "Evidência do vínculo" }), "Conferência documental sintética");
    await user.click(form.getByRole("button", { name: "Salvar vínculo" }));
    await screen.findByText("Conflito de vínculo");
    expect(form.getByRole("textbox", { name: "Evidência do vínculo" })).toHaveValue("Conferência documental sintética");
    const body = JSON.parse(vi.mocked(fetch).mock.calls.find((call) => call[1]?.method === "POST")![1]!.body as string);
    expect(body.data.identityValue).toBe("000123");
    await user.click(screen.getByRole("button", { name: /Outro Cadastro.*Conferir vínculo/ }));
    expect(form.getByRole("combobox", { name: "Colaborador RH" })).toHaveValue("");
    expect(form.getByRole("textbox", { name: "Evidência do vínculo" })).toHaveValue("");
  });
  it("vincula foto usando seleção de conta existente, sem exigir UUID digitado", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(response(admin));
    render(<MonitoringAdmin section="settings" today={filters.start} />);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Configuração" }), "user_link");
    expect(screen.getByRole("combobox", { name: "Conta de usuário" })).toHaveTextContent("Usuário Sintético");
    expect(screen.queryByRole("textbox", { name: "Identificador da conta de usuário" })).not.toBeInTheDocument();
  });
  it("foto indisponível usa iniciais da mesma pessoa", () => {
    render(<EmployeeAvatar name="Ana Sintética" employeeId={employeeId} />);
    fireEvent.error(screen.getByRole("img", { name: "Foto de Ana Sintética" }));
    expect(screen.getByRole("img", { name: "Ana Sintética — foto indisponível" })).toHaveTextContent("AS");
  });
});
