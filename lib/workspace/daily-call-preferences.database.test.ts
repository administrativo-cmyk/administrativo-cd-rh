import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import type { DailyCallPreferences } from "./contracts";

it("persiste preferências da Chamada apenas para dono aprovado, sem apagar outros campos ou configurações", async () => {
  const db = new PGlite();
  const user = (n: number) => `bd000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  try {
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    const directory = path.resolve("supabase/migrations");
    for (const file of (await readdir(directory)).filter(file => file.endsWith(".sql")).sort()) await db.exec(await readFile(path.join(directory, file), "utf8"));
    await db.exec(`insert into auth.users(id,email,raw_user_meta_data) select ('bd000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
      encode(sha256(convert_to('66666666'||lpad(i::text,3,'0'),'UTF8')),'hex')||'@auth.administrativo-cd.invalid',
      jsonb_build_object('nome_completo','Preferência sintética '||i,'cpf_normalizado','66666666'||lpad(i::text,3,'0')) from generate_series(1,5) i;
      update public.perfis set status_usuario='APROVADO',papel_usuario=case right(id::text,1) when '1' then 'ADMIN'::public.papel_usuario when '2' then 'GESTOR'::public.papel_usuario else 'LEITURA'::public.papel_usuario end,aprovado_em=now()
      where id::text like 'bd000000-%' and right(id::text,1)<>'5';
      update public.perfis set status_usuario='BLOQUEADO',bloqueado_em=now(),bloqueado_por='${user(1)}' where id='${user(4)}';
      set role authenticated;`);
    const asUser = (n: number) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [user(n)]);
    const rpc = async <T = DailyCallPreferences>(action: string, data: unknown) => (await db.query<{ result: T }>("select public.workspace($1,$2::jsonb) result", [action, JSON.stringify(data)])).rows[0].result;
    const save = async (n: number, patch: { viewMode?: "today" | "period"; columnsCollapsed?: boolean }) => {
      const latest = await rpc("daily_call_preferences", { expectedUserId: user(n) });
      return rpc("save_daily_call_preferences", { expectedUserId: user(n), expectedUpdatedAt: latest.updatedAt, ...patch });
    };
    await asUser(1);
    const general = await rpc<Record<string, unknown>>("save_preferences", { defaultDashboard: "monitoramento", compactTables: true, notificationsEnabled: false, expectedUpdatedAt: null });
    expect(await rpc("daily_call_preferences", { expectedUserId: user(1) })).toMatchObject({ userId: user(1), viewMode: "today", columnsCollapsed: false, updatedAt: null });
    await save(1, { viewMode: "period" });
    const collapsed = await save(1, { columnsCollapsed: true });
    expect(collapsed).toMatchObject({ viewMode: "period", columnsCollapsed: true });
    expect(collapsed.updatedAt).not.toBeNull();
    expect(await rpc("settings", {})).toEqual(general);
    await save(1, { viewMode: "today" });
    await expect(rpc("save_daily_call_preferences", { expectedUserId: user(1), expectedUpdatedAt: collapsed.updatedAt, viewMode: "period" })).rejects.toThrow("WORKSPACE_STALE");
    expect(await rpc("daily_call_preferences", { expectedUserId: user(1) })).toMatchObject({ viewMode: "today", columnsCollapsed: true });
    for (const n of [2, 3]) {
      await asUser(n);
      expect(await rpc("daily_call_preferences", { expectedUserId: user(n) })).toMatchObject({ viewMode: "today", columnsCollapsed: false });
      await expect(rpc("daily_call_preferences", { expectedUserId: user(1) })).rejects.toThrow("WORKSPACE_FORBIDDEN");
      await expect(rpc("save_daily_call_preferences", { expectedUserId: user(1), columnsCollapsed: false })).rejects.toThrow("WORKSPACE_FORBIDDEN");
      expect(await save(n, { viewMode: "period" })).toMatchObject({ userId: user(n), viewMode: "period", columnsCollapsed: false });
    }
    await asUser(1);
    expect(await rpc("daily_call_preferences", { expectedUserId: user(1) })).toMatchObject({ viewMode: "today", columnsCollapsed: true });
    for (const data of [{}, { viewMode: null }, { viewMode: "month" }, { columnsCollapsed: "true" }, { columnsCollapsed: null }, { viewMode: "period", userId: user(2) }]) {
      await expect(rpc("save_daily_call_preferences", { expectedUserId: user(1), expectedUpdatedAt: null, ...data })).rejects.toThrow("WORKSPACE_INVALID_INPUT");
    }
    await expect(db.query("select * from private.workspace_daily_call_preferences")).rejects.toThrow(/permission denied/);
    for (const n of [4, 5]) {
      await asUser(n);
      await expect(rpc("daily_call_preferences", { expectedUserId: user(n) })).rejects.toThrow("WORKSPACE_FORBIDDEN");
      await expect(rpc("save_daily_call_preferences", { expectedUserId: user(n), viewMode: "period" })).rejects.toThrow("WORKSPACE_FORBIDDEN");
    }
    await db.exec("reset role");
    const guards = await db.query<{ anonymous: boolean; helper: boolean; rls: boolean }>(`select
      has_function_privilege('anon','public.workspace(text,jsonb)','execute') anonymous,
      has_function_privilege('authenticated','private.workspace_before_daily_call_preferences(text,jsonb)','execute') helper,
      (select relrowsecurity from pg_class where oid='private.workspace_daily_call_preferences'::regclass) rls`);
    expect(guards.rows[0]).toEqual({ anonymous: false, helper: false, rls: true });
  } finally { await db.close(); }
}, 40000);
