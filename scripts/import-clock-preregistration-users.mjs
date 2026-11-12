import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseClockUsers } from "./clock-users-inspect.mjs";

const sourceFor = { cpf: "ponto-iso-cd-jk", pis: "ponto-legado-cd-jk" };
const [mode, ...files] = process.argv.slice(2);
if (!["--preview", "--sql"].includes(mode) || files.length < 1 || files.length > 2) {
  throw new Error("Uso: node scripts/import-clock-preregistration-users.mjs (--preview|--sql) <usuarios.txt> [outro-export.txt]");
}

const sources = new Set();
const rows = [];
for (const file of files) {
  const { entries, summary } = parseClockUsers(await readFile(file), basename(file));
  const source = sourceFor[summary.identityType];
  if (sources.has(source)) throw new Error("Forneça um único arquivo por relógio");
  sources.add(source);
  const byDocument = new Map();
  for (const entry of entries) {
    if (entry.conflicts.length || entry.fullName.length > 200) continue;
    const document = entry[summary.identityType];
    if (byDocument.has(document)) continue;
    byDocument.set(document, {
      source_id: source, identity_type: summary.identityType, identity_value: document,
      employee_number: entry.employeeNumber, name: entry.fullName,
      file_sha256: summary.sha256, source_row: entry.sourceRow,
    });
  }
  if (!byDocument.size) throw new Error(`Nenhuma matrícula válida para ${source}`);
  rows.push(...byDocument.values());
  console.error(`${source}: ${byDocument.size} documentos com matrícula confirmada no arquivo`);
}

if (mode === "--sql") {
  const csv = rows.map(row => Object.values(row).map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  // Pipe this SQL to psql. It contains personal data and should not be logged.
  process.stdout.write(`begin;
select pg_advisory_xact_lock(791806);
create temporary table clock_users_import (
 source_id text,identity_type text,identity_value text,employee_number text,name text,file_sha256 text,source_row integer
) on commit drop;
copy clock_users_import from stdin with (format csv);
${csv}
\\.
do $$ begin
 if exists(select 1 from clock_users_import i where not exists(
  select 1 from public.monitoring_sources s where s.id=i.source_id and s.kind='afd' and s.active
 )) then raise exception 'CLOCK_SOURCE_NOT_ACTIVE'; end if;
end $$;
delete from private.clock_preregistration_users u where u.source_id in (select source_id from clock_users_import);
insert into private.clock_preregistration_users(source_id,identity_type,identity_value,employee_number,normalized_name,file_sha256,source_row)
select source_id,identity_type,identity_value,employee_number,private.operational_import_name(name),file_sha256,source_row
from clock_users_import where private.clock_document_is_unregistered(identity_type,identity_value);
commit;
`);
}
