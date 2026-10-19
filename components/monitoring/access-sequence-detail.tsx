import type { AccessSequence, AccessSequenceFinding } from "@/lib/monitoring/domain/types";
import { duration, instant } from "./shared";

const reasons: Record<AccessSequenceFinding["reason"], string> = {
  aligned: "Conciliado somente na análise",
  outsideTolerance: "Acima de 5 minutos; conferir com RH/admin",
  ambiguous: "Passagens ou batidas concorrentes; conferir com RH/admin",
  journeyUnconfirmed: "Jornada ainda não confirmada; conferir batidas",
  manualAccess: "Acesso manual; conferir com RH/admin",
};
const roles = { start: "Entrada do expediente", breakStart: "Saída para intervalo", breakEnd: "Volta do intervalo", end: "Saída do expediente" };

export function AccessSequenceDetail({sequence}: {sequence: AccessSequence | undefined}) {
  if (!sequence?.findings.length) return null;
  return <section aria-label="Conciliação entre ponto e torniquete" className="rounded-lg border border-amber-300 bg-amber-50 p-3">
    <h3 className="font-semibold text-amber-950">Divergências entre ponto e torniquete</h3>
    <p className="mt-1 text-xs leading-relaxed text-amber-950">Sequência física: entrada no torniquete, ponto dentro do CD, saída no torniquete. Tolerância de 5 minutos. A referência analítica ajusta a sequência e os indicadores de localização; preserva horários originais, jornada e Banco de Horas. Não representa sincronização dos equipamentos.</p>
    <ol className="mt-3 space-y-2">{sequence.findings.map((finding,index)=><li key={`${finding.eventId}:${finding.punchEventId}:${index}`} className="rounded-md border border-amber-200 bg-white p-3 text-xs">
      <b>{roles[finding.role]} · {reasons[finding.reason]}</b>
      <p className="mt-1">{finding.pointId} · Diferença: {duration(finding.differenceMs/1000)}</p>
      <p>Ponto original: {instant(finding.punchAt)}</p><p>Acesso original: {instant(finding.originalAt)}</p>
      {finding.analyticalAt!==null ? <p className="mt-1 font-semibold text-blue-900">Referência analítica do acesso: {instant(finding.analyticalAt)} · {finding.direction==="exit"?"após o ponto":"antes do ponto"}. Mesmo instante de referência, sem inventar segundos.</p> : <p className="mt-1 font-semibold text-amber-950">Sem ajuste automático. Mantidos os horários originais para revisão.</p>}
    </li>)}</ol>
  </section>;
}

/** Sort a copy; pagination and the original device values are not rewritten. */
export function orderSequenceEvents<T extends {id:string;timestamp:string;type:string}>(events: T[], sequence?: AccessSequence): T[] {
  const aligned=new Map(sequence?.findings.filter(f=>f.analyticalAt!==null).map(f=>[f.eventId,f])??[]);
  const rank=(event:T)=>aligned.get(event.id)?.direction==="entry"?0:event.type==="punch"?1:2;
  const timestamp=(event:T)=>aligned.get(event.id)?.analyticalAt??Date.parse(event.timestamp);
  return [...events].sort((a,b)=>timestamp(a)-timestamp(b)||rank(a)-rank(b)||a.id.localeCompare(b.id));
}

export function SequenceEventTime({event,sequence}:{event:{id:string;timestamp:string;type:string};sequence?:AccessSequence}) {
  const finding=sequence?.findings.find(f=>f.eventId===event.id&&f.analyticalAt!==null);
  return finding ? <div><b>{instant(finding.analyticalAt)} · Acesso · referência analítica {finding.direction==="exit"?"após o ponto":"antes do ponto"}</b><p className="mt-1 text-amber-900">Horário original: {instant(event.timestamp)} · divergência de {duration(finding.differenceMs/1000)}</p></div>
    : <b>{instant(event.timestamp)} · {event.type==="punch"?"Ponto":"Acesso"}</b>;
}
