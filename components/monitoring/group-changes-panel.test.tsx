import { fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,describe,expect,it,vi } from "vitest";
import { GroupChangesPanel } from "./group-changes-panel";
const row={key:'defense-group:synthetic',namespace:'defense',external_id:'123',employee_id:'30000000-0000-4000-8000-000000000001',name:'Pessoa Sintética',employee_number:'123',old_groups:['TURNO 1'],new_groups:['TURNO 2'],variants:[['TURNO 2']],observed_at:'2026-10-19T20:00:00Z',detected_at:'2026-10-19T21:00:00Z',file_name:'Person20261019170000.xlsx',previous_file:'Person20261016160000.xlsx',source_id:'people',time_origin:'filename',status:'pending'};
const response=(rows:unknown[]=[row])=>new Response(JSON.stringify({rows,total:rows.length,pending:rows.length,checkedFiles:3,checkedAt:'2026-10-19T21:00:00Z'}));
afterEach(()=>{vi.unstubAllGlobals();});
describe('lista das mudanças de grupos',()=>{
 it('mostra anterior, novo e evidência; nunca aplica vigência durante leitura',async()=>{
  const fetch=vi.fn().mockResolvedValue(response());vi.stubGlobal('fetch',fetch);render(<GroupChangesPanel/>);
  expect(await screen.findByText('Pessoa Sintética')).toBeVisible();expect(screen.getByText('TURNO 1')).toBeVisible();expect(screen.getByText('TURNO 2')).toBeVisible();
  expect(screen.getByText('Person20261019170000.xlsx')).toBeVisible();expect(screen.getByText('Conferir data da mudança')).toBeVisible();expect(screen.getByText(/confirme a data real/i)).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][1]?.method).toBeUndefined();
 });
 it('reconsulta após conclusão da importação e informa quando não há mudanças',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response([]));vi.stubGlobal('fetch',fetch);
  const view=render(<GroupChangesPanel refreshKey={0}/>);await screen.findByText('Pessoa Sintética');view.rerender(<GroupChangesPanel refreshKey={1}/>);
  expect(await screen.findByText('Nenhuma mudança de grupo encontrada nos filtros.')).toBeVisible();expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('permite filtrar e consultar grupos confirmados',async()=>{
  const fetch=vi.fn().mockImplementation(()=>Promise.resolve(response()));vi.stubGlobal('fetch',fetch);render(<GroupChangesPanel/>);await screen.findByText('Pessoa Sintética');
  fireEvent.change(screen.getByLabelText('Nome ou matrícula'),{target:{value:'123'}});fireEvent.submit(screen.getByRole('form',{name:'Filtrar mudanças de grupos'}));
  await waitFor(()=>expect(fetch.mock.calls.at(-1)?.[0]).toContain('query=123'));
  fireEvent.click(screen.getByLabelText('Mostrar grupos já confirmados'));await waitFor(()=>expect(fetch.mock.calls.at(-1)?.[0]).toContain('includeConfirmed=true'));
 });
});
