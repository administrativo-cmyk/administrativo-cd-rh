import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

// Rehearses the exact prepared transaction in memory. No env files, credentials,
// network connections, production data or modifications to either package.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "supabase", "migrations");
const packageDirectory = path.join(root, ".monitoring-worker", "activation-system-20261018");
const manifestPath = path.join(packageDirectory, "manifest.json");
const schemaPath = path.join(packageDirectory, "schema.sql");
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const schemaBytes = await readFile(schemaPath);
const sql = schemaBytes.toString("utf8");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const identifier = value => `"${value.replaceAll('"', '""')}"`;
const startedAt = performance.now();
const watchdog = setTimeout(() => {
  console.error("SYSTEM_ACTIVATION_REHEARSAL_TIMEOUT: disposable PGlite exceeded 60 seconds");
  process.exit(1);
}, 60_000);
watchdog.unref();

assert.equal(manifest.project, "kqgtnucqxqqgwdyvhvdd", "Unexpected package target");
assert.equal(typeof manifest.applied, "boolean", "Invalid package state");
assert.equal(sha256(schemaBytes), manifest.schemaSha256, "Prepared SQL digest differs from manifest");
assert.equal(manifest.previousVersions.length, 22, "Expected the reviewed 22-migration baseline");
assert.equal(manifest.migrations.length, 4, "Expected four reviewed pending migrations");
const localFiles = (await readdir(directory)).filter(file => /^\d{14}_[a-z0-9_]+\.sql$/.test(file)).sort();
const baseline = localFiles.filter(file => file.slice(0, 14) <= "20261017185924");
assert.deepEqual(baseline.map(file => file.slice(0, 14)), manifest.previousVersions);
assert.deepEqual(localFiles.filter(file => file.slice(0, 14) > "20261017185924"), manifest.migrations.map(migration => migration.file));
for (const migration of manifest.migrations) {
  assert.equal(migration.file, `${migration.version}_${migration.name}.sql`);
  assert.equal(sha256(await readFile(path.join(directory, migration.file))), migration.sha256, `${migration.file} changed after preparation`);
}

const database = new PGlite();
async function tableSpecifications() {
  return (await database.query(`select n.nspname schema_name,c.relname table_name,array_agg(a.attname order by a.attnum) columns
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    where n.nspname in ('public','private','chamada_privada','auth') and c.relkind='r' and a.attnum>0 and not a.attisdropped
    group by n.nspname,c.relname order by n.nspname,c.relname`)).rows;
}
async function dataFingerprint(specifications) {
  const result = [];
  for (const table of specifications) {
    const relation = `${identifier(table.schema_name)}.${identifier(table.table_name)}`;
    const columns = table.columns.map(identifier).join(",");
    const rows = (await database.query(`select to_jsonb(record) row from (select ${columns} from ${relation}) record order by to_jsonb(record)::text`)).rows;
    result.push({ relation, rows });
  }
  return sha256(JSON.stringify(result));
}
async function schemaFingerprint() {
  const functions = (await database.query(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,
    pg_get_functiondef(p.oid) definition,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private','chamada_privada','auth') and p.prokind='f' order by n.nspname,p.proname,arguments`)).rows;
  const tables = (await database.query(`select n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl,
    case when c.relkind='v' then pg_get_viewdef(c.oid,true) else null end definition
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','chamada_privada','auth') and c.relkind in ('r','v','S') order by n.nspname,c.relname`)).rows;
  const indexes = (await database.query(`select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname in ('public','private','chamada_privada','auth') order by schemaname,tablename,indexname`)).rows;
  const triggers = (await database.query(`select n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid,true) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','private','chamada_privada','auth') order by n.nspname,c.relname,t.tgname`)).rows;
  const constraints = (await database.query(`select n.nspname,c.relname,con.conname,pg_get_constraintdef(con.oid,true) definition from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','chamada_privada','auth') order by n.nspname,c.relname,con.conname`)).rows;
  const columns = (await database.query(`select table_schema,table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_name from information_schema.columns where table_schema in ('public','private','chamada_privada','auth') order by table_schema,table_name,ordinal_position`)).rows;
  const migrations = (await database.query("select version,name,statements from supabase_migrations.schema_migrations order by version")).rows;
  return sha256(JSON.stringify({ functions, tables, indexes, triggers, constraints, columns, migrations }));
}

try {
  await database.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text);`);
  for (const file of baseline) {
    const source = await readFile(path.join(directory, file), "utf8");
    await database.exec(source);
    await database.query("insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)", [file.slice(0, 14), file.slice(15, -4), [source]]);
  }
  // Explicit synthetic records prove schema activation preserves existing operational data.
  await database.exec(`insert into auth.users(id,email,raw_user_meta_data)
    select ('fd000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
      encode(sha256(convert_to('66666666'||lpad(i::text,3,'0'),'UTF8')),'hex')||'@auth.administrativo-cd.invalid',
      jsonb_build_object('nome_completo','Synthetic package actor '||i,'cpf_normalizado','66666666'||lpad(i::text,3,'0')) from generate_series(1,2) i;
    update public.perfis set status_usuario='APROVADO',papel_usuario=case when right(id::text,1)='1' then 'ADMIN'::public.papel_usuario else 'RH'::public.papel_usuario end,aprovado_em=now() where id::text like 'fd000000-%';
    insert into public.colaboradores(id,matricula,nome,unidade_id) select ('fc000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'PKG-000'||i,'Synthetic package employee '||i,(select id from public.unidades where codigo='CD I') from generate_series(1,2) i;
    insert into public.banco_horas_medicoes(colaborador_id,data_medicao,aplica_a_partir_de,jornada_horas_dia,saldo_minutos,origem)
      values ('fc000000-0000-4000-8000-000000000001','2026-10-01','2026-10-01',8,480,'Synthetic activation fixture'),('fc000000-0000-4000-8000-000000000002','2026-10-01','2026-10-01',8,-960,'Synthetic activation fixture');
    insert into public.chamada_diaria(colaborador_id,data,status,observacao) values('fc000000-0000-4000-8000-000000000001','2026-10-02','P','Synthetic activation fixture');`);
  const baselineSpecifications = await tableSpecifications();
  const beforeData = await dataFingerprint(baselineSpecifications);
  const setupMs = Math.round(performance.now() - startedAt);
  const applicationStartedAt = performance.now();
  await database.exec(sql);
  const applicationMs = Math.round(performance.now() - applicationStartedAt);
  assert.equal(await dataFingerprint(baselineSpecifications), beforeData, "Activation changed existing row values");
  const expectedVersions = [...manifest.previousVersions, ...manifest.migrations.map(migration => migration.version)];
  const appliedVersions = (await database.query("select version from supabase_migrations.schema_migrations order by version")).rows.map(row => row.version);
  assert.deepEqual(appliedVersions, expectedVersions);
  assert.equal(appliedVersions.length, 26);
  const wrappers = ["public.administration(text,text,jsonb)", "public.workspace(text,jsonb)", "public.administration_users(text,jsonb)", "public.monitoring_setting_change(text,jsonb)", "public.time_bank_admin(text,jsonb)"];
  for (const wrapper of wrappers) {
    const permissions = (await database.query(`select p.prosecdef,has_function_privilege('authenticated',p.oid,'execute') authenticated,
      has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('service_role',p.oid,'execute') service_role
      from pg_proc p where p.oid=to_regprocedure($1)`, [wrapper])).rows;
    assert.equal(permissions.length, 1, `${wrapper} absent`);
    assert.deepEqual(permissions[0], { prosecdef: false, authenticated: true, anon: false, service_role: false }, `${wrapper} permissions`);
  }
  const protectedTables = ["public.ferias_planejamento", "private.administration_audit", "private.user_edit_audit", "private.workspace_preferences", "private.workspace_notices", "private.workspace_notification_state", "private.workspace_audit", "private.time_bank_measurement_audit", "public.banco_horas_medicoes", "public.monitoring_settings"];
  for (const table of protectedTables) {
    const security = (await database.query(`select c.relrowsecurity,
      has_table_privilege('anon',c.oid,'select,insert,update,delete') anon,
      has_table_privilege('authenticated',c.oid,'select,insert,update,delete') authenticated
      from pg_class c where c.oid=to_regclass($1)`, [table])).rows;
    assert.equal(security.length, 1, `${table} absent`);
    assert.deepEqual(security[0], { relrowsecurity: true, anon: false, authenticated: false }, `${table} exposure`);
  }
  assert.equal((await database.query("select count(*)::int total from public.monitoring_events")).rows[0].total, 0);
  const auditSql = await readFile(path.join(root, "scripts", "system-post-activation-audit.sql"), "utf8");
  await database.exec("begin read only");
  const auditRows = (await database.query(auditSql)).rows;
  await database.exec("commit");
  assert.equal(auditRows.length, 1, "Post-activation audit must return one JSON result");
  const postAudit = auditRows[0].system_post_activation_audit;
  assert.equal(postAudit.migration_count, 26);
  assert.equal(postAudit.last_migration, expectedVersions.at(-1));
  assert.deepEqual(postAudit.counts, { colaboradores: 2, banco_horas_medicoes: 2, chamada_diaria: 1, perfis: 2, ferias_planejamento: 0, workspace_notices: 0, banco_horas_medicoes_canceladas: 0 });
  assert.equal(postAudit.functions.filter(item => item.schema === "public").length, wrappers.length);
  assert(postAudit.functions.every(item => !item.anonymous_execute), "Post-activation audit reported anonymous RPC execution");
  assert(postAudit.functions.filter(item => item.schema === "public").every(item => item.authenticated_execute && !item.security_definer), "Post-activation audit reported an invalid public wrapper");
  assert(postAudit.functions.filter(item => item.schema === "private" && !item.function.endsWith("_impl")).every(item => !item.authenticated_execute), "Post-activation audit reported an exposed internal helper");
  assert(postAudit.tables.every(item => item.rls && !item.any_anonymous_access && !item.authenticated_direct_mutation), "Post-activation audit reported an exposed table");
  const specifications = await tableSpecifications();
  const afterData = await dataFingerprint(specifications);
  const afterSchema = await schemaFingerprint();
  await assert.rejects(database.exec(sql), /MIGRATION_BASE_CHANGED/);
  await database.exec("rollback");
  assert.equal(await dataFingerprint(specifications), afterData, "Rejected replay changed rows");
  assert.equal(await schemaFingerprint(), afterSchema, "Rejected replay changed schema or migration history");
  assert.deepEqual(await readFile(manifestPath), manifestBytes, "Manifest changed during validation");
  assert.deepEqual(await readFile(schemaPath), schemaBytes, "Prepared SQL changed during validation");
  const report = {
    storage: "pglite-memory-only", project: manifest.project, schemaSha256: manifest.schemaSha256,
    previousMigrations: baseline.length, pendingMigrations: manifest.migrations.length, appliedMigrations: appliedVersions.length,
    exactBundlePassed: true, sourceDigestsVerified: true, syntheticProfiles: 2, syntheticEmployees: 2, syntheticMeasurements: 2, syntheticAttendance: 1,
    existingRowsPreserved: true, wrappersVerified: wrappers.length, rawProtectedTablesVerified: protectedTables.length,
    postActivationAuditPassed: true, postActivationAuditReadOnly: true, postActivationAuditSha256: sha256(auditSql),
    postActivationAuditFunctions: postAudit.functions.length, postActivationAuditTables: postAudit.tables.length,
    repeatedOrChangedBaseRejected: true, replayRowsUnchanged: true, replaySchemaAndVersionsUnchanged: true,
    originalPackageUnchanged: true, remoteApplied: false, productionRecordsRead: 0,
    setupMs, applicationMs, totalMs: Math.round(performance.now() - startedAt), verifiedAt: new Date().toISOString(),
  };
  await writeFile(path.join(packageDirectory, "synthetic-validation.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearTimeout(watchdog);
  await database.close();
}
