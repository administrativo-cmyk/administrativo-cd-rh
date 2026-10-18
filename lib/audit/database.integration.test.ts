import { expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
it("auditoria SQL protege dados e mantém paginação e escopo", async () => {
 const db = new PGlite();
 try {
  await db.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
  for (const file of (await readdir(path.resolve("supabase/migrations"))).filter(name => name.endsWith(".sql")).sort()) await db.exec(await readFile(path.resolve("supabase/migrations", file), "utf8"));
  await db.exec(await readFile(path.resolve("supabase/tests/audit.sql"), "utf8"));
  expect((await db.query("select 1 as valid")).rows).toEqual([{ valid: 1 }]);
 } finally { await db.close(); }
}, 90000);
