import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { clockIdentifier, normalizeName, normalizeEmployeeNumber } from "./clock-users-inspect.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const sourceFor = { cpf: "ponto-iso-cd-jk", pis: "ponto-legado-cd-jk" };

export function planBindings(registry, live) {
  const candidates = [];
  const eligible = [];
  const skipped = [];
  for (const row of registry.entries) {
    const employee = live.employees.filter(e => e.active && normalizeEmployeeNumber(e.employeeNumber) === row.employeeNumber);
    if (row.conflicts.length || employee.length !== 1 || normalizeName(employee[0].name) !== normalizeName(row.fullName)) continue;
    const target = employee[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(target.admission ?? "")) throw new Error("ADMISSION_REQUIRED");
    const sourceId = sourceFor[row.identityType];
    const source = live.sources.find(s => s.id === sourceId && s.kind === "afd" && s.active);
    if (!source) throw new Error("CLOCK_SOURCE_REQUIRED");
    const identityValue = row[row.identityType];
    if (!clockIdentifier(identityValue, row.identityType).valid) throw new Error("IDENTITY_INVALID");
    const existing = live.bindings.filter(b => !b.revoked_at && b.identity_type === row.identityType && b.identity_value === identityValue && live.sources.find(s => s.id === b.source_id)?.namespace === source.namespace && (!b.valid_to || b.valid_to >= target.admission));
    const file = registry.files.find(f => f.sourceFile === row.sourceFile);
    if (!file?.sha256) throw new Error("SOURCE_HASH_REQUIRED");
    const candidate = { sourceId, sourceNamespace: source.namespace, sourceKind: source.kind, sourceConfiguration: source.configuration ?? {}, identityType: row.identityType, identityValue, employeeId: target.id, employeeNumber: target.employeeNumber, employeeName: target.name, validFrom: target.admission, validTo: null, sourceFile: row.sourceFile, sourceRow: row.sourceRow, evidence: `Cadastro do relógio ${row.sourceFile}, linha ${row.sourceRow}; SHA256 ${file.sha256}. Matrícula e nome completo coincidem com RH. CPF e PIS tratados separadamente. Autorizado pelo gestor em 2026-10-19.` };
    if (existing.length) {
      const alreadyBound = existing.every(b => b.employee_id === target.id && b.valid_from <= target.admission && !b.valid_to);
      skipped.push({ employeeNumber: target.employeeNumber, sourceId, reason: alreadyBound ? "already_bound" : "binding_conflict" });
      if (alreadyBound) eligible.push(candidate);
      continue;
    }
    candidates.push(candidate);
    eligible.push(candidate);
  }
  const unique = new Map();
  for (const row of candidates) {
    const key = `${row.sourceId}:${row.identityValue}`;
    const previous = unique.get(key);
    if (previous && previous.employeeId !== row.employeeId) throw new Error("AMBIGUOUS_PLAN");
    unique.set(key, row);
  }
  const eligibleUnique = new Map();
  for (const row of eligible) {
    const key = `${row.sourceId}:${row.identityValue}`;
    const previous = eligibleUnique.get(key);
    if (previous && previous.employeeId !== row.employeeId) throw new Error("AMBIGUOUS_PLAN");
    eligibleUnique.set(key, row);
  }
  return { bindings: [...unique.values()], eligibleBindings: [...eligibleUnique.values()], skipped };
}

export function bindingSql(rows, actorId, rollback = false) {
  if (!/^[0-9a-f-]{36}$/.test(actorId)) throw new Error("ACTOR_INVALID");
  return `begin;
set local lock_timeout='10s';
set local statement_timeout='120s';
do $apply$
declare r jsonb; created integer:=0; unchanged integer:=0;
begin
  -- Match the application's lock order before any decision about current records.
  perform pg_advisory_xact_lock(824202609,1);
  perform pg_advisory_xact_lock(791800,1);
  perform pg_advisory_xact_lock(791701);
  perform pg_advisory_xact_lock(791704);
  if not exists(select 1 from public.perfis where id=${literal(actorId)}::uuid and papel_usuario='ADMIN' and status_usuario='APROVADO') then raise exception 'ACTOR_CHANGED'; end if;
  perform set_config('request.jwt.claim.sub',${literal(actorId)},true);
  for r in select value from jsonb_array_elements(${literal(JSON.stringify(rows))}::jsonb) loop
    if not exists(select 1 from public.monitoring_sources where id=r->>'sourceId' and kind=r->>'sourceKind' and kind='afd' and active and identity_namespace=r->>'sourceNamespace' and configuration=r->'sourceConfiguration') then raise exception 'SOURCE_CHANGED'; end if;
    if not exists(select 1 from public.colaboradores where id=(r->>'employeeId')::uuid and matricula=r->>'employeeNumber' and nome=r->>'employeeName' and ativo_no_sistema and admissao=(r->>'validFrom')::date) then raise exception 'EMPLOYEE_CHANGED'; end if;
    if exists(select 1 from public.monitoring_bindings b where b.source_id=r->>'sourceId' and b.identity_type=r->>'identityType' and b.identity_value=r->>'identityValue' and b.employee_id=(r->>'employeeId')::uuid and b.revoked_at is null and b.valid_from<=(r->>'validFrom')::date and b.valid_to is null) then unchanged:=unchanged+1;
    else perform private.monitoring_binding_change_impl('create',r); created:=created+1; end if;
  end loop;
  perform set_config('clock_reconciliation.result',jsonb_build_object('created',created,'unchanged',unchanged)::text,true);
end $apply$;
select current_setting('clock_reconciliation.result')::jsonb as result;
${rollback ? "rollback" : "commit"};
`;
}

export async function prepare(root) {
  const dir = resolve(root, "artifacts/clock-reconciliation");
  const registry = JSON.parse(await readFile(resolve(dir, "clock-users.json"), "utf8"));
  const live = JSON.parse(await readFile(resolve(dir, "live-before.json"), "utf8"));
  const admins = JSON.parse(await readFile(resolve(dir, "admins.json"), "utf8"));
  const actor = admins.filter(a => a.name === "Pedro Henrique");
  if (actor.length !== 1) throw new Error("ACTOR_AMBIGUOUS");
  const plan = planBindings(registry, live);
  const currentDate = "2026-10-19";
  const hasPhoto = employeeId => live.bindings.some(b => b.employee_id === employeeId && !b.revoked_at && b.valid_from <= currentDate && (!b.valid_to || b.valid_to >= currentDate) && live.photos.some(p => p.identityValue === b.identity_value && live.sources.find(s => s.id === p.sourceId)?.namespace === live.sources.find(s => s.id === b.source_id)?.namespace));
  const images = new Map();
  for (const filename of await readdir(resolve(root, "relogio de ponto/user_images"))) {
    if (!/\.(jpg|jpeg|png)$/i.test(filename)) continue;
    const cpf = clockIdentifier(basename(filename, extname(filename)), "cpf");
    if (!cpf.valid) continue;
    const path = resolve(root, "relogio de ponto/user_images", filename);
    const sha256 = hash(await readFile(path));
    const prior = images.get(cpf.value);
    images.set(cpf.value, prior && prior.sha256 !== sha256 ? { conflict: true } : prior ?? { path, sha256 });
  }
  const photoCandidates = plan.eligibleBindings.filter(b => b.identityType === "cpf" && !hasPhoto(b.employeeId) && !live.photos.some(p => p.sourceId === b.sourceId && p.identityValue === b.identityValue));
  const photos = photoCandidates.flatMap(b => { const image = images.get(b.identityValue); return image && !image.conflict ? [{ ...b, ...image }] : []; });
  await mkdir(resolve(dir, "binding-sql"), { recursive: true });
  const batches = [];
  for (let i = 0; i < plan.bindings.length; i += 50) {
    const filename = `batch-${String(i / 50 + 1).padStart(2, "0")}.sql`;
    await writeFile(resolve(dir, "binding-sql", filename), bindingSql(plan.bindings.slice(i, i + 50), actor[0].id));
    batches.push(filename);
  }
  await writeFile(resolve(dir, "binding-dry-run.sql"), bindingSql(plan.bindings.slice(0, 50), actor[0].id, true));
  const summary = { bindings: plan.bindings.length, employees: new Set(plan.bindings.map(b => b.employeeId)).size, byType: Object.fromEntries(["cpf", "pis"].map(type => [type, plan.bindings.filter(b => b.identityType === type).length])), skipped: plan.skipped.length, missingPhotoCandidates: photoCandidates.length, photosToFill: photos.length, stillMissingImage: photoCandidates.length - photos.length, batches: batches.length };
  await writeFile(resolve(dir, "application-plan.json"), JSON.stringify({ generatedAt: new Date().toISOString(), summary, ...plan, photos, batches }, null, 2));
  console.log(JSON.stringify(summary));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await prepare(resolve(process.argv[2] ?? "."));
