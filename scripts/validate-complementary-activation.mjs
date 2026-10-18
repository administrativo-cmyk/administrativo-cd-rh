import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

// Exact prepared transaction, synthetic records, disposable memory-only database.
// Does not load env files, contact Supabase, or change the package SQL/manifest.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "supabase/migrations");
const bundle = path.join(root, ".monitoring-worker/activation-complementary-20261018");
const manifestBytes = await readFile(path.join(bundle, "manifest.json"));
const schemaBytes = await readFile(path.join(bundle, "schema.sql"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const sql = schemaBytes.toString("utf8");
const baselineCrlf = process.argv.includes("--baseline-crlf");
const bundleCrlf = process.argv.includes("--bundle-crlf");
assert(process.argv.slice(2).every(argument => ["--baseline-crlf", "--bundle-crlf"].includes(argument)), "Unknown rehearsal option");
const crlf = value => value.replace(/\r?\n/g, "\r\n");
const executionSql = bundleCrlf ? crlf(sql) : sql;
const digest = value => createHash("sha256").update(value).digest("hex");
const identifier = value => `"${value.replaceAll('"', '""')}"`;
const startedAt = performance.now();
const watchdog = setTimeout(() => {
  console.error("COMPLEMENTARY_ACTIVATION_REHEARSAL_TIMEOUT: disposable PGlite exceeded 60 seconds");
  process.exit(1);
}, 60_000);
watchdog.unref();
assert.equal(manifest.project, "kqgtnucqxqqgwdyvhvdd");
assert.equal(typeof manifest.applied, "boolean");
assert.equal(manifest.previousVersions.length, 26);
assert.equal(manifest.migrations.length, 6);
assert.equal(digest(schemaBytes), manifest.schemaSha256);
const files = (await readdir(directory)).filter(name => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort();
const baseline = files.filter(file => file.slice(0, 14) <= "20261018003605");
assert.deepEqual(baseline.map(file => file.slice(0, 14)), manifest.previousVersions);
assert.deepEqual(files.filter(file => file.slice(0, 14) > "20261018003605"), manifest.migrations.map(item => item.file));
for (const migration of manifest.migrations) {
  assert.equal(migration.file, `${migration.version}_${migration.name}.sql`);
  assert.equal(digest(await readFile(path.join(directory, migration.file))), migration.sha256);
}

const database = new PGlite();
async function specifications() {
  return (await database.query(`select n.nspname schema_name,c.relname table_name,array_agg(a.attname order by a.attnum) columns
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    where n.nspname in ('public','private','chamada_privada','auth','supabase_migrations') and c.relkind='r' and a.attnum>0 and not a.attisdropped
    group by n.nspname,c.relname order by n.nspname,c.relname`)).rows;
}
async function dataSnapshot(tables) {
  const snapshots = [];
  for (const table of tables) {
    const relation = `${identifier(table.schema_name)}.${identifier(table.table_name)}`;
    const rows = (await database.query(`select to_jsonb(record) row from (select ${table.columns.map(identifier).join(",")} from ${relation}) record order by to_jsonb(record)::text`)).rows;
    snapshots.push({ relation: `${table.schema_name}.${table.table_name}`, count: rows.length, sha256: digest(JSON.stringify(rows)) });
  }
  return snapshots;
}
async function schemaFingerprint() {
  const queries = {
    functions: `select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','chamada_privada','auth') and p.prokind='f' order by n.nspname,p.proname,arguments`,
    relations: `select n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl,case when c.relkind='v' then pg_get_viewdef(c.oid,true) else null end definition from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','chamada_privada','auth','supabase_migrations') and c.relkind in ('r','v','S') order by n.nspname,c.relname`,
    indexes: `select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname in ('public','private','chamada_privada','auth','supabase_migrations') order by schemaname,tablename,indexname`,
    triggers: `select n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid,true) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','private','chamada_privada','auth') order by n.nspname,c.relname,t.tgname`,
    constraints: `select n.nspname,c.relname,con.conname,pg_get_constraintdef(con.oid,true) definition from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','chamada_privada','auth','supabase_migrations') order by n.nspname,c.relname,con.conname`,
    columns: `select table_schema,table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_name from information_schema.columns where table_schema in ('public','private','chamada_privada','auth','supabase_migrations') order by table_schema,table_name,ordinal_position`,
    policies: `select * from pg_policies where schemaname in ('public','private','chamada_privada','auth') order by schemaname,tablename,policyname`,
    schemas: `select nspname,nspacl from pg_namespace where nspname in ('public','private','chamada_privada','auth','supabase_migrations') order by nspname`,
    defaults: `select defaclrole,defaclnamespace,defaclobjtype,defaclacl from pg_default_acl order by defaclrole,defaclnamespace,defaclobjtype`,
    sequences: `select schemaname,sequencename,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value from pg_sequences where schemaname in ('public','private','chamada_privada','auth','supabase_migrations') order by schemaname,sequencename`,
  };
  const result = {};
  for (const [name, query] of Object.entries(queries)) result[name] = (await database.query(query)).rows;
  return digest(JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

try {
  await database.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;
    create schema auth;create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text);`);
  for (const file of baseline) {
    const original = await readFile(path.join(directory, file), "utf8");
    const source = baselineCrlf ? crlf(original) : original;
    await database.exec(source);
    await database.query("insert into supabase_migrations.schema_migrations values($1,$2,$3)", [file.slice(0, 14), [source], file.slice(15, -4)]);
  }
  const entrySignatures = ["private.monitoring_prepare_setting_change(uuid,date,date)", "private.time_bank_prepare_reprocess(uuid,date)", "private.monitoring_worker_impl(text,jsonb)"];
  async function entryDefinitions() {
    const result = [];
    for (const signature of entrySignatures) result.push({ signature, ...(await database.query("select pg_get_functiondef(oid) definition,prosrc body from pg_proc where oid=to_regprocedure($1)", [signature])).rows[0] });
    return result;
  }
  const entriesBefore = await entryDefinitions();
  assert.equal(entriesBefore.length, 3);
  if (baselineCrlf) assert(entriesBefore.every(entry => entry.body.includes("begin\r\n") && !entry.body.includes("begin\n")), "CRLF baseline fixture must cover all entry helpers");
  const operationSource = await readFile(path.join(directory, "20261018021924_monitoring_binding_sources_operational_imports.sql"), "utf8");
  const guardStart = operationSource.indexOf("-- Entry helpers run before job/revision locks.");
  assert(guardStart > 0);
  const guardSql = operationSource.slice(guardStart);
  const workerDefinition = entriesBefore[2].definition;
  const entryNewline = entriesBefore[2].body.includes("begin\r\n") ? "\r\n" : "\n";
  const firstInstruction = "if p_action='claim' then";
  const changedDefinitions = [
    workerDefinition.replace(firstInstruction, "if p_action='changed' then"),
    workerDefinition.replace(firstInstruction, `${firstInstruction}${entryNewline} /*begin${entryNewline} if p_action='claim' then*/`),
    workerDefinition.replace(`begin${entryNewline}`, `begin${entryNewline} perform pg_advisory_xact_lock(791704);${entryNewline}`),
  ];
  const guardSchemaBefore = await schemaFingerprint();
  for (const changedDefinition of changedDefinitions) {
    assert.notEqual(changedDefinition, workerDefinition);
    await database.exec("begin");
    await database.exec(changedDefinition);
    await assert.rejects(database.exec(guardSql), /OPERATION_PREPARE_DEFINITION_CHANGED/);
    await database.exec("rollback");
    assert.deepEqual(await entryDefinitions(), entriesBefore, "Failed entry guard partially patched other helpers");
    assert.equal(await schemaFingerprint(), guardSchemaBefore, "Failed entry guard changed schema or privileges");
  }
  await database.exec(`insert into auth.users(id,email,raw_user_meta_data) values
    ('fd000000-0000-4000-8000-000000000001',encode(sha256(convert_to('66666666001','UTF8')),'hex')||'@auth.administrativo-cd.invalid','{"nome_completo":"Synthetic package actor","cpf_normalizado":"66666666001"}');
    update public.perfis set status_usuario='APROVADO',papel_usuario='ADMIN',aprovado_em=now() where id='fd000000-0000-4000-8000-000000000001';
    insert into public.colaboradores(id,matricula,nome,unidade_id,setor,funcao,categoria) values
    ('ca000000-0000-4000-8000-000000000001','BUNDLE-0001','Synthetic preserved employee 1',(select id from public.unidades where codigo='CD I'),'  Setor teste  ','Funcao TESTE','Categoria TESTE'),
    ('ca000000-0000-4000-8000-000000000002','BUNDLE-0002','Synthetic preserved employee 2',(select id from public.unidades where codigo='CD I'),'SETOR TESTE','  funcao teste ','categoria teste');
    insert into public.banco_horas_medicoes(colaborador_id,data_medicao,aplica_a_partir_de,jornada_horas_dia,saldo_minutos,origem) values
    ('ca000000-0000-4000-8000-000000000001','2026-10-01','2026-10-01',8,480,'Synthetic bundle'),
    ('ca000000-0000-4000-8000-000000000002','2026-10-01','2026-10-01',8,-960,'Synthetic bundle');
    insert into public.chamada_diaria(colaborador_id,data,status,observacao) values('ca000000-0000-4000-8000-000000000001','2026-10-02','P','Synthetic bundle');
    insert into public.monitoring_sources(id,kind,identity_namespace,heartbeat_at,worker_state,last_success_at,configuration) values
    ('fixture-clock','afd','fixture-clock','2026-10-02T12:00:00Z','online','2026-10-02T12:00:00Z','{"sourceIdentityConfirmed":true}'),
    ('fixture-access','defense-access','fixture-defense','2026-10-02T12:00:00Z','online','2026-10-02T12:00:00Z','{}'),
    ('fixture-person','defense-person','fixture-defense','2026-10-02T12:00:00Z','online','2026-10-02T12:00:00Z','{}');
    insert into public.monitoring_files(id,source_id,sha256,byte_length,relative_path,parser_version,status,expected_rows,expected_batches,metadata,accepted_rows,new_events,repeated_events,processed_rows,completed_at) values
    ('fb000000-0000-4000-8000-000000000001','fixture-clock',repeat('1',64),120,'clock.txt','synthetic-v1','complete',1,1,'{"original":"clock bytes"}',1,1,0,1,'2026-10-02T12:00:00Z'),
    ('fb000000-0000-4000-8000-000000000002','fixture-access',repeat('2',64),240,'access.xlsx','synthetic-v1','complete',2,1,'{"original":"access bytes"}',2,1,1,2,'2026-10-02T12:00:00Z'),
    ('fb000000-0000-4000-8000-000000000003','fixture-person',repeat('3',64),160,'person.xlsx','synthetic-v1','complete',1,1,'{"original":"person bytes"}',1,0,0,1,'2026-10-02T12:00:00Z');
    insert into public.monitoring_batches(file_id,batch_index,row_count,final,batch_hash) select id,0,expected_rows,true,sha256 from public.monitoring_files;
    insert into public.monitoring_attempts(source_id,relative_path,code,created_at) values('fixture-access','access.xlsx','CONNECTION_RETRY','2026-10-02T11:59:00Z');
    insert into public.monitoring_events(id,source_id,event_key,payload_hash,event_type,identity_type,identity_value,occurred_at,device,classification,eligible,nsr,payload) values
    ('fe000000-0000-4000-8000-000000000001','fixture-clock','punch-000000001',repeat('4',64),'punch','cpf','11144477735','2026-10-02T11:00:00Z','clock-device','authorized',true,'000000001','{"original":"punch row"}'),
    ('fe000000-0000-4000-8000-000000000002','fixture-access','access-1',repeat('5',64),'access','defense','00017','2026-10-02T11:01:00Z','access-device','authorized',true,null,'{"original":"access row"}');
    insert into public.monitoring_occurrences(file_id,occurrence_key,line,sheet,payload_hash,event_id,payload) values
    ('fb000000-0000-4000-8000-000000000001','line-1',1,null,repeat('4',64),'fe000000-0000-4000-8000-000000000001','{"original":"punch row"}'),
    ('fb000000-0000-4000-8000-000000000002','line-2',2,'Access',repeat('5',64),'fe000000-0000-4000-8000-000000000002','{"original":"access row"}'),
    ('fb000000-0000-4000-8000-000000000002','line-3',3,'Access',repeat('5',64),'fe000000-0000-4000-8000-000000000002','{"original":"repeated access row"}'),
    ('fb000000-0000-4000-8000-000000000003','line-2',2,'Person',repeat('6',64),null,'{"original":"person row"}');
    insert into public.monitoring_people(source_id,external_id,name,groups,photo_reference,file_id) values('fixture-person','00017','Synthetic preserved employee 1','["Fixture group"]','photos/00017.png','fb000000-0000-4000-8000-000000000003');
    insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,valid_to,evidence,created_by) values
    ('fixture-clock','cpf','11144477735','ca000000-0000-4000-8000-000000000001','2026-10-01','2026-10-31','Synthetic reviewed identity','fd000000-0000-4000-8000-000000000001'),
    ('fixture-access','defense','00017','ca000000-0000-4000-8000-000000000001','2026-10-01',null,'Synthetic reviewed identity','fd000000-0000-4000-8000-000000000001');`);
  const photo = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
  await database.query("insert into public.monitoring_photos(source_id,identity_value,sha256,mime_type,base64) values('fixture-person','00017',$1,'image/png',$2)", [digest(Buffer.from(photo, "base64")), photo]);
  const labelsBefore = (await database.query("select id employee_id,setor department,funcao job,categoria category from public.colaboradores order by id")).rows;
  const protectedNames = ["auth.users", "public.perfis", "public.colaboradores", "public.banco_horas_medicoes", "public.chamada_diaria", "public.monitoring_sources", "public.monitoring_files", "public.monitoring_batches", "public.monitoring_attempts", "public.monitoring_events", "public.monitoring_occurrences", "public.monitoring_people", "public.monitoring_bindings", "public.monitoring_photos", "public.monitoring_settings"];
  const preservationSpecifications = (await specifications()).filter(t => protectedNames.includes(`${t.schema_name}.${t.table_name}`)).map(t => t.table_name === "colaboradores" ? { ...t, columns: t.columns.filter(c => !["setor", "funcao", "categoria", "updated_at"].includes(c)) } : t);
  assert.equal(preservationSpecifications.length, protectedNames.length);
  const preservedBefore = await dataSnapshot(preservationSpecifications);
  assert(preservedBefore.every(table => table.count > 0), "Every preservation fixture must contain rows");
  const preservationAuditSql = await readFile(path.join(root, "scripts/complementary-preservation-audit.sql"), "utf8");
  await database.exec("begin read only");
  const preservationAuditBefore = (await database.query(preservationAuditSql)).rows[0].preservation_audit.datasets;
  await database.exec("commit");
  assert.equal(Object.keys(preservationAuditBefore).length, 10);
  const setupMs = Math.round(performance.now() - startedAt);
  const applicationStartedAt = performance.now();
  await database.exec(executionSql);
  const applicationMs = Math.round(performance.now() - applicationStartedAt);
  for (const [index, entry] of (await entryDefinitions()).entries()) {
    const newline = entriesBefore[index].body.includes("begin\r\n") ? "\r\n" : "\n";
    const inserted = ` perform pg_advisory_xact_lock(791704);${newline}`;
    assert.equal(entry.body.split(inserted).length - 1, 1, `Entry lock must occur exactly once: ${entry.signature}`);
    assert.equal(entry.body.replace(inserted, ""), entriesBefore[index].body, `Entry patch changed original function content: ${entry.signature}`);
  }
  assert.deepEqual(await dataSnapshot(preservationSpecifications), preservedBefore, "Activation changed original personnel, financial, attendance or Monitoring rows");
  await database.exec("begin read only");
  assert.deepEqual((await database.query(preservationAuditSql)).rows[0].preservation_audit.datasets, preservationAuditBefore, "Read-only preservation audit changed after activation");
  await database.exec("commit");
  assert.deepEqual((await database.query("select employee_id,department,job,category from private.employee_catalog_legacy order by employee_id")).rows, labelsBefore, "Original department, job or category spelling was lost");
  const catalogIntegrity = (await database.query(`select count(*)::int checked,count(*) filter(where c.id is not null and a.catalog_id=c.id and c.name_key=private.catalog_key(v.original_label) and v.current_label=c.name)::int valid
    from public.colaboradores e join private.employee_catalog_legacy l on l.employee_id=e.id
    cross join lateral (values('department',e.department_catalog_id,e.setor,l.department),('job',e.job_catalog_id,e.funcao,l.job),('category',e.category_catalog_id,e.categoria,l.category)) v(kind,catalog_id,current_label,original_label)
    left join private.canonical_catalog c on c.id=v.catalog_id and c.kind=v.kind
    left join private.canonical_catalog_alias a on a.kind=v.kind and a.label=v.original_label`)).rows[0];
  assert.deepEqual(catalogIntegrity, { checked: 6, valid: 6 });
  const expectedVersions = [...manifest.previousVersions, ...manifest.migrations.map(item => item.version)];
  assert.deepEqual((await database.query("select version from supabase_migrations.schema_migrations order by version")).rows.map(row => row.version), expectedVersions);
  const auditSql = await readFile(path.join(root, "scripts/complementary-post-activation-audit.sql"), "utf8");
  await database.exec("begin read only");
  const auditRows = (await database.query(auditSql)).rows;
  await database.exec("commit");
  assert.equal(auditRows.length, 1);
  const audit = auditRows[0].complementary_audit;
  assert.equal(audit.migration_count, 32);
  assert.equal(audit.last_migration, expectedVersions.at(-1));
  const expectedCounts = { colaboradores: 2, banco_horas_medicoes: 2, chamada_diaria: 1, perfis: 1, monitoring_sources: 3, monitoring_files: 3, monitoring_batches: 3, monitoring_attempts: 1, monitoring_events: 2, monitoring_occurrences: 4, monitoring_people: 1, monitoring_bindings: 2, monitoring_photos: 1, monitoring_settings: 8, monitoring_results: 0, monitoring_jobs: 0, monitoring_audit: 0, canonical_catalog: 3, canonical_catalog_alias: 6, employee_catalog_legacy: 2, planning_configurations: 0, operational_import_batches: 0, daily_call_attachments: 0 };
  assert.deepEqual(audit.counts, expectedCounts);
  assert.deepEqual(audit.file_status, { complete: 3 });
  assert.deepEqual(audit.photo_quality, { total: 1, invalid_base64: 0, invalid_size: 0, hash_mismatch: 0, total_bytes: Buffer.from(photo, "base64").length, without_person: 0 });
  assert.deepEqual(audit.catalog_preservation, { employees: 2, missing_legacy_snapshot: 0, missing_department_alias: 0, missing_job_alias: 0, missing_category_alias: 0 });
  const authenticatedFunctions = ["public.administration(text,text,jsonb)", "public.workspace(text,jsonb)", "public.daily_call_batch(text,jsonb)", "public.daily_call_attachments(text,jsonb)", "public.monitoring_binding_change(text,jsonb)", "public.monitoring_sources_admin(text,jsonb)", "public.operational_import(text,jsonb)", "public.audit_history(jsonb)", "public.schedule_planning(text,jsonb)"];
  const serviceFunctions = ["public.daily_call_attachment_upload(uuid,jsonb)", "public.monitoring_worker_sources(text[])", "public.monitoring_ingest(jsonb)", "public.monitoring_worker(text,jsonb)", "private.monitoring_ingest_impl(jsonb)", "private.monitoring_worker_impl(text,jsonb)", "private.monitoring_worker_sources_impl(text[])", "private.daily_call_attachment_upload(uuid,jsonb)"];
  const internalFunctions = ["private.monitoring_ingest_before_source_management(jsonb)", "private.workspace_before_operations(text,jsonb)", "private.daily_call_attachment_internal(text,jsonb,uuid,boolean)", "private.operational_import_snapshot(uuid)"];
  assert.deepEqual(audit.functions.map(f => f.signature).sort(), [...authenticatedFunctions, ...serviceFunctions, ...internalFunctions].sort());
  for (const item of audit.functions) {
    assert.equal(item.present, true, item.signature);
    assert.equal(item.anonymous_execute, false, item.signature);
    assert.equal(item.authenticated_execute, authenticatedFunctions.includes(item.signature), item.signature);
    assert.equal(item.service_execute, serviceFunctions.includes(item.signature), item.signature);
    if (item.schema === "public") assert.equal(item.security_definer, false, item.signature);
  }
  const protectedTables = ["private.canonical_catalog", "private.canonical_catalog_alias", "private.employee_catalog_legacy", "private.daily_call_attachments", "private.daily_call_attachment_audit", "private.operational_import_batches", "private.operational_import_rows", "private.planning_configurations", "private.monitoring_revision", ...["sources", "files", "batches", "attempts", "events", "occurrences", "people", "bindings", "settings", "photos", "results", "jobs", "audit"].map(name => `public.monitoring_${name}`)];
  assert.deepEqual(audit.tables.map(t => t.relation).sort(), protectedTables.sort());
  for (const table of audit.tables) {
    assert.equal(table.present, true, table.relation);
    // Existing private revision counter has no RLS; all raw grants remain denied.
    assert.equal(table.rls, table.relation !== "private.monitoring_revision", table.relation);
    assert.equal(table.anonymous_access, false, table.relation);
    assert.equal(table.authenticated_direct_access, false, table.relation);
    assert.equal(table.service_direct_access, false, table.relation);
  }
  const replaySpecifications = await specifications();
  const beforeReplayData = await dataSnapshot(replaySpecifications);
  const beforeReplaySchema = await schemaFingerprint();
  await assert.rejects(database.exec(executionSql), /MIGRATION_BASE_CHANGED/);
  await database.exec("rollback");
  assert.deepEqual(await specifications(), replaySpecifications, "Rejected replay changed table structure");
  assert.deepEqual(await dataSnapshot(replaySpecifications), beforeReplayData, "Rejected replay changed rows or migration history");
  assert.equal(await schemaFingerprint(), beforeReplaySchema, "Rejected replay changed schema, privileges, policies or sequences");
  assert.deepEqual(await readFile(path.join(bundle, "manifest.json")), manifestBytes, "Package manifest changed");
  assert.deepEqual(await readFile(path.join(bundle, "schema.sql")), schemaBytes, "Package SQL changed");
  const report = { storage: "isolated-pglite", remoteApplied: false, productionRecordsRead: 0, project: manifest.project, schemaSha256: manifest.schemaSha256, previousMigrations: baseline.length, pendingMigrations: manifest.migrations.length, finalMigrations: files.length, exactBundlePassed: true, sourceDigestsVerified: true, businessRecordsPreserved: true, originalCatalogLabelsPreserved: true, originalCatalogLabelChecks: catalogIntegrity.checked, monitoringRecordsPreserved: true, preservationTables: preservedBefore, postActivationAuditReadOnly: true, replayRejected: true, replayRowsUnchanged: true, replaySchemaAndVersionsUnchanged: true, replayTablesChecked: replaySpecifications.length, replayDataSha256: digest(JSON.stringify(beforeReplayData)), replaySchemaSha256: beforeReplaySchema, originalPackageUnchanged: true, grantsAndRlsVerified: true, wrappersVerified: audit.functions.filter(f => f.schema === "public").length, internalFunctionsDenied: internalFunctions.length, rawProtectedTablesVerified: audit.tables.length, setupMs, applicationMs, totalMs: Math.round(performance.now() - startedAt), audit, verifiedAt: new Date().toISOString() };
  report.rlsTablesVerified = audit.tables.filter(table => table.rls).length;
  report.preexistingPrivateCountersWithoutRls = audit.tables.filter(table => !table.rls).map(table => table.relation);
  report.preservationAuditReadOnly = true;
  report.preservationAuditDatasetsVerified = Object.keys(preservationAuditBefore).length;
  report.baselineLineEndings = baselineCrlf ? "CRLF" : "source";
  report.bundleLineEndings = bundleCrlf ? "CRLF transport" : "exact package";
  report.exactPreparedSqlExecuted = !bundleCrlf;
  report.entryGuardsVerified = { helpers: 3, semanticChangeRejected: true, duplicateMarkerRejected: true, existingLockRejected: true, failedGuardRollbackVerified: true, originalBodyPreserved: true };
  const variant = `${baselineCrlf ? "-baseline-crlf" : ""}${bundleCrlf ? "-bundle-crlf" : ""}`;
  await writeFile(path.join(bundle, `synthetic-validation${variant}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, preservationTables: report.preservationTables.map(t => ({ relation: t.relation, count: t.count })), audit: { tables: audit.tables.length, functions: audit.functions.length, counts: audit.counts, photo_quality: audit.photo_quality } }, null, 2));
} catch (error) {
  // PGlite errors include the complete SQL; emit only a bounded diagnostic.
  console.error(JSON.stringify({ error: String(error.message).split("\n")[0].slice(0, 240), code: error.code ?? null }));
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await database.close();
}
