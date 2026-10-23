import { act,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { MonitoringProcessingProgress } from "./processing-progress";
import { filtersSchema } from "@/lib/monitoring/contracts";
import { processingPercentage,type ProcessingProgress } from "@/lib/monitoring/processing-progress";
const filters=filtersSchema.parse({start:"2026-10-01",end:"2026-10-23"});
const sample:ProcessingProgress={checkedAt:"2026-10-23T20:00:00Z",datasetVersion:"1:2",start:filters.start,end:filters.end,total:100,completed:25,pending:75,running:5,deferred:2,failed:0,limited:3,withoutData:1,lastCalculationAt:null,activeImports:0,imports:[{id:"one",fileName:"ponto.txt",status:"completed",processedRows:500,totalRows:500,completedAt:"2026-10-23T20:00:00Z"}]};
beforeEach(()=>{vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(sample))));});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe("atualização dos indicadores",()=>{
 it("separa arquivo importado de recálculo e dados insuficientes",async()=>{
  const refresh=vi.fn();render(<MonitoringProcessingProgress filters={filters} snapshotVersion="1:1" onRefresh={refresh}/>);
  expect(await screen.findByText("Atualizando indicadores")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("value","25");
  expect(screen.getByText(/75 na fila/)).toBeInTheDocument();expect(screen.getByText(/Concluir o recálculo não preenche/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Últimas 3 importações"));expect(screen.getByText("Arquivo importado · 100%")).toBeInTheDocument();
  expect(refresh).toHaveBeenCalledOnce();
 });
 it("mostra 100% somente quando não há recálculos pendentes",async()=>{
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({...sample,completed:100,pending:0,running:0,limited:0,withoutData:0})));
  render(<MonitoringProcessingProgress filters={filters} onRefresh={()=>{}}/>);
  expect(await screen.findByText("Indicadores atualizados")).toBeInTheDocument();expect(screen.getByRole("progressbar")).toHaveAttribute("value","100");
  expect(processingPercentage({completed:999,total:1000})).toBe(99.9);
 });
 it("não declara indicadores completos quando o recálculo termina com evidência insuficiente",async()=>{
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({...sample,completed:100,pending:0,running:0})));
  render(<MonitoringProcessingProgress filters={filters} onRefresh={()=>{}}/>);
  expect(await screen.findByText("Recálculos concluídos · há dados a conferir")).toBeInTheDocument();
  expect(screen.queryByText("Indicadores atualizados")).not.toBeInTheDocument();
 });
 it("não inventa percentual sem denominador e informa importação em andamento",async()=>{
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({...sample,total:0,completed:0,pending:0,activeImports:1})));
  render(<MonitoringProcessingProgress filters={filters} onRefresh={()=>{}}/>);
  expect(await screen.findByText(/Importando arquivos/)).toBeInTheDocument();expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
 });
 it("falha de comunicação não confirma atualização e não publica dados do escopo anterior",async()=>{
  const {rerender,unmount}=render(<MonitoringProcessingProgress filters={filters} onRefresh={()=>{}}/>);
  await screen.findByText("Atualizando indicadores");let signal:AbortSignal|undefined;
  vi.mocked(fetch).mockImplementation((_url,init)=>{signal=init?.signal as AbortSignal;return new Promise(()=>{});});
  rerender(<MonitoringProcessingProgress filters={{...filters,unit:"CD II"}} onRefresh={()=>{}}/>);
  expect(screen.queryByText(/75 na fila/)).not.toBeInTheDocument();
  await waitFor(()=>expect(signal).toBeDefined());unmount();expect(signal?.aborted).toBe(true);
 });
 it("atualiza periodicamente e cancela a verificação ao sair",async()=>{
  vi.useFakeTimers();const {unmount}=render(<MonitoringProcessingProgress filters={filters} onRefresh={()=>{}}/>);
  await act(async()=>{});expect(fetch).toHaveBeenCalledOnce();
  await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});expect(fetch).toHaveBeenCalledTimes(2);
  unmount();await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(fetch).toHaveBeenCalledTimes(2);
 });
});
