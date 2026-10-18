import type { ReactNode } from "react";
import { fireEvent,render,screen,waitFor,within } from "@testing-library/react";
import { afterEach,describe,expect,it,vi } from "vitest";
import type { AuthenticatedProfile } from "@/lib/auth/types";
import type { PlanningSnapshot } from "@/lib/schedule-planning/contracts";
import { PlanningApp } from "./planning-app";
vi.mock("@/components/app-shell",()=>({AppShell:({children}:{children:ReactNode})=><main>{children}</main>}));
const id="11111111-1111-4111-8111-111111111111",person="22222222-2222-4222-8222-222222222222",version="2026-10-18T01:00:00Z";
const profile:AuthenticatedProfile={id,nome_completo:"Teste",papel_usuario:"ADMIN",status_usuario:"APROVADO",gestor_id:null,ultimo_acesso_em:null,created_at:version,updated_at:version};
const model={id,kind:"template" as const,name:"Diurno",scope:"global" as const,target:null,memberCount:1,validFrom:"2026-10-01",validTo:null,payload:{name:"Diurno",start:"08:00",end:"17:00",days:[1,2,3,4,5],allowNoBreak:false,pairing:"alternating",coffeeWindows:[]},active:true,createdAt:version,updatedAt:version};
const snapshot:PlanningSnapshot={records:[model],rosterVersion:"roster-v1",canManage:true,canPropose:true,options:{units:[],managers:[],employees:[{id:person,name:"Pessoa teste",employeeNumber:"001",managerId:null,unitId:id,active:true,admissionDate:"2020-01-01",situation:"ATIVO"}]}};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
afterEach(()=>vi.unstubAllGlobals());
describe("planejamento navegável",()=>{
 it("editar mantém valores e justificativa após conflito de versão",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(response(snapshot)).mockResolvedValueOnce(response({error:"Dados mudaram. Atualize."},409));vi.stubGlobal("fetch",fetcher);
  render(<PlanningApp profile={profile} mode="schedules" today="2026-10-18"/>);
  fireEvent.click(await screen.findByRole("button",{name:"Editar Diurno"}));const dialog=within(screen.getByRole("dialog"));expect(dialog.getByLabelText("Entrada prevista")).toHaveValue("08:00");
  fireEvent.change(dialog.getByLabelText("Nome"),{target:{value:"Diurno revisado"}});fireEvent.change(dialog.getByLabelText("Motivo da alteração"),{target:{value:"Correção teste"}});fireEvent.click(dialog.getByRole("button",{name:"Salvar configuração"}));
  expect(await dialog.findByRole("alert")).toHaveTextContent("Dados mudaram");expect(dialog.getByLabelText("Nome")).toHaveValue("Diurno revisado");expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({action:"save",data:{id,expectedUpdatedAt:version,payload:{start:"08:00",end:"17:00",days:[1,2,3,4,5]}}});
 });
 it("atribuição exige escolha e envia pessoas explícitas e versão da equipe",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(response(snapshot)).mockResolvedValueOnce(response({error:"Lote conflitante"},409));vi.stubGlobal("fetch",fetcher);render(<PlanningApp profile={profile} mode="schedules" today="2026-10-18"/>);
  expect(await screen.findByRole("button",{name:"Atribuir a 0 pessoa(s)"})).toBeDisabled();fireEvent.change(screen.getByLabelText("Modelo"),{target:{value:id}});fireEvent.click(screen.getByLabelText("Pessoa teste · 001"));fireEvent.change(screen.getByLabelText("Fim da vigência"),{target:{value:"2026-10-31"}});fireEvent.change(screen.getByLabelText("Motivo do lote"),{target:{value:"Lote teste"}});fireEvent.click(screen.getByRole("button",{name:"Atribuir a 1 pessoa(s)"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Lote conflitante");expect(screen.getByLabelText("Pessoa teste · 001")).toBeChecked();expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({action:"assign",data:{employeeIds:[person],expectedRosterVersion:"roster-v1",expectedTemplateUpdatedAt:version}});
 });
 it("consulta de férias não aceita automaticamente; seleção cria somente rascunho",async()=>{
  const policy={...model,kind:"vacation_policy" as const,name:"Critérios RH",payload:{minimumTenureDays:365,durationDays:5,noticeDays:0,maximumAbsentPercent:50,minimumAvailable:1,includeRequested:true}};
  const data={...snapshot,records:[policy]};const suggested={version:"suggest-v1",suggestions:[{startDate:"2026-11-01",endDate:"2026-11-05",teamSize:2,peakPlannedAbsent:1,minimumOutsidePlannedVacation:1}],blockers:[],notes:["Aprovação manual."],policy,teamSize:2};
  const fetcher=vi.fn().mockResolvedValueOnce(response(data)).mockResolvedValueOnce(response(suggested)).mockResolvedValueOnce(response({record:{id,status:"draft"}})).mockResolvedValue(response(data));vi.stubGlobal("fetch",fetcher);render(<PlanningApp profile={profile} mode="vacations" today="2026-10-18"/>);
  fireEvent.change(await screen.findByLabelText("Colaborador"),{target:{value:person}});fireEvent.change(screen.getByLabelText("Critérios do RH"),{target:{value:id}});fireEvent.change(screen.getByLabelText("Buscar até (máximo 90 dias)"),{target:{value:"2026-11-30"}});fireEvent.click(screen.getByRole("button",{name:"Consultar sugestões"}));
  const select=await screen.findByRole("radio");expect(fetcher).toHaveBeenCalledTimes(2);expect(select).not.toBeChecked();expect(screen.getByRole("button",{name:"Criar rascunho para revisão"})).toBeDisabled();fireEvent.click(select);fireEvent.change(screen.getByLabelText("Justificativa do rascunho"),{target:{value:"Período proposto"}});fireEvent.click(screen.getByRole("button",{name:"Criar rascunho para revisão"}));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(4));expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject({action:"accept_suggestion",data:{expectedVersion:"suggest-v1",selectedStart:"2026-11-01"}});expect(screen.getByText(/Rascunho criado/)).toBeInTheDocument();
 });
 it("perfil de consulta não recebe controles de gestão",async()=>{vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response({...snapshot,canManage:false,canPropose:false})));render(<PlanningApp profile={{...profile,papel_usuario:"LEITURA"}} mode="schedules" today="2026-10-18"/>);await screen.findByText("Diurno");expect(screen.queryByRole("button",{name:"Nova configuração"})).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Editar Diurno"})).not.toBeInTheDocument();expect(screen.queryByText("Atribuir modelo à equipe")).not.toBeInTheDocument();});
});
