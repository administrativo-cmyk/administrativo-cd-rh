import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

type Definition = { oid: number; signature: string; body: string; grants: string[] | null; settings: string[] | null; definer: boolean; volatility: string };
let db: PGlite;
let before: Definition[];
let after: Definition[];
let afterCorrection: Definition[];
let correction: string;
const correctionName = "20261017185924_monitoring_safeupdate_compat.sql";

// Mask literals/comments without altering punctuation positions. This inspects
// static DML, including WHERE inside a nested SET subquery versus the outer DML.
function maskLiterals(sql: string): string {
  return sql.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|\$([a-z_][a-z0-9_]*|)\$[\s\S]*?\$\1\$/gi, (value) => " ".repeat(value.length));
}
function unqualifiedDml(body: string): string[] {
  const source = maskLiterals(body);
  const starts = /\bupdate\s+(?:only\s+)?((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?[a-z_][a-z0-9_]*)?\s+set\b|\bdelete\s+from\s+((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)/gi;
  const unsafe: string[] = [];
  for (const start of source.matchAll(starts)) {
    const end = source.indexOf(";", start.index);
    const statement = source.slice(start.index + start[0].length, end < 0 ? undefined : end);
    let depth = 0;
    let hasOuterWhere = false;
    for (const token of statement.matchAll(/[()]|\bwhere\b/gi)) {
      if (token[0] === "(") depth++;
      else if (token[0] === ")") depth--;
      else if (depth === 0) hasOuterWhere = true;
    }
    if (!hasOuterWhere) unsafe.push(start[1] ?? start[2]);
  }
  return unsafe;
}
async function definitions() {
  return (await db.query<Definition>(`select p.oid,p.oid::regprocedure::text as signature,p.prosrc as body,p.proacl as grants,
    p.proconfig as settings,p.prosecdef as definer,p.provolatile as volatility
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private','chamada_privada') and p.prokind='f' order by p.oid`)).rows;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
  const directory = path.resolve("supabase/migrations");
  for (const name of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) {
    const sql = await readFile(path.join(directory, name), "utf8");
    if (name === correctionName) { before = await definitions(); correction = sql; }
    await db.exec(sql);
    if (name === correctionName) afterCorrection = await definitions();
  }
  after = await definitions();
}, 60_000);
afterAll(async () => { if (db) await db.close(); });

describe("compatibilidade estrutural com safeupdate sem desabilitar proteção", () => {
  it("distingue WHERE do UPDATE/DELETE de predicado presente apenas em subconsulta", () => {
    expect(unqualifiedDml("update private.x set n=(select count(*) from y where id=1);")).toEqual(["private.x"]);
    expect(unqualifiedDml("update private.x x set n=(select count(*) from y where id=1) where x.id=2;")).toEqual([]);
    expect(unqualifiedDml("delete from private.x;")).toEqual(["private.x"]);
    expect(unqualifiedDml("insert into x values(1) on conflict(id) do update set n=excluded.n;")).toEqual([]);
    expect(unqualifiedDml("raise exception 'UPDATE requires a WHERE clause'; -- delete from private.x;\n")).toEqual([]);
  });
  it("reproduz os dez comandos incompatíveis nas nove funções anteriores", () => {
    const affected = before.map((definition) => ({ definition, unsafe: unqualifiedDml(definition.body) })).filter((row) => row.unsafe.length);
    expect(affected).toHaveLength(9);
    expect(affected.flatMap((row) => row.unsafe)).toHaveLength(10);
    expect(new Set(affected.flatMap((row) => row.unsafe))).toEqual(new Set(["private.monitoring_revision", "private.daily_call_revision"]));
  });
  it("todas as funções ativas têm predicado externo real em UPDATE/DELETE", () => {
    const failures = after.flatMap((definition) => unqualifiedDml(definition.body).map((table) => `${definition.signature}: ${table}`));
    expect(failures).toEqual([]);
    for (const definition of after) expect(maskLiterals(definition.body)).not.toMatch(/\bwhere\s+(?:true\b|1\s*=\s*1\b)/i);
  });
  it("altera somente as dez cláusulas e preserva OIDs, ACLs, search_path e semântica", () => {
    // Only this migration promises nine unchanged signatures. Later features may
    // add or revise functions; the separate safety test still scans the final schema.
    const changed = afterCorrection.filter((definition) => before.find((old) => old.oid === definition.oid)?.body !== definition.body);
    expect(changed).toHaveLength(9);
    for (const definition of afterCorrection) {
      const old = before.find((candidate) => candidate.oid === definition.oid)!;
      expect(old).toBeDefined();
      expect({ ...definition, body: undefined }).toEqual({ ...old, body: undefined });
      const expected = old.body.replace(/update private\.(monitoring_revision|daily_call_revision) set (version=version\+1|results_version=results_version\+1);/g, "update private.$1 set $2 where id=true;");
      expect(definition.body).toBe(expected);
    }
    expect(correction).not.toMatch(/(?:set_config|disable|reset)\s*\(?\s*['"]?safeupdate/i);
  });
  it("rejeita aplicação repetida ou definição diferente, sem alterar funções", async () => {
    await expect(db.exec(correction)).rejects.toThrow("SAFEUPDATE_COMPAT_UNEXPECTED_DEFINITION");
    expect(await definitions()).toEqual(after);
  });
});
