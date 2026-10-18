import { PGlite } from "@electric-sql/pglite";
import ExcelJS from "exceljs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { batchesFor, readWorkerConfig } from "../lib/monitoring/ingestion/worker.ts";
import { buildPhotoIndex, listSourceFiles, loadPhoto, readStableSnapshot } from "../lib/monitoring/ingestion/files.ts";
import { parseAfd, parseSnapshot, parseWorkbook } from "../lib/monitoring/ingestion/parsers.ts";
import { ImportError } from "../lib/monitoring/ingestion/validation.ts";
import type { IngestionSource, ParsedImport } from "../lib/monitoring/ingestion/types.ts";

interface Task { source: IngestionSource; parsed: ParsedImport; relativePath: string; }
type Counts = { files: number; events: number; occurrences: number; people: number; bindings: number; photos: number; incomplete: number; conflicts: number };
const fail = (code: string): never => { throw new ImportError(code); };
const requireEqual = (actual: unknown, expected: unknown, code: string): void => { if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code); };
const source = (id: string, kind: IngestionSource["kind"]): IngestionSource => ({ id, kind, root: ".", timeZone: "America/Sao_Paulo", identityNamespace: kind === "afd" ? id : "synthetic-defense" });
const iso = (nsr: number, hour = "08") => `${String(nsr).padStart(9, "0")}32026-10-17T${hour}:00:00-0300012345678909ABCD`;

async function bootstrap(database: PGlite): Promise<number> {
  await database.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  const directory = resolve("supabase/migrations");
  const migrations = (await readdir(directory)).filter(file => file.endsWith(".sql")).sort();
  for (const migration of migrations) await database.exec(await readFile(resolve(directory, migration), "utf8"));
  return migrations.length;
}

async function rpc(database: PGlite, data: unknown): Promise<void> {
  await database.exec("set role service_role");
  try { await database.query("select public.monitoring_ingest($1::jsonb)", [JSON.stringify(data)]); }
  finally { await database.exec("reset role"); }
}

async function counts(database: PGlite): Promise<Counts> {
  const result = await database.query<Counts>(`select
    (select count(*)::int from public.monitoring_files) files,
    (select count(*)::int from public.monitoring_events) events,
    (select count(*)::int from public.monitoring_occurrences) occurrences,
    (select count(*)::int from public.monitoring_people) people,
    (select count(*)::int from public.monitoring_bindings) bindings,
    (select count(*)::int from public.monitoring_photos) photos,
    (select count(*)::int from public.monitoring_files where status='processing') incomplete,
    (select count(*)::int from public.monitoring_events where conflicted) conflicts`);
  return result.rows[0];
}

async function syntheticTasks(): Promise<Task[]> {
  const tasks: Task[] = [];
  const clock = source("synthetic-clock", "afd");
  tasks.push({ source: clock, parsed: parseAfd(Buffer.from(`${iso(1)}\n${iso(2, "12")}`), clock), relativePath: "synthetic-afd.txt" });
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Access");
  sheet.addRow(["Tipo de evento", "Eventos", "Hora", "Ponto de Acesso", "ID"]);
  sheet.addRow(["Acesso", "Desbloqueio por rosto", "2026-10-17 08:01:00", "Entrada sintética", "000001"]);
  sheet.addRow(["Acesso", "Desbloqueio por rosto", "2026-10-17 08:01:00", "Entrada sintética", "000001"]);
  sheet.addRow(["Acesso", "Desbloqueio de botão", "2026-10-17 08:02:00", "Entrada sintética", ""]);
  const access = source("synthetic-access", "defense-access");
  tasks.push({ source: access, parsed: await parseWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), access), relativePath: "synthetic-access.xlsx" });
  const people = new ExcelJS.Workbook(); const peopleSheet = people.addWorksheet("Person");
  peopleSheet.getRow(3).values = ["Nome", "ID", "Grupo de pessoas", "Imagem de rosto 1"];
  peopleSheet.getRow(4).values = ["Pessoa sintética", "000001", "CD/COZINHA JK", ""];
  const person = source("synthetic-person", "defense-person");
  tasks.push({ source: person, parsed: await parseWorkbook(Buffer.from(await people.xlsx.writeBuffer()), person), relativePath: "synthetic-person.xlsx" });
  return tasks;
}

async function realTasks(configPath: string): Promise<Task[]> {
  const config = await readWorkerConfig(configPath); const tasks: Task[] = [];
  for (const source of config.sources) for (const file of await listSourceFiles(source)) {
    const bytes = await readStableSnapshot(source.root, file, { stabilityMs: config.stabilityMs, maxBytes: config.maxFileBytes });
    const parsed = await parseSnapshot(bytes, source);
    if (!parsed.skipped) tasks.push({ source, parsed, relativePath: relative(await realpath(source.root), file).replace(/\\/g, "/") });
  }
  return tasks;
}

async function importTasks(database: PGlite, tasks: Task[], rename = false): Promise<void> {
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    const batches = batchesFor(task.parsed, task.source, rename ? `renamed-validation-${index}.${task.source.kind === "afd" ? "txt" : "xlsx"}` : task.relativePath, 500);
    for (const batch of batches) await rpc(database, batch);
  }
}

async function uploadPhotos(database: PGlite, tasks: Task[]): Promise<number> {
  let count = 0;
  for (const task of tasks) {
    if (task.source.kind !== "defense-person" || !task.source.photoRoot) continue;
    const index = await buildPhotoIndex(task.source.photoRoot);
    for (const occurrence of task.parsed.occurrences) {
      if (!occurrence.person?.photoReference) continue;
      const photo = await loadPhoto(task.source.photoRoot, occurrence.person.photoReference, index);
      await rpc(database, { photo: { sourceId: task.source.id, identityValue: occurrence.person.externalId, sha256: photo.sha256, mimeType: photo.mimeType, base64: photo.bytes.toString("base64") } });
      count++;
    }
  }
  return count;
}

async function validateRecoveryAndConflict(database: PGlite): Promise<void> {
  const clock = source("synthetic-recovery", "afd");
  const parsed = parseAfd(Buffer.from(`${iso(1)}\n${iso(2)}\n${iso(3)}`), clock);
  const batches = batchesFor(parsed, clock, "recovery.txt", 1);
  await rpc(database, batches[0]);
  requireEqual((await database.query<{ status: string }>("select status from public.monitoring_files where source_id='synthetic-recovery'")).rows[0].status, "processing", "PARTIAL_FILE_FALSE_COMPLETE");
  // Simulated interruption: discard the caller's progress and submit every batch again.
  for (const batch of batches) await rpc(database, batch);
  requireEqual((await database.query<{ status: string }>("select status from public.monitoring_files where source_id='synthetic-recovery'")).rows[0].status, "complete", "RECOVERY_NOT_COMPLETE");
  const before = (await counts(database)).events;
  const conflict = parseAfd(Buffer.from(iso(1, "09")), clock);
  for (const batch of batchesFor(conflict, clock, "conflict.txt")) await rpc(database, batch);
  requireEqual((await counts(database)).events, before, "CONFLICT_DUPLICATED_EVENT");
  const conflicting = await database.query<{ conflicted: boolean; eligible: boolean }>("select conflicted,eligible from public.monitoring_events where source_id='synthetic-recovery' and nsr='000000001'");
  requireEqual(conflicting.rows[0], { conflicted: true, eligible: false }, "CONFLICT_NOT_QUARANTINED");
  const a = batchesFor(parsed, clock, "concurrent-copy.txt", 1)[1];
  await Promise.all([rpc(database, a), rpc(database, a)]);
  requireEqual((await counts(database)).events, before, "REPLAY_MULTIPLIED_EVENTS");
  for (const [initialSize, resumedSize] of [[2, 1], [1, 2]]) {
    const changeSource = source(`synthetic-resize-${initialSize}-${resumedSize}`, "afd");
    const changeParsed = parseAfd(Buffer.from(`${iso(1)}\n${iso(2)}\n${iso(3)}`), changeSource);
    await rpc(database, batchesFor(changeParsed, changeSource, "resize.txt", initialSize)[0]);
    for (const batch of batchesFor(changeParsed, changeSource, "resize.txt", resumedSize)) await rpc(database, batch);
    const row = (await database.query<{ status: string; processed_rows: number; repeated_events: number }>("select status,processed_rows,repeated_events from public.monitoring_files where source_id=$1", [changeSource.id])).rows[0];
    requireEqual(row, { status: "complete", processed_rows: 3, repeated_events: 0 }, "BATCH_RESIZE_RECOVERY_FAILED");
  }
  // PGlite serializes one connection; this checks simultaneous callers, not multi-connection isolation.
}

async function validateQueue(database: PGlite): Promise<void> {
  const actor = "10000000-0000-0000-0000-000000000991";
  const employee = "30000000-0000-0000-0000-000000000991";
  await database.exec(`insert into auth.users(id,email,raw_user_meta_data) values('${actor}',encode(sha256(convert_to('12345678909','UTF8')),'hex')||'@auth.administrativo-cd.invalid','{"nome_completo":"Admin sintético local","cpf_normalizado":"12345678909"}');
    update public.perfis set status_usuario='APROVADO',papel_usuario='ADMIN',aprovado_em=now() where id='${actor}';
    insert into public.colaboradores(id,matricula,nome,unidade_id,situacao,admissao) values('${employee}','VALIDACAO-LOCAL-001','Pessoa sintética local',(select id from public.unidades where codigo='CD I'),'ATIVO','2026-01-01');`);
  await database.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  await database.exec("set role authenticated");
  try {
    await database.query("select public.monitoring_query('bind',$1::jsonb)", [JSON.stringify({ sourceId: "synthetic-recovery", identityType: "cpf", identityValue: "12345678909", employeeId: employee, validFrom: "2026-10-01", evidence: "Vínculo exclusivamente sintético de validação local" })]);
  } finally { await database.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
  const pending = (await database.query<{ count: number }>("select count(*)::int count from public.monitoring_jobs where employee_id=$1", [employee])).rows[0].count;
  if (!pending) fail("QUEUE_NOT_CREATED_AFTER_BINDING");
  const claim = async (sourceIds: string[]) => {
    await database.exec("set role service_role");
    try { return (await database.query<{ result: { jobs: Array<{ employeeId: string; date: string; leaseToken: string }>; pending: number } }>("select public.monitoring_worker('claim',$1::jsonb) result", [JSON.stringify({ sourceIds, limit: 10 })])).rows[0].result; }
    finally { await database.exec("reset role"); }
  };
  requireEqual((await claim(["synthetic-unrelated-source"])).jobs.length, 0, "QUEUE_SOURCE_SCOPE_VIOLATED");
  const first = await claim(["synthetic-recovery"]);
  if (!first.jobs.length || first.jobs.some(job => job.employeeId !== employee)) fail("QUEUE_CLAIM_INVALID");
  requireEqual((await claim(["synthetic-recovery"])).jobs.length, 0, "QUEUE_LEASE_NOT_EXCLUSIVE");
  const job = first.jobs[0];
  let invalidFinishRejected = false;
  await database.exec("set role service_role");
  try { await database.query("select public.monitoring_worker('finish',$1::jsonb)", [JSON.stringify({ ...job, leaseToken: "00000000-0000-0000-0000-000000000000" })]); }
  catch { invalidFinishRejected = true; }
  finally { await database.exec("reset role"); }
  if (!invalidFinishRejected) fail("QUEUE_INVALID_LEASE_ACCEPTED");
  await database.exec("set role service_role");
  try { await database.query("select public.monitoring_worker('retry',$1::jsonb)", [JSON.stringify({ ...job, code: "SYNTHETIC_RETRY" })]); }
  finally { await database.exec("reset role"); }
  await database.query("update public.monitoring_jobs set leased_until=now()-interval '1 second' where employee_id=$1 and operational_date=$2::date", [job.employeeId, job.date]);
  const retry = await claim(["synthetic-recovery"]);
  if (!retry.jobs.some(item => item.date === job.date && item.leaseToken !== job.leaseToken)) fail("QUEUE_RETRY_NOT_RECOVERABLE");
}

export async function main(argv: string[]): Promise<void> {
  let real = false; let config = "monitoramento.example.json";
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--real") real = true;
    else if (argv[index] === "--synthetic") real = false;
    else if (argv[index] === "--config" && argv[index + 1]) config = argv[++index];
    else fail("LOCAL_VALIDATION_UNKNOWN_ARGUMENT");
  }
  // Intentionally no database URL, filesystem data directory, environment key or remote client.
  const database = new PGlite();
  const started = performance.now();
  try {
    const migrations = await bootstrap(database);
    const inputs = real ? await realTasks(config) : await syntheticTasks();
    const tasks = [...new Map(inputs.map(task => [`${task.source.id}:${task.parsed.sha256}:${task.parsed.parserVersion}`, task])).values()];
    if (!tasks.length) fail("LOCAL_VALIDATION_NO_INPUT_FILES");
    if (tasks.some(task => task.parsed.occurrences.some(row => row.issues.some(issue => issue.severity === "error")))) fail("LOCAL_VALIDATION_REJECTED_INPUT_ROWS");
    const expected = {
      files: new Set(tasks.map(task => `${task.source.id}:${task.parsed.sha256}:${task.parsed.parserVersion}`)).size,
      events: new Set(tasks.flatMap(task => task.parsed.occurrences.flatMap(row => row.event ? [`${task.source.id}:${row.event.key}`] : []))).size,
      occurrences: tasks.reduce((sum, task) => sum + task.parsed.occurrences.length, 0),
      people: new Set(tasks.flatMap(task => task.parsed.occurrences.flatMap(row => row.person ? [`${task.source.id}:${row.person.externalId}`] : []))).size,
      bindings: 0, photos: 0, incomplete: 0, conflicts: 0,
    };
    const ingestionStarted = performance.now();
    await importTasks(database, tasks);
    const ingestionMs = Math.round(performance.now() - ingestionStarted);
    const photos = await uploadPhotos(database, tasks); expected.photos = photos;
    const first = await counts(database); requireEqual(first, expected, "LOCAL_FIRST_IMPORT_COUNT_MISMATCH");
    const replayStarted = performance.now();
    await importTasks(database, tasks);
    requireEqual(await counts(database), first, "SECOND_IMPORT_NOT_IDEMPOTENT");
    await importTasks(database, tasks, true);
    requireEqual(await counts(database), first, "RENAMED_IMPORT_NOT_IDEMPOTENT");
    const replayMs = Math.round(performance.now() - replayStarted);
    const peopleSnapshots = (await database.query<{ snapshots: number }>("select count(*)::int snapshots from public.monitoring_occurrences where payload ? 'person'")).rows[0].snapshots;
    requireEqual(peopleSnapshots, expected.people, "PEOPLE_SNAPSHOT_PROVENANCE_MISSING");
    const orphans = (await database.query<{ matched: number; orphan: number }>(`with identities as(select distinct s.identity_namespace,e.identity_value from public.monitoring_events e join public.monitoring_sources s on s.id=e.source_id where e.identity_type='defense'), resolved as(select exists(select 1 from public.monitoring_people p join public.monitoring_sources s on s.id=p.source_id where s.identity_namespace=i.identity_namespace and p.external_id=i.identity_value) found from identities i) select count(*) filter(where found)::int matched,count(*) filter(where not found)::int orphan from resolved`)).rows[0];
    const personQuality = (await database.query<{ leading_zero_ids: number; kitchen: number; leadership: number; either_group: number }>(`select count(*) filter(where external_id like '0%')::int leading_zero_ids,count(*) filter(where groups ? 'COZINHA JK')::int kitchen,count(*) filter(where groups ? 'LIDERANCA JK')::int leadership,count(*) filter(where groups ? 'COZINHA JK' or groups ? 'LIDERANCA JK')::int either_group from public.monitoring_people`)).rows[0];
    await validateRecoveryAndConflict(database);
    await validateQueue(database);
    console.log(JSON.stringify({ target: "PGlite disposable memory only", realLocalFiles: real, migrations, initialImport: first, exactDefenseIdentityMatches: orphans.matched, orphanDefenseIdentities: orphans.orphan, peopleSnapshots, personQuality, repeats: { sameFiles: "passed", renamedFiles: "passed", partialResume: "passed", conflictingNsr: "passed", simultaneousSerializedCalls: "passed", changedBatchSize: "passed", queueCreationScopeLeaseAndRetry: "passed" }, ingestionMs, replayAndRenameMs: replayMs, totalMs: Math.round(performance.now() - started), rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024), remoteDatabaseAccess: false }, null, 2));
  } finally { await database.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => {
  const code = error instanceof ImportError ? error.code : "LOCAL_VALIDATION_FAILED";
  const sqlState = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : undefined;
  console.error(JSON.stringify({ code, sqlState, remoteDatabaseAccess: false })); process.exitCode = 1;
});
