import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const QUERY_TIMEOUT_MS = 30_000;
const EMPLOYEES = 384;
const DAYS = 31;

if (!process.argv.includes("--child")) {
  // An independent process enforces the wall deadline even while WASM occupies
  // the database thread. The query deadline starts only after fixture setup.
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child"], { stdio: ["ignore", "pipe", "pipe"] });
  let pending = "";
  let timedOut = false;
  let phase = "setup";
  const expire = () => {
    timedOut = true;
    console.log(JSON.stringify({ phase, status: "timeout", timeoutMs: phase === "query" ? QUERY_TIMEOUT_MS : 60_000, storage: "pglite-memory-only" }));
    child.kill("SIGKILL");
  };
  let timer = setTimeout(expire, 60_000);
  child.stdout.on("data", (chunk) => {
    pending += chunk.toString();
    while (pending.includes("\n")) {
      const index = pending.indexOf("\n");
      const line = pending.slice(0, index); pending = pending.slice(index + 1);
      try {
        const message = JSON.parse(line);
        if (message.phase === "query_started") { clearTimeout(timer); phase = "query"; timer = setTimeout(expire, QUERY_TIMEOUT_MS); }
        if (message.phase === "query_completed" || message.status === "failed") clearTimeout(timer);
      } catch { /* Only the child benchmark writes to this pipe. */ }
      console.log(line);
    }
  });
  child.stderr.on("data", () => {});
  child.on("error", (error) => { clearTimeout(timer); console.error(JSON.stringify({ status: "failed", code: error.code ?? "BENCHMARK_PROCESS_FAILED" })); process.exitCode = 1; });
  child.on("exit", (code) => { clearTimeout(timer); if (pending.trim()) console.log(pending.trim()); process.exitCode = timedOut ? 124 : code ?? 1; });
} else {
  const start = performance.now();
  const db = new PGlite();
  try {
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth;
      create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    const directory = resolve("supabase/migrations");
    const migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
    for (const name of migrations) await db.exec(await readFile(resolve(directory, name), "utf8"));
    const actor = "10000000-0000-4000-8000-000000000001";
    await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values('${actor}',encode(sha256(convert_to('00000000001','UTF8')),'hex')||'@auth.administrativo-cd.invalid','{"nome_completo":"Benchmark Sintetico","cpf_normalizado":"00000000001"}');
      update public.perfis set status_usuario='APROVADO',papel_usuario='ADMIN',aprovado_em=now() where id='${actor}';`);
    const migrated = performance.now();
    const tables = ["colaboradores", "banco_horas_medicoes", "monitoring_sources", "monitoring_files", "monitoring_bindings", "monitoring_settings"];
    await db.exec("begin");
    for (const table of tables) await db.exec(`alter table public.${table} disable trigger user`);
    await db.exec(`insert into public.gestores(id,nome) values('20000000-0000-4000-8000-000000000001','Equipe Benchmark Sintetica');
      insert into public.colaboradores(id,matricula,nome,unidade_id,gestor_id,admissao,situacao)
      select ('30000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'BENCH-'||i,'Pessoa Sintetica '||i,(select id from public.unidades limit 1),'20000000-0000-4000-8000-000000000001','2020-01-01','ATIVO' from generate_series(1,${EMPLOYEES}) i;
      insert into public.banco_horas_medicoes(colaborador_id,data_medicao,aplica_a_partir_de,jornada_horas_dia,saldo_minutos,origem)
      select id,current_date-60,current_date-60,8,0,'benchmark-synthetic' from public.colaboradores where matricula like 'BENCH-%';
      insert into public.monitoring_sources(id,kind,identity_namespace,configuration,last_success_at,worker_state)
      values('benchmark-afd','afd','benchmark-afd',jsonb_build_object('sourceIdentityConfirmed',true,'declaredCoverage',jsonb_build_object('from',(current_date-40)::text||'T00:00:00-03:00','to',current_date::text||'T23:59:59-03:00','continuous',true)),now(),'idle');
      insert into public.monitoring_files(source_id,sha256,byte_length,relative_path,parser_version,status,expected_batches,metadata,completed_at)
      values('benchmark-afd',repeat('a',64),1,'synthetic-afd.txt','synthetic','complete',1,'{}',now());
      insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by)
      select 'benchmark-afd','cpf',lpad(substring(matricula from 7),11,'0'),id,current_date-60,'Identidade sintetica de benchmark','${actor}' from public.colaboradores where matricula like 'BENCH-%';
      insert into public.monitoring_settings(kind,target,valid_from,payload,reason,created_by)
      select 'schedule',id::text,current_date-60,'{"name":"Escala Sintetica","start":"08:00","end":"17:00","days":[0,1,2,3,4,5,6]}','Escala sintetica benchmark','${actor}' from public.colaboradores where matricula like 'BENCH-%';`);
    for (const table of tables) await db.exec(`alter table public.${table} enable trigger user`);
    await db.exec("commit; analyze");
    const disabled = (await db.query("select count(*)::int total from pg_trigger where not tgisinternal and tgenabled='D'")).rows[0].total;
    if (disabled !== 0) throw new Error("TRIGGERS_NOT_REENABLED");
    const setupMs = Math.round(performance.now() - start);
    console.log(JSON.stringify({ phase: "setup_completed", storage: "pglite-memory-only", employees: EMPLOYEES, days: DAYS, assessedRows: EMPLOYEES * DAYS, migrations: migrations.length, migrationMs: Math.round(migrated - start), fixtureMs: Math.round(performance.now() - migrated), setupMs, disabledUserTriggers: disabled }));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
    await db.exec("set role authenticated; set statement_timeout='30s'");
    const queryStart = performance.now();
    console.log(JSON.stringify({ phase: "query_started", timeoutMs: QUERY_TIMEOUT_MS }));
    const result = await db.query("select public.daily_call_workflow('queue',jsonb_build_object('start',current_date-31,'end',current_date-1,'limit',50,'offset',0)) value");
    const value = result.rows[0].value;
    console.log(JSON.stringify({ phase: "query_completed", status: "ok", queryMs: Math.round(performance.now() - queryStart), returnedRows: value.rows.length, assessedRows: value.counts.total, days: value.days.length, counts: value.counts, rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024) }));
  } catch (error) {
    console.log(JSON.stringify({ status: "failed", code: error.code ?? "BENCHMARK_FAILED", message: error.message }));
    process.exitCode = 1;
  } finally { await db.close(); }
}
