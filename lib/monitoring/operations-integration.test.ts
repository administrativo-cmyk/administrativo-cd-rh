import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { it, expect } from "vitest";
it("revises identities and sources and confirms reviewed imports without duplicate financial writes", async () => {
  const database = new PGlite();
  try {
    await database.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
      create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
    const directory = path.resolve("supabase/migrations");
    for (const file of (await readdir(directory)).filter(file => file.endsWith(".sql")).sort()) await database.exec(await readFile(path.join(directory, file), "utf8"));
    await database.exec(await readFile(path.resolve("supabase/tests/monitoring-operations.sql"), "utf8"));
    expect((await database.query<{ count: number }>("select count(*)::int count from private.operational_import_batches")).rows[0].count).toBe(0);
  } finally { await database.close(); }
}, 30000);
