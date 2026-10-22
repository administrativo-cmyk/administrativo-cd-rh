import { render,screen,within } from "@testing-library/react";
import { describe,expect,it } from "vitest";
import { ImportFreshnessSummary } from "./import-freshness";
import type { ImportFreshness } from "@/lib/monitoring/import-freshness";

const freshness:ImportFreshness[]=[
  {sourceId:"pis",name:"Relógio PIS",kind:"afd",lastImportAt:"2026-10-21T14:49:00Z",lastRecordAt:"2026-10-20T13:08:00Z"},
  {sourceId:"cpf",name:"Relógio CPF",kind:"afd",lastImportAt:"2026-10-21T15:18:00Z",lastRecordAt:"2026-10-20T13:17:00Z"},
  {sourceId:"facial",name:"Faciais (Defense)",kind:"defense-access",lastImportAt:"2026-10-19T20:41:00Z",lastRecordAt:"2026-10-19T02:54:09Z"},
];
describe("import source freshness",()=>{
  it("distinguishes import completion from record time and displays the correct day in Brasilia",()=>{
    render(<ImportFreshnessSummary rows={freshness}/>);
    const pis=within(screen.getByRole('article',{name:'Relógio PIS'}));
    expect(pis.getByText(/21\/10\/2026.*11:49:00/)).toBeInTheDocument();
    expect(pis.getByText(/20\/10\/2026.*10:08:00/)).toHaveAttribute('dateTime','2026-10-20T13:08:00Z');
    expect(within(screen.getByRole('article',{name:'Relógio CPF'})).getByText(/20\/10\/2026.*10:17:00/)).toBeInTheDocument();
    const facial=within(screen.getByRole('article',{name:'Faciais (Defense)'}));
    expect(facial.getByText('Último acesso facial importado')).toBeInTheDocument();
    expect(facial.getByText(/18\/10\/2026.*23:54:09/)).toBeInTheDocument();
    expect(screen.getByText(/O último registro não garante cobertura completa/)).toBeInTheDocument();
  });
  it("makes unavailable dates explicit instead of showing an invalid date or an assumed time",()=>{
    render(<ImportFreshnessSummary rows={[{...freshness[0],lastImportAt:null,lastRecordAt:null}]}/>);
    expect(screen.getByText('Nenhuma importação concluída')).toBeInTheDocument();
    expect(screen.getByText('Sem registro com data disponível')).toBeInTheDocument();
  });
});
