import { describe, expect, it } from "vitest";
import { calculateJourney } from "./calculate";
import { reconcileAccessSequence } from "./access-sequence";
import { prepareAccess, DEFAULT_REPETITION_POLICY } from "./events";
import type { AccessEvent, AccessPointMapping, Journey, PunchEvent } from "./types";

const personId = "employee";
const date = "2026-10-09";
const at = (time: string, day = date) => Date.parse(`${day}T${time.length === 5 ? time + ":00" : time}-03:00`);
const punches: PunchEvent[] = ["14:00", "18:00", "19:00", "22:20"].map((time, i) => ({id:`p${i}`,personId,at:at(time),sourceId:i%2 ? "clock-cpf" : "clock-pis",precision:"minute"}));
const journey: Journey = {status:"complete", work:[{start:punches[0].at,end:punches[1].at},{start:punches[2].at,end:punches[3].at}],rest:[{start:punches[1].at,end:punches[2].at}],provisionalWork:[],firstEntry:punches[0].at,lastExit:punches[3].at,retainedPunchIds:punches.map(p=>p.id),issues:[]};
const mappings: AccessPointMapping[] = (["entry","exit"] as const).map(direction=>({id:direction,pointId:direction,portalId:"turnstile",area:"operation",direction,validated:true,eventClasses:["authorized"],validFrom:"2026-01-01"}));
const access=(direction:string,time:string,id=direction):AccessEvent=>({id,personId,at:at(time),sourceId:"defense",pointId:direction,eventClass:"authorized",authorized:true,identified:true});
const reconcile=(events:AccessEvent[],j=journey,ps=punches,ms=mappings)=>reconcileAccessSequence(prepareAccess(events,ms,date,personId,DEFAULT_REPETITION_POLICY).events,ps,j);

describe("sequência física entre ponto interno e torniquete",()=>{
 it("concilia o exemplo de 22:19:13/22:20 sem alterar a origem",()=>{
  const original=access("exit","22:19:13"); const result=reconcile([original]);
  expect(result.sequence.findings[0]).toMatchObject({reason:"aligned",role:"end",differenceMs:47_000,originalAt:at("22:19:13"),analyticalAt:at("22:20")});
  expect(original.at).toBe(at("22:19:13")); expect(result.events[0].event.at).toBe(at("22:20"));
  expect(punches[3].at).toBe(at("22:20"));
 });
 it.each([["entry","14:02",0],["exit","17:59",1],["entry","19:03",2]] as const)("concilia %s %s contra o limite %i",(direction,time,index)=>{
  expect(reconcile([access(direction,time)]).sequence.findings[0]).toMatchObject({punchEventId:`p${index}`,reason:"aligned",analyticalAt:punches[index].at});
 });
 it("aceita exatamente cinco minutos, deixa 5m01s para revisão",()=>{
  expect(reconcile([access("exit","22:15")]).sequence.findings[0].reason).toBe("aligned");
  expect(reconcile([access("exit","22:14:59")]).sequence.findings[0]).toMatchObject({reason:"outsideTolerance",analyticalAt:null});
 });
 it("não muda passagens já ordenadas",()=>expect(reconcile([access("entry","13:59"),access("exit","22:21")]).sequence.findings).toEqual([]));
 it("não muda jornada de três batidas nem infere papel faltante",()=>{
  expect(reconcile([access("exit","22:19:13")],{...journey,status:"partial"}).sequence.findings[0].reason).toBe("journeyUnconfirmed");
 });
 it("não altera acesso manual",()=>{
  const a=access("exit","22:19:13");a.provenance={sourceId:"defense",origin:"manual",justification:"Conferido RH"};
  expect(reconcile([a]).sequence.findings[0].reason).toBe("manualAccess");
 });
 it("não atravessa uma passagem oposta",()=>{
  const result=reconcile([access("exit","22:19:13"),access("entry","22:19:30")]);
  expect(result.sequence.findings.find(f=>f.direction==="exit")).toMatchObject({reason:"ambiguous",analyticalAt:null});
 });
 it("não escolhe entre saídas concorrentes",()=>{
  const result=reconcile([access("exit","22:18","a"),access("exit","22:19:13","b")]);
  expect(result.sequence.findings[0].reason).toBe("ambiguous");
 });
 it("desconsidera acesso negado, pessoa diferente e mapa não validado",()=>{
  expect(reconcile([{...access("exit","22:19"),authorized:false}]).sequence.findings).toEqual([]);
  expect(reconcile([{...access("exit","22:19"),personId:"other"}]).sequence.findings).toEqual([]);
  expect(reconcile([access("exit","22:19")],journey,punches,mappings.map(m=>({...m,validated:false}))).sequence.findings).toEqual([]);
 });
 it("não usa refeitório nem perímetro como torniquete interno",()=>{
  expect(reconcile([access("exit","22:19")],journey,punches,mappings.map(m=>({...m,area:"cafeteria"}))).sequence.findings).toEqual([]);
 });
 it("respeita jornada noturna que termina no dia seguinte",()=>{
  const p= punches.map((v,i)=>({...v,at:at(["22:00","02:00","03:00","06:20"][i],i?"2026-10-10":date)}));
  const a={...access("exit","06:19:13"),at:at("06:19:13","2026-10-10")};
  expect(reconcile([a],{...journey,retainedPunchIds:p.map(v=>v.id)},p).sequence.findings[0]).toMatchObject({reason:"aligned",analyticalAt:p[3].at});
 });
 it("remove falso tempo fora sem mudar jornada ou descanso",()=>{
  const result=calculateJourney({personId,operationalDate:date,referenceAt:at("23:00"),observationWindow:{start:at("13:00"),end:at("23:00")},punchEvents:punches,
   accessEvents:[access("entry","13:59"),access("exit","22:19:13")],mappings,evidence:{startConfirmed:true,endConfirmed:true,startCoverageConfirmed:true},
   schedule:{id:"shift",expectedStart:at("14:00"),expectedEnd:at("22:20"),pairing:"alternating",allowNoBreak:false},coverage:[{area:"operation",start:at("13:00"),end:at("23:00"),declaredComplete:true,sourceIds:["defense"],evidence:"Coleta integral confirmada"}]});
  expect(result.outsideOperation.milliseconds).toBe(0); expect(result.workMs).toBe(440*60_000);expect(result.restMs).toBe(60*60_000);
  expect(result.accessSequence?.findings[0].differenceMs).toBe(47_000);
 });
});
