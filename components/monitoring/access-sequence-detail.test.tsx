import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccessSequenceDetail, orderSequenceEvents, SequenceEventTime } from "./access-sequence-detail";
import type { AccessSequence } from "@/lib/monitoring/domain/types";

const punchAt=Date.parse("2026-10-09T22:20:00-03:00");
const sequence: AccessSequence={toleranceMs:300000,findings:[{eventId:"a",punchEventId:"p",pointId:"Saída Torniquete",direction:"exit",role:"end",originalAt:punchAt-47000,punchAt,analyticalAt:punchAt,differenceMs:47000,reason:"aligned"}]};
const events=[{id:"a",type:"access",timestamp:"2026-10-09T22:19:13-03:00"},{id:"p",type:"punch",timestamp:"2026-10-09T22:20:00-03:00"}];
describe("proveniência e ordenação da conciliação",()=>{
 it("exibe os dois horários e deixa claro o alcance do ajuste",()=>{
  render(<AccessSequenceDetail sequence={sequence}/>);
  expect(screen.getByText(/Ponto original:/)).toHaveTextContent("22:20:00");
  expect(screen.getByText(/Acesso original:/)).toHaveTextContent("22:19:13");
  expect(screen.getByText(/Referência analítica do acesso:/)).toHaveTextContent("após o ponto");
  expect(screen.getByText(/Não representa sincronização dos equipamentos/)).toBeInTheDocument();
 });
 it("ordena saída após ponto sem mudar timestamp ou array original",()=>{
  expect(orderSequenceEvents(events,sequence).map(e=>e.id)).toEqual(["p","a"]);
  expect(events[0].id).toBe("a");expect(events[0].timestamp).toBe("2026-10-09T22:19:13-03:00");
  const entry:AccessSequence={...sequence,findings:[{...sequence.findings[0],direction:"entry"}]};
  expect(orderSequenceEvents([...events].reverse(),entry).map(e=>e.id)).toEqual(["a","p"]);
 });
 it("sinaliza o original no evento ordenado pela referência analítica",()=>{
  render(<SequenceEventTime event={events[0]} sequence={sequence}/>);
  expect(screen.getByText(/referência analítica após o ponto/)).toHaveTextContent("22:20:00");
  expect(screen.getByText(/Horário original:/)).toHaveTextContent("22:19:13");
 });
 it("mantém pendente sem apresentar um horário conciliado",()=>{
  render(<AccessSequenceDetail sequence={{...sequence,findings:[{...sequence.findings[0],analyticalAt:null,reason:"ambiguous"}]}}/>);
  expect(screen.getByText(/Sem ajuste automático/)).toBeInTheDocument();
  expect(screen.queryByText(/Referência analítica do acesso:/)).not.toBeInTheDocument();
 });
 it("aceita resultados anteriores sem sequência",()=>{
  expect(orderSequenceEvents(events).map(e=>e.id)).toEqual(["a","p"]);
  const view=render(<AccessSequenceDetail sequence={undefined}/>);expect(view.container).toBeEmptyDOMElement();
 });
});
