import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it.each(["administrative", "administrative-users-settings"])("enforces %s contracts in isolated SQL", async (scenario) => {
  const database = new PGlite();
  try {
    await database.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    const directory = path.resolve("supabase/migrations");
    for (const file of (await readdir(directory)).filter(file => file.endsWith(".sql")).sort()) {
      try { await database.exec(await readFile(path.join(directory, file), "utf8")); }
      catch (error) { const diagnostic = error as Error & { position?: number; internalPosition?: number; where?: string }; throw new Error(`${file}: ${diagnostic.message}; position=${diagnostic.position}; internal=${diagnostic.internalPosition}; ${diagnostic.where ?? ""}`); }
    }
    await database.exec(await readFile(path.resolve(`supabase/tests/${scenario}.sql`), "utf8"));
    expect((await database.query<{ total: number }>("select count(*)::int total from public.ferias_planejamento")).rows[0].total).toBe(0);
  } finally { await database.close(); }
}, 30000);
