import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";

// Generates reviewable SQL only; does not connect to a database or load credentials.
const directory = resolve("artifacts/clock-reconciliation");
const input = JSON.parse(await readFile(join(directory, "clock-patterns-input.json"), "utf8"));
const report = JSON.parse(await readFile(resolve("relogio de ponto/ESCALAS_PELO_PONTO_2026-10-19/evidencias-por-colaborador.json"), "utf8"));
const admins = JSON.parse(await readFile(join(directory, "admins.json"), "utf8"));
const actors = admins.filter(admin => admin.name === "Pedro Henrique");
if (actors.length !== 1 || !/^[0-9a-f-]{36}$/.test(actors[0].id)) throw new Error("ACTOR_AMBIGUOUS");
const selected = report.filter(row => row.active && ["ATIVO", "NOVO_ADMITIDO", "FERIAS"].includes(row.status) && ["selected","estimated"].includes(row.defaultSchedule?.state));
const rows = selected.map(row => {
 const p=row.defaultSchedule;
 const firstOperationalDate=p.payload.end<p.payload.start?"2026-09-29":"2026-09-30";
 const validFrom=row.admission>firstOperationalDate?row.admission:firstOperationalDate;
 return {employeeId:row.id,employeeNumber:row.employeeNumber,name:row.name,admission:row.admission,role:row.role,department:row.department,
 setting:{kind:"schedule",target:row.id,validFrom,validTo:null,payload:p.payload,
 reason:`Padrões e folgas informados pelo usuário em 19/10/2026, com 1h de almoço. ${p.reason}. Amostra completa de 01 a 12/10; 13/10 parcial excluído. Turno noturno pertence à data da entrada. Domingo mensal do noturno exige data confirmada; nenhuma data de folga mensal foi presumida.`}};
});
if (!rows.length || new Set(rows.map(row => row.employeeId)).size !== rows.length) throw new Error("DEFAULT_PLAN_INVALID");
const fingerprint = createHash("md5").update([...input.punches].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  .map(p => `${p.id}|${p.sourceId}|${Date.parse(p.timestamp)}|${p.eligible}|${p.conflicted}`).join("\n")).digest("hex");
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
function sql(batch, tag, rollback = false) {
  return `begin;
set local lock_timeout='15s';
set local statement_timeout='90s';
do $application$
declare row_data jsonb; previous public.monitoring_settings; created_count integer:=0; unchanged_count integer:=0; actual_digest text;
begin
 perform pg_advisory_xact_lock(824202609,1);perform pg_advisory_xact_lock(791800,1);perform pg_advisory_xact_lock(791701);perform pg_advisory_xact_lock(791704);
 if not exists(select 1 from public.perfis where id=${literal(actors[0].id)}::uuid and papel_usuario='ADMIN' and status_usuario='APROVADO') then raise exception 'ACTOR_CHANGED';end if;
 perform set_config('request.jwt.claim.sub',${literal(actors[0].id)},true);
 if strpos(pg_get_functiondef('private.daily_call_evidence_before_calendar(uuid,date)'::regprocedure),'WEEKLY_ROSTER_UNCONFIRMED')=0 then raise exception 'ESTIMATED_GUARD_MISSING';end if;
 if (select count(*) from public.monitoring_sources where id in ('ponto-iso-cd-jk','ponto-legado-cd-jk') and kind='afd' and active and configuration->>'sourceIdentityConfirmed'='true'
   and (configuration#>>'{declaredCoverage,from}')::timestamptz='2026-10-01T00:00:00-03:00'::timestamptz and (configuration#>>'{declaredCoverage,to}')::timestamptz='2026-10-13T00:00:00-03:00'::timestamptz
   and configuration#>>'{declaredCoverage,continuous}'='true')<>2 then raise exception 'COMPLETE_PERIOD_CHANGED';end if;
 select md5(string_agg(e.id::text||'|'||e.source_id||'|'||((extract(epoch from e.occurred_at)*1000)::bigint)::text||'|'||e.eligible::text||'|'||e.conflicted::text,E'\\n' order by e.id)) into actual_digest
 from public.monitoring_events e join public.monitoring_sources s on s.id=e.source_id
 join public.monitoring_bindings b on b.identity_type=e.identity_type and b.identity_value=e.identity_value and b.revoked_at is null
 join public.monitoring_sources bs on bs.id=b.source_id and bs.identity_namespace=s.identity_namespace
 where e.event_type='punch' and b.valid_from<=(e.occurred_at at time zone s.timezone)::date and (b.valid_to is null or b.valid_to>=(e.occurred_at at time zone s.timezone)::date);
 if actual_digest is distinct from ${literal(fingerprint)} then raise exception 'CLOCK_PATTERN_INPUT_CHANGED';end if;
 for row_data in select * from jsonb_array_elements(${literal(JSON.stringify(batch))}::jsonb) loop
   if not exists(select 1 from public.colaboradores where id=(row_data->>'employeeId')::uuid and matricula=row_data->>'employeeNumber' and nome=row_data->>'name' and admissao=(row_data->>'admission')::date and ativo_no_sistema and situacao in ('ATIVO','NOVO_ADMITIDO','FERIAS') and funcao is not distinct from row_data->>'role' and setor is not distinct from row_data->>'department') then raise exception 'EMPLOYEE_CHANGED';end if;
   if row_data#>>'{setting,payload,lunchMinutes}'<>'60' or (row_data#>>'{setting,payload,estimated}'='true' and row_data#>>'{setting,payload,weeklyRosterConfirmed}'<>'false') then raise exception 'UNSAFE_DEFAULT_PATTERN';end if;
   select * into previous from public.monitoring_settings where kind='schedule' and target=row_data->>'employeeId' and revoked_at is null and coalesce(valid_to,'9999-12-31')>=(row_data#>>'{setting,validFrom}')::date;
   if found then
     if previous.payload=row_data#>'{setting,payload}' and previous.valid_from=(row_data#>>'{setting,validFrom}')::date and previous.valid_to is null then unchanged_count:=unchanged_count+1;
     else raise exception 'EXISTING_SCHEDULE_REQUIRES_REVIEW';end if;
   else
     perform private.employee_schedule_impl('save',jsonb_build_object('employeeId',row_data->>'employeeId','date',row_data#>>'{setting,validFrom}','validFrom',row_data#>>'{setting,validFrom}','reason',row_data#>>'{setting,reason}','payload',row_data#>'{setting,payload}','expectedVersion',private.employee_schedule_snapshot((row_data->>'employeeId')::uuid,(row_data#>>'{setting,validFrom}')::date,true)->>'version'));created_count:=created_count+1;
   end if;
 end loop;
 perform set_config('clock.default_receipt',jsonb_build_object('batch',${literal(tag)},'created',created_count,'unchanged',unchanged_count)::text,true);
end;
$application$;
select current_setting('clock.default_receipt')::jsonb as receipt;
${rollback ? "rollback" : "commit"};
`;
}
await mkdir(join(directory, "default-schedule-sql"), { recursive: true });
const batches = [];
for (let index = 0; index < rows.length; index += 20) {
  const tag = `batch-${String(batches.length + 1).padStart(2, "0")}`;
  const file = `${tag}.sql`; await writeFile(join(directory, "default-schedule-sql", file), sql(rows.slice(index, index + 20), tag)); batches.push(file);
}
await writeFile(join(directory, "default-schedule-dry-run.sql"), sql(rows, "dry-run", true));
await writeFile(join(directory, "default-schedule-plan.json"), JSON.stringify({ inputFingerprint: fingerprint, expected: rows.length, estimated: rows.filter(row=>row.setting.payload.estimated).length, requiringReview: report.filter(row => row.active && row.defaultSchedule?.state !== "selected").length, rows, batches }, null, 2));
console.log(JSON.stringify({ prepared: rows.length, batches: batches.length, executed: 0 }));
