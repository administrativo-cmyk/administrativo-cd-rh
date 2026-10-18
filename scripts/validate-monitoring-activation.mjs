import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

// Rehearse the exact reviewed transaction against the verified legacy baseline.
// No environment credentials, network connection or production data are used.
const root = process.cwd();
const directory = path.join(root, "supabase/migrations");
const manifest = JSON.parse(await readFile(path.join(root, ".monitoring-worker/activation/manifest.json"), "utf8"));
const sql = await readFile(path.join(root, ".monitoring-worker/activation/schema.sql"), "utf8");
const database = new PGlite();
try {
  await database.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(), email text unique, raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);`);
  const previous = (await readdir(directory)).filter((file) => /^\d{14}_.*\.sql$/.test(file) && file.slice(0, 14) <= manifest.previousMigration).sort();
  assert.equal(previous.length, manifest.previousCount);
  for (const file of previous) {
    const source = await readFile(path.join(directory, file), "utf8");
    await database.exec(source);
    await database.query("insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)", [file.slice(0, 14), file.slice(15, -4), [source]]);
  }
  for (const migration of manifest.migrations) {
    const source = await readFile(path.join(directory, migration.file), "utf8");
    assert.equal(createHash("sha256").update(source).digest("hex"), migration.sha256, `${migration.file} changed after preparation`);
  }
  await database.exec(sql);
  const applied = (await database.query("select version from supabase_migrations.schema_migrations order by version")).rows;
  assert.equal(applied.length, manifest.previousCount + manifest.migrations.length);
  assert.equal((await database.query("select to_regprocedure('public.daily_call_workflow(text,jsonb)')::text rpc")).rows[0].rpc, "daily_call_workflow(text,jsonb)");
  assert.equal((await database.query("select count(*)::int total from public.chamada_diaria")).rows[0].total, 0);
  assert.equal((await database.query("select count(*)::int total from public.monitoring_events")).rows[0].total, 0);
  await assert.rejects(database.exec(sql), /MIGRATION_BASE_CHANGED/);
  await database.exec("rollback");
  assert.equal((await database.query("select count(*)::int total from supabase_migrations.schema_migrations")).rows[0].total, applied.length);
  console.log(JSON.stringify({ storage: "pglite-memory-only", previousMigrations: previous.length, pendingMigrations: manifest.migrations.length, appliedMigrations: applied.length, exactBundlePassed: true, repeatedOrChangedBaseRejected: true, recordsImported: 0, remoteApplied: false }, null, 2));
} finally {
  await database.close();
}
