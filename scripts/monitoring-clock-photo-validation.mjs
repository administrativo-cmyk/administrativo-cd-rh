import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

// Disposable SQL regression proof: no credentials, real personal data or network.
const database = new PGlite();
const directory = resolve("supabase/migrations");
const migrationName = "20261019123855_monitoring_clock_photo_fallback.sql";
const id = (group, value) => `${group}0000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const users = { admin: id(1, 1), rh: id(1, 2), reader: id(1, 3), manager: id(1, 4), pending: id(1, 5), blocked: id(1, 6) };
const employees = { target: id(3, 1), outside: id(3, 2), namespace: id(3, 3), pis: id(3, 4), mixed: id(3, 5), leading: id(3, 6) };
const manager = id(2, 1);
const cpf = "12345678909";
const leadingCpf = "01234567890";
const sha = { clock: "a".repeat(64), defense: "b".repeat(64), other: "c".repeat(64), replaced: "d".repeat(64) };
let assertions = 0;
function equal(actual, expected) { assert.deepEqual(actual, expected); assertions++; }
async function denied(operation) {
  await assert.rejects(operation, (error) => error.code === "42501"); assertions++;
}
async function asRole(role, userId, operation) {
  await database.query("select set_config('request.jwt.claim.sub',$1,false)", [userId ?? ""]);
  await database.exec(`set role ${role}`);
  try { return await operation(); }
  finally { await database.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
}
async function queryPhoto(userId, employee = employees.target, action = "photo") {
  const result = await asRole("authenticated", userId, () => database.query(
    "select public.monitoring_query($1,$2::jsonb) photo", [action, JSON.stringify({ employeeId: employee })],
  ));
  return result.rows[0].photo;
}
async function ingestPhoto(sourceId, identityValue, digest) {
  return asRole("service_role", null, () => database.query("select public.monitoring_ingest($1::jsonb)", [JSON.stringify({
    photo: { sourceId, identityValue, sha256: digest, mimeType: "image/png", base64: "YWJj" },
  })]));
}
async function bind(source, type, value, employee, validFrom = "2000-01-01", validTo = null) {
  const result = await database.query(`insert into public.monitoring_bindings
    (source_id,identity_type,identity_value,employee_id,valid_from,valid_to,evidence,created_by)
    values($1,$2,$3,$4,$5,$6,'Synthetic reviewed identity for local SQL validation',$7) returning id`,
  [source, type, value, employee, validFrom, validTo, users.admin]);
  return result.rows[0].id;
}

try {
  await database.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  const migrations = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const migration of migrations) await database.exec(await readFile(resolve(directory, migration), "utf8"));
  const definitionBefore = (await database.query("select pg_get_functiondef('private.monitoring_query_impl(text,jsonb)'::regprocedure) body")).rows[0].body;
  await database.exec(await readFile(resolve(directory, migrationName), "utf8"));
  equal((await database.query("select pg_get_functiondef('private.monitoring_query_impl(text,jsonb)'::regprocedure) body")).rows[0].body, definitionBefore);

  await database.query("insert into public.gestores(id,nome) values($1,'Synthetic manager')", [manager]);
  const roles = ["ADMIN", "RH", "LEITURA", "GESTOR", null, "ADMIN"];
  for (const [index, userId] of Object.values(users).entries()) {
    const userCpf = String(index + 1).padStart(11, "0");
    await database.query(`insert into auth.users(id,email,raw_user_meta_data)
      values($1,encode(sha256(convert_to($2,'UTF8')),'hex')||'@auth.administrativo-cd.invalid',$3::jsonb)`,
    [userId, userCpf, JSON.stringify({ nome_completo: "Synthetic profile", cpf_normalizado: userCpf })]);
    const status = index === 4 ? "PENDENTE" : index === 5 ? "BLOQUEADO" : "APROVADO";
    await database.query(`update public.perfis set papel_usuario=$1::public.papel_usuario,status_usuario=$2::public.status_usuario,
      gestor_id=$3,aprovado_em=case when $2='APROVADO' then now() else null end,
      bloqueado_em=case when $2='BLOQUEADO' then now() else null end,bloqueado_por=case when $2='BLOQUEADO' then $4::uuid else null end where id=$5`,
    [roles[index], status, index === 3 ? manager : null, users.admin, userId]);
  }
  for (const [key, employee] of Object.entries(employees)) {
    await database.query(`insert into public.colaboradores(id,matricula,nome,unidade_id,gestor_id)
      values($1,$2,$3,(select id from public.unidades where codigo='CD I'),$4)`,
    [employee, `synthetic-${key}`, `Synthetic ${key}`, key === "target" ? manager : null]);
  }
  await database.exec(`insert into public.monitoring_sources(id,kind,identity_namespace) values
    ('photo-defense','defense-person','photo-defense-ns'),('photo-access','defense-access','photo-defense-ns'),
    ('photo-clock','afd','photo-clock-ns'),('photo-clock-peer','afd','photo-clock-ns'),
    ('photo-other-clock','afd','photo-other-clock-ns'),('photo-missing-clock','afd','photo-missing-clock-ns'),
    ('photo-pis-clock','afd','photo-pis-ns'),('photo-afd-in-defense-ns','afd','photo-defense-ns'),
    ('photo-defense-in-clock-ns','defense-person','photo-clock-ns');`);

  await bind("photo-clock", "cpf", cpf, employees.target);
  await ingestPhoto("photo-clock-peer", cpf, sha.clock);
  await ingestPhoto("photo-other-clock", cpf, sha.other);
  equal((await queryPhoto(users.admin)).sha256, sha.clock); // Shared namespace works; another namespace cannot override it.
  const defenseBinding = await bind("photo-access", "defense", "000123", employees.target);
  equal((await queryPhoto(users.admin)).sha256, sha.clock); // A Defense binding without bytes still allows CPF fallback.
  await ingestPhoto("photo-defense", "000123", sha.defense);
  await database.exec("update public.monitoring_photos set updated_at=now()-interval '1 day' where source_id='photo-defense'");
  await ingestPhoto("photo-clock-peer", cpf, sha.replaced);
  for (const userId of [users.admin, users.rh, users.reader, users.manager]) equal((await queryPhoto(userId)).sha256, sha.defense);
  equal((await database.query("select sha256 from public.monitoring_photos where source_id='photo-defense' and identity_value='000123'")).rows[0].sha256, sha.defense);
  await database.query("update public.monitoring_bindings set revoked_at=now() where id=$1", [defenseBinding]);
  equal((await queryPhoto(users.admin)).sha256, sha.replaced);
  await database.query("update public.monitoring_bindings set revoked_at=null,valid_from=current_date+2 where id=$1", [defenseBinding]);
  equal((await queryPhoto(users.admin)).sha256, sha.replaced);
  await database.query("update public.monitoring_bindings set valid_from=current_date-3,valid_to=current_date-2 where id=$1", [defenseBinding]);
  equal((await queryPhoto(users.admin)).sha256, sha.replaced);
  await database.query("update public.monitoring_bindings set valid_from='2000-01-01',valid_to=null where id=$1", [defenseBinding]);

  // CPF images cannot be guessed from a PIS, a Defense identifier or another namespace.
  await bind("photo-missing-clock", "cpf", cpf, employees.namespace);
  equal(await queryPhoto(users.admin, employees.namespace), null);
  await bind("photo-pis-clock", "pis", cpf, employees.pis);
  await ingestPhoto("photo-pis-clock", cpf, sha.other);
  equal(await queryPhoto(users.admin, employees.pis), null);
  await bind("photo-access", "defense", "01234567890", employees.mixed);
  await ingestPhoto("photo-afd-in-defense-ns", "01234567890", sha.other);
  equal(await queryPhoto(users.admin, employees.mixed), null);
  await bind("photo-clock", "cpf", leadingCpf, employees.leading);
  await ingestPhoto("photo-defense-in-clock-ns", leadingCpf, sha.other);
  equal(await queryPhoto(users.admin, employees.leading), null);
  await ingestPhoto("photo-clock", leadingCpf, sha.clock);
  equal((await queryPhoto(users.admin, employees.leading)).sha256, sha.clock);
  await bind("photo-clock", "cpf", "11144477735", employees.outside);
  await ingestPhoto("photo-clock", "11144477735", sha.clock);

  // Preserve employee-scope authorization and the narrowly allowed own-profile lookup.
  await denied(() => queryPhoto(users.manager, employees.outside));
  equal(await queryPhoto(users.manager, employees.outside, "my_photo"), null);
  const userLink = (await database.query(`insert into public.monitoring_settings(kind,target,valid_from,payload,reason,created_by)
    values('user_link',$1,'2000-01-01',$2::jsonb,'Synthetic reviewed own profile link',$3) returning id`,
  [employees.outside, JSON.stringify({ userId: users.manager }), users.admin])).rows[0].id;
  equal((await queryPhoto(users.manager, employees.outside, "my_photo")).sha256, sha.clock);
  await denied(() => queryPhoto(users.manager, employees.outside));
  await database.query("update public.monitoring_settings set revoked_at=now() where id=$1", [userLink]);
  equal(await queryPhoto(users.manager, employees.outside, "my_photo"), null);
  for (const userId of [users.pending, users.blocked]) {
    await denied(() => queryPhoto(userId));
    await denied(() => queryPhoto(userId, employees.target, "my_photo"));
  }
  for (const role of ["anon", "service_role"]) {
    await denied(() => asRole(role, null, () => database.query("select public.monitoring_query('photo',$1::jsonb)", [JSON.stringify({ employeeId: employees.target })])));
  }
  for (const role of ["anon", "authenticated", "service_role"]) {
    await denied(() => asRole(role, role === "authenticated" ? users.admin : null, () => database.query("select private.monitoring_employee_photo($1)", [employees.target])));
    await denied(() => asRole(role, role === "authenticated" ? users.admin : null, () => database.exec("select * from public.monitoring_photos")));
  }
  // Identity review stays Defense-only, so an unbound CPF does not become public preview.
  equal((await asRole("authenticated", users.admin, () => database.query("select public.monitoring_identity_photo('photo-clock',$1) photo", [cpf]))).rows[0].photo, null);
  console.log(JSON.stringify({ status: "ok", storage: "pglite-memory-only", migrations: migrations.length, assertions,
    defensePriority: true, cpfFallback: true, namespaceIsolation: true, typedIdentityIsolation: true,
    leadingZerosPreserved: true, bindingValidity: true, authorizedRolesOnly: true, ownProfileScopePreserved: true,
    privateHelperNotExposed: true, idempotentMigration: true }));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", code: error.code ?? "ASSERTION_FAILED", message: error.message }));
  process.exitCode = 1;
} finally { await database.close(); }
