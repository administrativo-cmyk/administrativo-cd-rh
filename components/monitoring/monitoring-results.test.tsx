import { render,screen,within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe,it,expect,vi } from "vitest";
import { MonitoringResults } from "./monitoring-results";
import { monitoringQueryView } from "@/lib/monitoring/query-view";
import { filtersSchema,type MonitoringSnapshot } from "@/lib/monitoring/contracts";
const employeeId="30000000-0000-4000-8000-000000000001";
const filters=filtersSchema.parse({start:"2026-10-08",end:"2026-10-09"});
const source:MonitoringSnapshot={rows:["2026-10-08","2026-10-09"].map((date,i)=>({employeeId,name:"Ana Sintética",employeeNumber:"123",unit:"CD I",manager:null,managerId:null,date,quality:"partial",dirty:false,computedAt:null,ruleVersion:"test",summary:{workedSeconds:i?null:3600,outsideSeconds:i?null:0,cafeteriaSeconds:null,lateSeconds:null}})),total:2,people:1,pending:0,excluded:0,totals:{},timezone:"America/Sao_Paulo",queriedAt:"2026-10-19T12:00:00Z",start:filters.start,end:filters.end};
describe("resumo expansível do Monitoramento",()=>{
 it("identifica localização observada e refeitório mantido sem intervalo no ponto",async()=>{
  const user=userEvent.setup();
  const rows=source.rows.map(row=>({...row,summary:{...row.summary,outsideQuality:"excluded",locationObservation:{quality:"observed-partial",outsideSeconds:92,cafeteriaSeconds:1880,cafeteriaWithinSuggestedRestSeconds:1880,reason:"Somente intervalo marcado no ponto é excluído do refeitório"}}}));
  render(<MonitoringResults snapshot={monitoringQueryView({...source,rows},filters)} applied={filters} loading={false} onSort={vi.fn()} onPage={vi.fn()} onDetails={vi.fn()}/>);
  expect(screen.getByTestId("monitoring-employee-summary")).toHaveTextContent("2 com tempo observado parcial");
  await user.click(screen.getByRole("button",{name:"Expandir dias de Ana Sintética"}));
  expect(screen.getAllByText("Observado · cobertura parcial · inclui período sem intervalo no ponto")).toHaveLength(2);
 });
 it("exibe descanso e separa cálculo sugerido de jornada confirmada",async()=>{
  const user=userEvent.setup();const rows=source.rows.map(row=>({...row,summary:{...row.summary,workedSeconds:null,workObservation:{basis:"turnstile-suggestion",workedSeconds:28800,restSeconds:3600,restBasis:"turnstile-suggestion",reason:"Intervalo sugerido do torniquete"}}}));
  render(<MonitoringResults snapshot={monitoringQueryView({...source,rows},filters)} applied={filters} loading={false} onSort={vi.fn()} onPage={vi.fn()} onDetails={vi.fn()}/>);
  expect(screen.getByRole("columnheader",{name:"Descanso"})).toBeVisible();
  expect(screen.getByTestId("monitoring-employee-summary")).toHaveTextContent("2 de 2");
  expect(screen.getByTestId("monitoring-employee-summary")).toHaveTextContent("2 sugerido(s) pelo torniquete");
  await user.click(screen.getByRole("button",{name:"Expandir dias de Ana Sintética"}));
  expect(screen.getAllByText("Sugerido · torniquete")).toHaveLength(2);
  expect(screen.getAllByText("Intervalo sugerido · torniquete")).toHaveLength(2);
 });
 it("soma refeições como contagem e mostra exclusões sem converter em zero",()=>{
  const rows=source.rows.map((row,i)=>({...row,summary:{...row.summary,mealsWithoutRest:i?2:1,mealQuality:"complete",outsideQuality:"excluded",cafeteriaQuality:"partial",outsideSeconds:null}}));
  render(<MonitoringResults snapshot={monitoringQueryView({...source,rows},filters)} applied={filters} loading={false} onSort={vi.fn()} onPage={vi.fn()} onDetails={vi.fn()}/>);
  expect(screen.getByTestId("monitoring-employee-summary")).toHaveTextContent("3 vez(es)");expect(screen.getByTestId("monitoring-employee-summary")).toHaveTextContent("Excluído por regra");expect(screen.getByRole("button",{name:"Ordenar por Refeições sem descanso"})).toBeEnabled();
 });
 it("mostra uma linha com soma e expande dias com nomes acessíveis",async()=>{
  const user=userEvent.setup(),onDetails=vi.fn();render(<MonitoringResults snapshot={monitoringQueryView(source,filters)} applied={filters} loading={false} onSort={vi.fn()} onPage={vi.fn()} onDetails={onDetails}/>);
  expect(screen.getAllByTestId("monitoring-employee-summary")).toHaveLength(1);expect(screen.getByTestId("monitoring-employee-summary")).toHaveTextContent("1h 00min");expect(screen.getByTestId("monitoring-employee-summary")).toHaveTextContent("1 de 2");
  const expand=screen.getByRole("button",{name:"Expandir dias de Ana Sintética"});expect(expand).toHaveAttribute("aria-expanded","false");
  await user.click(expand);expect(screen.getByRole("button",{name:"Recolher dias de Ana Sintética"})).toHaveAttribute("aria-expanded","true");
  await user.click(screen.getByRole("button",{name:"Detalhes de Ana Sintética em 09/10/2026"}));expect(onDetails).toHaveBeenCalledWith(employeeId,"2026-10-09");
  await user.click(screen.getByRole("button",{name:"Recolher dias de Ana Sintética"}));expect(screen.queryByRole("button",{name:"Detalhes de Ana Sintética em 09/10/2026"})).not.toBeInTheDocument();
 });
 it("cabeçalhos indicam e acionam ordenação, com bloqueio durante carga",async()=>{
  const user=userEvent.setup(),sort=vi.fn();const props={snapshot:monitoringQueryView(source,filters),applied:{...filters,orderBy:"workedSeconds" as const,direction:"desc" as const},loading:false,onSort:sort,onPage:vi.fn(),onDetails:vi.fn()};
  const {rerender}=render(<MonitoringResults {...props}/>);
  const header=screen.getByRole("columnheader",{name:"Trabalho"});expect(header).toHaveAttribute("aria-sort","descending");await user.click(within(header).getByRole("button"));expect(sort).toHaveBeenCalledWith("workedSeconds");
  rerender(<MonitoringResults {...props} loading/>);expect(screen.getByRole("button",{name:"Ordenar por Trabalho"})).toBeDisabled();
 });
});
