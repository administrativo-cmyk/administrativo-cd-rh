import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

// Synthetic SQL proof only; never connects to a hosted database.
const database = new PGlite();
const directory = resolve("supabase/migrations");
const migrationName = "20261019124718_monitoring_photo_insert_only.sql";
const photo = { sourceId: "insert-only-clock", identityValue: "12345678909", sha256: "a".repeat(64), mimeType: "image/jpeg", base64: "YWJj" };
let assertions = 0;
function equal(actual, expected) { assert.deepEqual(actual, expected); assertions++; }
async function asRole(role, operation) {
  await database.exec(`set role ${role}`);
  try { return await operation(); } finally { await database.exec("reset role"); }
}
async function ingest(payload, role = "service_role") {
  return (await asRole(role, () => database.query("select public.monitoring_ingest($1::jsonb) result", [JSON.stringify(payload)]))).rows[0].result;
}
async function snapshots() {
  return (await database.query("select source_id,identity_value,sha256,mime_type,base64,updated_at from public.monitoring_photos order by source_id,identity_value")).rows;
}
async function definition() {
  return (await database.query("select pg_get_functiondef('private.monitoring_ingest_impl(jsonb)'::regprocedure) body")).rows[0].body;
}
async function permissions() {
  return (await database.query(`select oid::text,prosecdef,proconfig,proacl::text from pg_proc
    where oid in ('private.monitoring_ingest_impl(jsonb)'::regprocedure,'public.monitoring_ingest(jsonb)'::regprocedure) order by oid`)).rows;
}
try {
  await database.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  const migrations = (await readdir(directory)).filter(file => file.endsWith(".sql")).sort();
  for (const migration of migrations.filter(file => file < migrationName)) await database.exec(await readFile(resolve(directory, migration), "utf8"));
  await database.exec(`insert into public.monitoring_sources(id,kind,identity_namespace) values
    ('insert-only-clock','afd','insert-only-clock'),('insert-only-defense','defense-person','insert-only-defense');`);
  await ingest({ photo: { ...photo, sourceId: "insert-only-defense" } });
  const before = await snapshots();
  const grantsBefore = await permissions();
  // The new envelope must fail safely even when a deployed API reaches old SQL.
  await assert.rejects(() => ingest({ photoInsertOnly: photo }), error => error.code === "23502"); assertions++;
  equal(await snapshots(), before);

  const migration = await readFile(resolve(directory, migrationName), "utf8");
  await database.exec(migration);
  equal(await permissions(), grantsBefore);
  const firstDefinition = await definition();
  await database.exec(migration);
  equal(await definition(), firstDefinition);
  equal(await permissions(), grantsBefore);
  equal(await snapshots(), before);

  equal(await ingest({ photoInsertOnly: photo }), { ok: true, insertOnly: true, status: "inserted", sha256: photo.sha256 });
  const inserted = await snapshots();
  equal(await ingest({ photoInsertOnly: photo }), { ok: true, insertOnly: true, status: "replayed", sha256: photo.sha256 });
  equal(await snapshots(), inserted); // Includes updated_at: a replay does not rewrite the image.
  await assert.rejects(() => ingest({ photoInsertOnly: { ...photo, sha256: "b".repeat(64), base64: "ZGVm" } }),
    error => error.code === "23505" && error.message === "PHOTO_ALREADY_EXISTS"); assertions++;
  equal(await snapshots(), inserted);
  equal((await snapshots()).filter(row => row.source_id === "insert-only-defense"), before);
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(() => ingest({ photoInsertOnly: photo }, role), error => error.code === "42501"); assertions++;
  }
  await assert.rejects(() => ingest({ photoInsertOnly: true }), error => error.code === "22023"); assertions++;
  equal(await snapshots(), inserted);
  await database.exec("update public.monitoring_sources set active=false where id='insert-only-clock'");
  await assert.rejects(() => ingest({ photoInsertOnly: photo }), error => error.message === "SOURCE_DISABLED"); assertions++;
  equal(await snapshots(), inserted);
  await database.exec("update public.monitoring_sources set active=true where id='insert-only-clock'");
  // Legacy callers may still deliberately update photos through the old envelope.
  equal(await ingest({ photo: { ...photo, sha256: "c".repeat(64), base64: "Z2hp" } }), { ok: true });
  equal((await snapshots()).find(row => row.source_id === photo.sourceId).sha256, "c".repeat(64));
  equal((await snapshots()).filter(row => row.source_id === "insert-only-defense"), before);
  console.log(JSON.stringify({ status: "ok", storage: "pglite-memory-only", migrations: migrations.filter(file => file <= migrationName).length,
    assertions, oldDatabaseFailsClosed: true, insertOnlyAtomic: true, sameHashReplayPreserved: true,
    differentHashRejected: true, defenseUntouched: true, legacyUpsertCompatible: true, permissionsUnchanged: true, idempotentMigration: true }));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", code: error.code ?? "ASSERTION_FAILED", message: error.message }));
  process.exitCode = 1;
} finally { await database.close(); }
