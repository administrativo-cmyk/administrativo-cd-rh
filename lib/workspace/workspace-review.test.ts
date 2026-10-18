import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NotificationSnapshot, NoticeSnapshot, WorkspaceSettings } from "./contracts";

const user = (index: number) => `cb000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const unit = "cb100000-0000-4000-8000-000000000001";
const managerA = "cb200000-0000-4000-8000-000000000001";
const managerB = "cb200000-0000-4000-8000-000000000002";
const employee = "cb300000-0000-4000-8000-000000000001";
let db: PGlite;
async function asUser(index: number) { await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user(index)]); }
async function workspace<T = Record<string, unknown>>(action: string, data: unknown = {}): Promise<T> {
  return (await db.query<{ result: T }>("select public.workspace($1,$2::jsonb) result", [action, JSON.stringify(data)])).rows[0].result;
}
async function administration(action: string, data: unknown): Promise<{ id: string; updatedAt: string }> {
  return (await db.query<{ result: { record: { id: string; updatedAt: string } } }>("select public.administration('vacation',$1,$2::jsonb) result", [action, JSON.stringify(data)])).rows[0].result.record;
}
const vacationData = { employeeId: employee, startDate: "2026-11-01", endDate: "2026-11-10", acquisitionStart: null, acquisitionEnd: null, status: "requested", observation: null, reason: "Planejamento sintético de teste" };
const noticeData = { title: "Aviso sintético de equipe", body: "Conteúdo para testar isolamento", audienceRole: null, managerId: managerA, reason: "Revisão sintética" };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  const directory = path.resolve("supabase/migrations");
  for (const file of (await readdir(directory)).filter(file => file.endsWith(".sql")).sort()) await db.exec(await readFile(path.join(directory, file), "utf8"));
  await db.exec(`insert into public.unidades(id,codigo,nome) values('${unit}','WORKSPACE-REVIEW','Unidade sintética');
    insert into public.gestores(id,nome,unidade_referencia_id) values('${managerA}','Equipe sintética A','${unit}'),('${managerB}','Equipe sintética B','${unit}');
    insert into public.colaboradores(id,matricula,nome,unidade_id,gestor_id) values('${employee}','WORKSPACE-REVIEW','Colaborador sintético','${unit}','${managerA}');
    insert into auth.users(id,email,raw_user_meta_data) select ('cb000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
      encode(sha256(convert_to('88888888'||lpad(i::text,3,'0'),'UTF8')),'hex')||'@auth.administrativo-cd.invalid',
      jsonb_build_object('nome_completo','Revisão sintética '||i,'cpf_normalizado','88888888'||lpad(i::text,3,'0')) from generate_series(1,7) i;
    update public.perfis set status_usuario='APROVADO',papel_usuario=case right(id::text,1) when '1' then 'ADMIN'::public.papel_usuario when '2' then 'RH'::public.papel_usuario when '3' then 'GESTOR'::public.papel_usuario when '4' then 'GESTOR'::public.papel_usuario when '5' then 'GESTOR'::public.papel_usuario else 'LEITURA'::public.papel_usuario end,
      gestor_id=case right(id::text,1) when '3' then '${managerA}'::uuid when '4' then '${managerB}'::uuid when '5' then '${managerA}'::uuid end,aprovado_em=now()
      where id::text like 'cb000000-%' and right(id::text,1)<>'7';
    set role authenticated;`);
}, 40000);
afterAll(async () => { await db?.close(); });

describe("revisão independente do workspace em SQL isolado", () => {
  it("férias solicitadas chegam ao ADMIN/RH; decisões somente ao criador e revisões mudam a chave", async () => {
    await asUser(3);
    const requested = await administration("save", vacationData);
    const find = async () => (await workspace<NotificationSnapshot>("notifications")).rows.filter(row => row.key.startsWith(`vacation:${requested.id}:`));
    expect(await find()).toHaveLength(0);
    await asUser(1); expect((await find())[0].title).toBe("Férias aguardam análise");
    await asUser(2); expect(await find()).toHaveLength(1);
    await asUser(4); expect(await find()).toHaveLength(0);
    await asUser(5); expect(await find()).toHaveLength(0);
    await asUser(1);
    const approved = await administration("save", { ...vacationData, id: requested.id, expectedUpdatedAt: requested.updatedAt, status: "approved" });
    expect(await find()).toHaveLength(0);
    await asUser(2); expect(await find()).toHaveLength(0);
    await asUser(5); expect(await find()).toHaveLength(0);
    await asUser(3);
    const firstDecision = (await find())[0];
    expect(firstDecision.title).toBe("Férias aprovadas");
    await workspace("notification_state", { key: firstDecision.key, read: true, archived: true });
    expect(await find()).toHaveLength(0);
    await asUser(1);
    const cancelled = await administration("save", { ...vacationData, id: requested.id, expectedUpdatedAt: approved.updatedAt, status: "cancelled" });
    await asUser(3);
    const revisedDecision = (await find())[0];
    expect(revisedDecision.title).toBe("Planejamento de férias cancelado");
    expect(revisedDecision.key).not.toBe(firstDecision.key);
    expect(revisedDecision.readAt).toBeNull();
    await expect(workspace("notification_state", { key: firstDecision.key, read: false, archived: false })).rejects.toThrow("WORKSPACE_NOT_FOUND");
    await asUser(1);
    const archived = await administration("archive", { id: requested.id, expectedUpdatedAt: cancelled.updatedAt, reason: "Arquivamento sintético" });
    await asUser(3); expect(await find()).toHaveLength(0);
    await asUser(1);
    await administration("restore", { id: requested.id, expectedUpdatedAt: archived.updatedAt, reason: "Restauração sintética" });
    await asUser(3);
    const restoredDecision = (await find())[0]; expect(restoredDecision.key).not.toBe(revisedDecision.key);
    // Transfer the employee using fixture authority, then prove the old manager cannot read or acknowledge the notification.
    await db.exec(`reset role; update public.colaboradores set gestor_id='${managerB}' where id='${employee}'; set role authenticated;`);
    await asUser(3); expect(await find()).toHaveLength(0);
    await expect(workspace("notification_state", { key: restoredDecision.key, read: true, archived: false })).rejects.toThrow("WORKSPACE_NOT_FOUND");
    await asUser(4); expect(await find()).toHaveLength(0);
  });

  it("aviso dirigido a gestor não chega a outra equipe; arquivar/restaurar gera nova versão", async () => {
    await asUser(1);
    const notice = await workspace<{ id: string; updatedAt: string }>("save_notice", noticeData);
    const find = async () => (await workspace<NotificationSnapshot>("notifications")).rows.filter(row => row.key.startsWith(`notice:${notice.id}:`));
    await asUser(3); const first = (await find())[0]; expect(first).toBeDefined();
    await asUser(5); expect(await find()).toHaveLength(1);
    await asUser(4); expect(await find()).toHaveLength(0);
    await expect(workspace("notification_state", { key: first.key, read: true, archived: false })).rejects.toThrow("WORKSPACE_NOT_FOUND");
    await asUser(1);
    const archived = await workspace<{ id: string; updatedAt: string }>("archive_notice", { id: notice.id, expectedUpdatedAt: notice.updatedAt, reason: "Arquivamento sintético" });
    await asUser(3); expect(await find()).toHaveLength(0);
    await asUser(1);
    await expect(workspace("restore_notice", { id: notice.id, expectedUpdatedAt: notice.updatedAt, reason: "Restauração sintética" })).rejects.toThrow("WORKSPACE_STALE");
    await workspace("restore_notice", { id: notice.id, expectedUpdatedAt: archived.updatedAt, reason: "Restauração sintética" });
    await asUser(3);
    const restored = (await find())[0]; expect(restored.key).not.toBe(first.key); expect(restored.readAt).toBeNull();
  });

  it("impede consultar avisos ou escrever estado sem autorização após bloqueio", async () => {
    await asUser(1);
    const restricted = await workspace<{ id: string }>("save_notice", { ...noticeData, title: "Aviso administrativo", audienceRole: "ADMIN", managerId: null });
    await asUser(2);
    expect((await workspace<NoticeSnapshot>("notices", { includeArchived: true })).rows.some(row => row.id === restricted.id)).toBe(false);
    await asUser(6); await expect(workspace("notices")).rejects.toThrow("WORKSPACE_FORBIDDEN");
    await asUser(7); await expect(workspace("notification_summary")).rejects.toThrow("WORKSPACE_FORBIDDEN");
    await db.exec(`reset role; update public.perfis set status_usuario='BLOQUEADO',bloqueado_em=clock_timestamp(),bloqueado_por='${user(1)}' where id='${user(6)}'; set role authenticated;`);
    await asUser(6); await expect(workspace("settings")).rejects.toThrow("WORKSPACE_FORBIDDEN");
    await expect(workspace("notification_state", { key: "forged", read: true, archived: false })).rejects.toThrow("WORKSPACE_FORBIDDEN");
  });

  it("reset conserva geração de CAS e recusa um rascunho da ausência inicial", async () => {
    await asUser(4);
    const initial = await workspace<WorkspaceSettings>("settings"); expect(initial.updatedAt).toBeNull();
    const saved = await workspace<WorkspaceSettings>("save_preferences", { defaultDashboard: "monitoramento", compactTables: true, notificationsEnabled: false, expectedUpdatedAt: initial.updatedAt });
    const reset = await workspace<WorkspaceSettings>("reset_preferences", { expectedUpdatedAt: saved.updatedAt });
    expect(reset.defaultDashboard).toBe("index");
    await expect(workspace("save_preferences", { defaultDashboard: "banco-de-horas", compactTables: false, notificationsEnabled: true, expectedUpdatedAt: initial.updatedAt })).rejects.toThrow("WORKSPACE_STALE");
  });

  it("edição pessoal ignora alvo e papel forjados mesmo por RPC direto", async () => {
    await asUser(5);
    const initial = await workspace<WorkspaceSettings>("settings");
    await workspace("save_profile", { id: user(1), userId: user(1), papel_usuario: "ADMIN", role: "ADMIN", name: "Nome próprio revisado", expectedUpdatedAt: initial.profileUpdatedAt });
    expect((await workspace<WorkspaceSettings>("settings")).profileName).toBe("Nome próprio revisado");
    const own = await db.query<{ papel_usuario: string }>("select papel_usuario from public.perfis where id=$1", [user(5)]);
    expect(own.rows[0].papel_usuario).toBe("GESTOR");
    await asUser(1);
    expect((await workspace<WorkspaceSettings>("settings")).profileName).toBe("Revisão sintética 1");
  });
});
