import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedProfile } from "@/lib/auth/types";
import { AdministrationApp } from "./administration-app";

vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
const id = "11111111-1111-4111-8111-111111111111";
const version = "2026-10-17T15:00:00Z";
const profile: AuthenticatedProfile = { id, nome_completo: "Pessoa de teste", papel_usuario: "ADMIN", status_usuario: "APROVADO", gestor_id: null, ultimo_acesso_em: null, created_at: version, updated_at: version };
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
const units = { entity: "unit", datasetVersion: "fixture-v1", rows: [{ id, code: "TEST", name: "Unidade de teste", active: true, createdAt: version, updatedAt: version }], total: 1, options: { units: [], managers: [], employees: [] }, permissions: { canManageRegisters: true, canApproveVacation: true, canProposeVacation: true } };
afterEach(() => vi.unstubAllGlobals());

describe("formulários administrativos", () => {
  it("gestor pode cancelar proposta própria ainda não aprovada",async()=>{
    const vacation={...units,entity:"vacation",rows:[{id,employeeId:id,employeeName:"Proposta própria",employeeNumber:"001",startDate:"2026-11-01",endDate:"2026-11-05",acquisitionStart:null,acquisitionEnd:null,status:"requested",observation:null,archivedAt:null,createdAt:version,updatedAt:version,createdBy:id,managerId:id,canEdit:true}],options:{units:[],managers:[],employees:[{id,name:"Pessoa",employeeNumber:"001",activeInSystem:true}]},permissions:{canManageRegisters:false,canApproveVacation:false,canProposeVacation:true}};
    const fetcher=vi.fn().mockResolvedValueOnce(response(vacation)).mockResolvedValueOnce(response({error:"Conflito teste"},409));vi.stubGlobal("fetch",fetcher);render(<AdministrationApp profile={{...profile,papel_usuario:"GESTOR",gestor_id:id}} entity="vacation"/>);
    fireEvent.click(await screen.findByRole("button",{name:"Editar Proposta própria"}));const dialog=within(screen.getByRole("dialog"));expect(dialog.getByRole("option",{name:"Cancelado"})).toBeInTheDocument();expect(dialog.queryByRole("option",{name:"Aprovado"})).not.toBeInTheDocument();fireEvent.change(dialog.getByLabelText("Etapa *"),{target:{value:"cancelled"}});fireEvent.change(dialog.getByLabelText("Motivo da alteração *"),{target:{value:"Cancelar proposta"}});fireEvent.click(dialog.getByRole("button",{name:"Salvar cadastro"}));await dialog.findByRole("alert");expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({entity:"vacation",action:"save",data:{status:"cancelled",expectedUpdatedAt:version}});
  });
  it("preserva rascunho e envia a versão consultada após conflito de edição", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(units)).mockResolvedValueOnce(response({ error: "Este cadastro foi alterado por outra pessoa." }, 409));
    vi.stubGlobal("fetch", fetcher);
    render(<AdministrationApp profile={profile} entity="unit" />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar Unidade de teste" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Nome *"), { target: { value: "Nome ainda não salvo" } });
    fireEvent.change(dialog.getByLabelText("Motivo da alteração *"), { target: { value: "Revisão cadastral de teste" } });
    fireEvent.click(dialog.getByRole("button", { name: "Salvar cadastro" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("alterado por outra pessoa");
    expect(dialog.getByLabelText("Nome *")).toHaveValue("Nome ainda não salvo");
    expect(dialog.getByLabelText("Motivo da alteração *")).toHaveValue("Revisão cadastral de teste");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ entity: "unit", action: "save", data: { id, expectedUpdatedAt: version, name: "Nome ainda não salvo" } });
  });

  it("mantém arquivamento em diálogo revisável e falha não remove a linha", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(units)).mockResolvedValueOnce(response({ error: "Há cadastros ativos vinculados." }, 409));
    vi.stubGlobal("fetch", fetcher);
    render(<AdministrationApp profile={profile} entity="unit" />);
    fireEvent.click(await screen.findByRole("button", { name: "Arquivar Unidade de teste" }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Motivo da alteração *"), { target: { value: "Arquivamento de teste" } });
    fireEvent.click(dialog.getByRole("button", { name: "Arquivar" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("ativos vinculados");
    fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Editar Unidade de teste" })).toBeInTheDocument();
  });

  it("consulta sem permissão não oferece mutações", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...units, permissions: { ...units.permissions, canManageRegisters: false } })));
    render(<AdministrationApp profile={{ ...profile, papel_usuario: "LEITURA" }} entity="unit" />);
    await screen.findByText("Unidade de teste");
    expect(screen.getByRole("button", { name: "Novo cadastro" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Editar Unidade de teste" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Arquivar Unidade de teste" })).not.toBeInTheDocument();
  });

  it("gestor pode propor férias, mas não vê aprovação nem edição de período bloqueado", async () => {
    const vacation = { ...units, entity: "vacation", rows: [{ id, employeeId: id, employeeName: "Pessoa de teste", employeeNumber: "0001", startDate: "2026-11-01", endDate: "2026-11-10", acquisitionStart: null, acquisitionEnd: null, status: "approved", observation: null, archivedAt: null, createdAt: version, updatedAt: version, canEdit: false }], permissions: { canManageRegisters: false, canApproveVacation: false, canProposeVacation: true } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(vacation)));
    render(<AdministrationApp profile={{ ...profile, papel_usuario: "GESTOR" }} entity="vacation" />);
    await screen.findByText("Pessoa de teste");
    expect(screen.queryByRole("button", { name: "Editar Pessoa de teste" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Novo cadastro" }));
    const options = within(screen.getByLabelText("Etapa *"));
    expect(options.getByRole("option", { name: "Solicitado" })).toBeInTheDocument();
    expect(options.queryByRole("option", { name: "Aprovado" })).not.toBeInTheDocument();
  });

  it.each([
    ["ADMIN", "approved", true, true], ["RH", "approved", true, true],
    ["GESTOR", "draft", true, true], ["GESTOR", "requested", true, true],
    ["GESTOR", "approved", true, false], ["GESTOR", "requested", false, false],
  ] as const)("restauração respeita %s, situação %s e autoria %s", async (role, status, own, allowed) => {
    const vacation = { ...units, entity: "vacation", rows: [{ id, employeeId: id, employeeName: "Férias arquivadas", employeeNumber: "0001", startDate: "2026-11-01", endDate: "2026-11-10", status, archivedAt: version, createdAt: version, updatedAt: version, createdBy: own ? id : "22222222-2222-4222-8222-222222222222", managerId: id, canEdit: false }], permissions: { canManageRegisters: role !== "GESTOR", canApproveVacation: role !== "GESTOR", canProposeVacation: true } };
    const fetcher = vi.fn().mockResolvedValueOnce(response(vacation)).mockResolvedValueOnce(response({ error: "Conflito na restauração." }, 409));
    vi.stubGlobal("fetch", fetcher);
    render(<AdministrationApp profile={{ ...profile, papel_usuario: role, gestor_id: id }} entity="vacation" />);
    await screen.findByText("Férias arquivadas");
    const restore = screen.queryByRole("button", { name: "Restaurar Férias arquivadas" });
    if (!allowed) { expect(restore).not.toBeInTheDocument(); return; }
    expect(restore).toBeInTheDocument(); fireEvent.click(restore!);
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Motivo da alteração *"), { target: { value: "Revisão do arquivamento" } });
    fireEvent.click(dialog.getByRole("button", { name: "Restaurar" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Conflito na restauração");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ entity: "vacation", action: "restore", data: { id, expectedUpdatedAt: version } });
  });
});
