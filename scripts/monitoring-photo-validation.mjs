import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

// Disposable local SQL proof. No environment credentials or network clients.
const database = new PGlite();
try {
  await database.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  const migrations = (await readdir(resolve("supabase/migrations"))).filter((file) => file.endsWith(".sql")).sort();
  for (const migration of migrations) await database.exec(await readFile(resolve("supabase/migrations", migration), "utf8"));
  const roles = ["ADMIN", "RH", "GESTOR", "LEITURA", "ADMIN", "ADMIN"];
  const ids = roles.map((_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  for (const [index, id] of ids.entries()) {
    const cpf = String(index + 1).padStart(11, "0");
    await database.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,encode(sha256(convert_to($2,'UTF8')),'hex')||'@auth.administrativo-cd.invalid',$3::jsonb)`, [id, cpf, JSON.stringify({ nome_completo: "Perfil Sintético", cpf_normalizado: cpf })]);
    await database.query("update public.perfis set papel_usuario=$1::public.papel_usuario,status_usuario=$2::public.status_usuario,aprovado_em=case when $2='APROVADO' then now() else null end,bloqueado_em=case when $2='BLOQUEADO' then now() else null end,bloqueado_por=case when $2='BLOQUEADO' then $4::uuid else null end where id=$3", [index === 4 ? null : roles[index], index === 4 ? "PENDENTE" : index === 5 ? "BLOQUEADO" : "APROVADO", id, ids[0]]);
  }
  await database.exec(`insert into public.monitoring_sources(id,kind,identity_namespace) values
    ('synthetic-person','defense-person','synthetic-defense'),('synthetic-access','defense-access','synthetic-defense'),
    ('synthetic-other','defense-access','other-defense'),('synthetic-clock','afd','synthetic-defense');
    insert into public.monitoring_photos(source_id,identity_value,sha256,mime_type,base64)
    values('synthetic-person','000123',repeat('a',64),'image/jpeg','YWJj');`);
  async function asRole(role, userId, operation) {
    await database.query("select set_config('request.jwt.claim.sub',$1,false)", [userId ?? ""]);
    await database.exec(`set role ${role}`);
    try { return await operation(); }
    finally { await database.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
  }
  const preview = (source = "synthetic-person", identity = "000123") => database.query("select public.monitoring_identity_photo($1,$2) photo", [source, identity]);
  for (const id of ids.slice(0, 2)) {
    const result = await asRole("authenticated", id, () => preview());
    assert.equal(result.rows[0].photo.base64, "YWJj");
    assert.equal((await asRole("authenticated", id, () => preview("synthetic-access"))).rows[0].photo.base64, "YWJj");
    for (const source of ["synthetic-other", "synthetic-clock", "missing"]) assert.equal((await asRole("authenticated", id, () => preview(source))).rows[0].photo, null);
    assert.equal((await asRole("authenticated", id, () => preview("synthetic-person", "123"))).rows[0].photo, null);
    await assert.rejects(asRole("authenticated", id, () => database.exec("select * from public.monitoring_photos")));
  }
  for (const id of ids.slice(2)) await assert.rejects(asRole("authenticated", id, () => preview()), (error) => error.code === "42501");
  for (const role of ["anon", "service_role"]) await assert.rejects(asRole(role, null, () => preview()), (error) => error.code === "42501");
  assert.equal((await database.query("select count(*)::int total from public.monitoring_bindings")).rows[0].total, 0);
  console.log(JSON.stringify({ status: "ok", storage: "pglite-memory-only", migrations: migrations.length, allowedRoles: 2, deniedRolesOrStates: 6, namespaceIsolation: true, leadingZerosPreserved: true, bindingsCreated: 0 }));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", code: error.code ?? "ASSERTION_FAILED", message: error.message }));
  process.exitCode = 1;
} finally { await database.close(); }
