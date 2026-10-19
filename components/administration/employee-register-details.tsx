"use client";

import type { AdministrationEmployee, AdministrationSnapshot } from "@/lib/administration/contracts";
import { situationLabels } from "@/lib/workforce";
import { situationColors } from "@/lib/employee-lifecycle";

const date = (value: string) => value.split("-").reverse().join("/");
export function EmployeeRegisterDetails({ row, snapshot, review }: { row: AdministrationEmployee; snapshot: AdministrationSnapshot; review: () => void }) {
  const signal = row.statusSignal;
  return <>
    <td className="p-3"><p className="whitespace-nowrap text-xs">{row.cpf ? `CPF ${row.cpf}` : "CPF não informado"}</p><p className="mt-1 whitespace-nowrap text-xs">{row.pis ? `PIS ${row.pis}` : "PIS não informado"}</p></td>
    <td className="p-3 text-slate-700">{snapshot.options.managers.find(manager => manager.id === row.managerId)?.name ?? "Sem gestor"}<p className="mt-1 text-xs text-slate-500">{row.department || "Setor não informado"}</p></td>
    <td className="p-3 text-slate-700">{row.defaultSchedule ? <><p className="font-medium">{row.defaultSchedule.start} às {row.defaultSchedule.end}</p><p className="mt-1 text-xs">{row.defaultSchedule.name}</p></> : "Horário não definido"}</td>
    <td className="min-w-56 p-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${situationColors[row.situation]}`}>{situationLabels[row.situation]}</span>
      {row.terminationDate ? <p className="mt-1 text-xs text-slate-600">Desligamento: {date(row.terminationDate)}</p> : null}
      {row.situation === "DESLIGADO" && !row.terminationDate ? <p className="mt-1 text-xs font-medium text-amber-900">Informe a data de desligamento.</p> : null}
      {row.expectedReturnDate ? <p className="mt-1 text-xs text-slate-600">Retorno previsto: {date(row.expectedReturnDate)}</p> : null}
      {signal ? <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950"><p>{signal.kind === "return_suggested" ? "Ponto recorrente: confira o retorno para Ativo." : signal.kind === "return_overdue" ? "Retorno vencido sem confirmação. RH: atualize a previsão. Sem falta automática." : "Complete o início e o retorno previsto. Afastamento protegido."}</p><button type="button" className="mt-1 min-h-9 rounded px-2 font-semibold underline focus-visible:outline-2" onClick={review}>Revisar situação</button></div> : null}
    </td>
  </>;
}
