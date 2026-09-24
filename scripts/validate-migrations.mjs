import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const database = new PGlite();
const migrationsDirectory = path.resolve("supabase/migrations");
const migrations = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();

await database.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid());
`);

for (const migration of migrations) {
  const sql = await readFile(path.join(migrationsDirectory, migration), "utf8");
  await database.exec(sql);
}

const expectFailure = async (label, statement) => {
  try {
    await database.exec(statement);
  } catch {
    return;
  }
  throw new Error(`${label}: the database accepted invalid data`);
};

await database.exec(`
  insert into public.unidades (id, codigo, nome)
  values ('10000000-0000-0000-0000-000000000001', 'CD I', 'Centro de Distribuicao I');

  insert into public.gestores (id, nome)
  values ('20000000-0000-0000-0000-000000000001', 'Gestor Ficticio');

  insert into public.colaboradores (
    id, matricula, nome, unidade_id, gestor_id, situacao, admissao
  ) values (
    '30000000-0000-0000-0000-000000000001',
    'FICT-001',
    'Colaborador Ficticio',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'ATIVO',
    '2026-01-01'
  );

  insert into public.banco_horas_medicoes (
    id, colaborador_id, data_medicao, aplica_a_partir_de,
    jornada_horas_dia, saldo_minutos, origem
  ) values
    (
      '40000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '2026-09-13', '2026-09-13', 7.3333, 1760, 'teste_local'
    ),
    (
      '40000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000001',
      '2026-09-20', '2026-09-20', 7.3333, 1320, 'teste_local'
    );

  insert into public.chamada_diaria (colaborador_id, data, status)
  values
    ('30000000-0000-0000-0000-000000000001', '2026-09-14', 'G'),
    ('30000000-0000-0000-0000-000000000001', '2026-09-15', 'G'),
    ('30000000-0000-0000-0000-000000000001', '2026-09-21', 'G');
`);

await expectFailure("duplicate employee number", `
  insert into public.colaboradores (matricula, nome, unidade_id)
  values ('FICT-001', 'Duplicado', '10000000-0000-0000-0000-000000000001');
`);

await expectFailure("duplicate daily attendance", `
  insert into public.chamada_diaria (colaborador_id, data, status)
  values ('30000000-0000-0000-0000-000000000001', '2026-09-14', 'P');
`);

await expectFailure("invalid attendance code", `
  insert into public.chamada_diaria (colaborador_id, data, status)
  values ('30000000-0000-0000-0000-000000000001', '2026-09-22', 'INVALIDO');
`);

await expectFailure("orphan measurement", `
  insert into public.banco_horas_medicoes (
    colaborador_id, data_medicao, aplica_a_partir_de, jornada_horas_dia, saldo_minutos
  ) values (
    '99999999-9999-9999-9999-999999999999', '2026-09-23', '2026-09-23', 8, 60
  );
`);

const cycles = await database.query(`
  select aplica_a_partir_de, dias_g_ciclo, dias_pendentes_compensar, situacao_banco
  from public.vw_banco_horas_ciclos
  order by aplica_a_partir_de;
`);

const expectedCycles = [
  { aplica_a_partir_de: "2026-09-13", dias_g_ciclo: 2, dias_pendentes_compensar: 2, situacao_banco: "A_COMPENSAR" },
  { aplica_a_partir_de: "2026-09-20", dias_g_ciclo: 1, dias_pendentes_compensar: 2, situacao_banco: "A_COMPENSAR" },
];

const normalizedCycles = cycles.rows.map((row) => ({
  ...row,
  aplica_a_partir_de: row.aplica_a_partir_de.toISOString().slice(0, 10),
}));

if (JSON.stringify(normalizedCycles) !== JSON.stringify(expectedCycles)) {
  throw new Error(`baseline cycle mismatch: ${JSON.stringify(normalizedCycles)}`);
}

const rls = await database.query(`
  select count(*)::integer as protected_tables
  from pg_class
  where relnamespace = 'public'::regnamespace
    and relname in (
      'unidades', 'gestores', 'lotes_importacao', 'colaboradores',
      'banco_horas_medicoes', 'chamada_diaria'
    )
    and relrowsecurity;
`);

if (rls.rows[0].protected_tables !== 6) {
  throw new Error(`RLS mismatch: ${JSON.stringify(rls.rows[0])}`);
}

const policies = await database.query(`select count(*)::integer as policy_count from pg_policies where schemaname = 'public';`);
if (policies.rows[0].policy_count !== 0) {
  throw new Error(`unexpected permissive policies: ${JSON.stringify(policies.rows[0])}`);
}

const exposedGrants = await database.query(`
  select count(*)::integer as grant_count
  from information_schema.table_privileges
  where table_schema = 'public'
    and grantee in ('anon', 'authenticated');
`);
if (exposedGrants.rows[0].grant_count !== 0) {
  throw new Error(`unexpected Data API grants: ${JSON.stringify(exposedGrants.rows[0])}`);
}

const secureViews = await database.query(`
  select count(*)::integer as secure_views
  from pg_class
  where relnamespace = 'public'::regnamespace
    and relkind = 'v'
    and reloptions @> array['security_invoker=true'];
`);
if (secureViews.rows[0].secure_views !== 5) {
  throw new Error(`security_invoker mismatch: ${JSON.stringify(secureViews.rows[0])}`);
}

const missingForeignKeyIndexes = await database.query(`
  select c.conrelid::regclass::text as table_name, a.attname as column_name
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid
   and a.attnum = any(c.conkey)
  where c.contype = 'f'
    and c.connamespace = 'public'::regnamespace
    and not exists (
      select 1
      from pg_index i
      where i.indrelid = c.conrelid
        and a.attnum = any(i.indkey)
    );
`);
if (missingForeignKeyIndexes.rows.length !== 0) {
  throw new Error(`foreign keys without indexes: ${JSON.stringify(missingForeignKeyIndexes.rows)}`);
}

console.log(JSON.stringify({
  migrationsApplied: migrations.length,
  constraintsVerified: 4,
  baselineCyclesVerified: normalizedCycles,
  rlsTablesVerified: rls.rows[0].protected_tables,
  policiesVerified: policies.rows[0].policy_count,
  exposedGrantsVerified: exposedGrants.rows[0].grant_count,
  securityInvokerViewsVerified: secureViews.rows[0].secure_views,
  missingForeignKeyIndexes: missingForeignKeyIndexes.rows.length,
}, null, 2));

await database.close();
