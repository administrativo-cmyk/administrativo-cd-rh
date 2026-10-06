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
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid()
  returns uuid
  language sql
  stable
  as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
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

const asAuthenticated = async (userId, operation) => {
  await database.exec(`select set_config('request.jwt.claim.sub', '${userId}', false); set role authenticated;`);
  try {
    return await operation();
  } finally {
    await database.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
};

const expectAuthenticatedFailure = async (label, userId, statement) => {
  try {
    await asAuthenticated(userId, () => database.exec(statement));
  } catch {
    return;
  }
  throw new Error(`${label}: authenticated operation was unexpectedly accepted`);
};

await database.exec(`
  insert into public.gestores (id, nome)
  values ('20000000-0000-0000-0000-000000000001', 'Gestor Ficticio');

  insert into public.colaboradores (
    id, matricula, nome, unidade_id, gestor_id, situacao, admissao
  ) values (
    '30000000-0000-0000-0000-000000000001',
    'FICT-001',
    'Colaborador Ficticio',
    (select id from public.unidades where codigo = 'CD I'),
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
  values ('FICT-001', 'Duplicado', (select id from public.unidades where codigo = 'CD I'));
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

const authUsers = {
  admin: "10000000-0000-0000-0000-000000000001",
  rh: "10000000-0000-0000-0000-000000000002",
  manager: "10000000-0000-0000-0000-000000000003",
  reader: "10000000-0000-0000-0000-000000000004",
  pendingAdminRole: "10000000-0000-0000-0000-000000000005",
  pendingRhRole: "10000000-0000-0000-0000-000000000006",
  selfPending: "10000000-0000-0000-0000-000000000007",
  secondAdmin: "10000000-0000-0000-0000-000000000008",
};

await database.exec(`
  insert into auth.users (id, email, raw_user_meta_data) values
    ('${authUsers.admin}', encode(sha256(convert_to('00000000001', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid', '{"nome_completo":"Admin Local","cpf_normalizado":"00000000001"}'),
    ('${authUsers.rh}', encode(sha256(convert_to('00000000002', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid', '{"nome_completo":"RH Local","cpf_normalizado":"00000000002"}'),
    ('${authUsers.manager}', encode(sha256(convert_to('00000000003', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid', '{"nome_completo":"Gestor Local","cpf_normalizado":"00000000003"}'),
    ('${authUsers.reader}', encode(sha256(convert_to('00000000004', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid', '{"nome_completo":"Leitura Local","cpf_normalizado":"00000000004"}'),
    ('${authUsers.pendingAdminRole}', encode(sha256(convert_to('00000000005', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid', '{"nome_completo":"Pendente Admin","cpf_normalizado":"00000000005"}'),
    ('${authUsers.pendingRhRole}', encode(sha256(convert_to('00000000006', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid', '{"nome_completo":"Pendente RH","cpf_normalizado":"00000000006"}'),
    ('${authUsers.selfPending}', encode(sha256(convert_to('00000000007', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid', '{"nome_completo":"Auto Pendente","cpf_normalizado":"00000000007"}'),
    ('${authUsers.secondAdmin}', encode(sha256(convert_to('00000000008', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid', '{"nome_completo":"Segundo Admin","cpf_normalizado":"00000000008"}');

  update public.perfis
  set status_usuario = 'APROVADO', papel_usuario = 'ADMIN', aprovado_em = now()
  where id = '${authUsers.admin}';

  update public.perfis
  set status_usuario = 'APROVADO', papel_usuario = 'RH', aprovado_em = now()
  where id = '${authUsers.rh}';
`);

const createdProfiles = await database.query(`
  select id, status_usuario, papel_usuario
  from public.perfis
  where id in ('${authUsers.manager}', '${authUsers.reader}')
  order by id;
`);
if (createdProfiles.rows.some((row) => row.status_usuario !== "PENDENTE" || row.papel_usuario !== null)) {
  throw new Error(`new profile state mismatch: ${JSON.stringify(createdProfiles.rows)}`);
}

const sanitizedMetadata = await database.query(`
  select raw_user_meta_data ? 'cpf_normalizado' as keeps_cpf
  from auth.users
  where id = '${authUsers.manager}';
`);
if (sanitizedMetadata.rows[0].keeps_cpf !== false) {
  throw new Error(`CPF was retained in Auth metadata: ${JSON.stringify(sanitizedMetadata.rows[0])}`);
}

await expectFailure("duplicate CPF profile", `
  insert into auth.users (id, email, raw_user_meta_data)
  values (
    '10000000-0000-0000-0000-000000000099',
    encode(sha256(convert_to('00000000003', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid',
    '{"nome_completo":"Duplicado Local","cpf_normalizado":"00000000003"}'
  );
`);

await expectFailure("mismatched technical identifier", `
  insert into auth.users (id, email, raw_user_meta_data)
  values (
    '10000000-0000-0000-0000-000000000098',
    'identificador-invalido@auth.administrativo-cd.invalid',
    '{"nome_completo":"Identidade Invalida","cpf_normalizado":"00000000008"}'
  );
`);

await expectFailure(
  "last approved admin cannot be demoted by direct table mutation",
  `update public.perfis set papel_usuario = 'RH' where id = '${authUsers.admin}';`,
);

await expectFailure(
  "last approved admin cannot be deactivated by direct table mutation",
  `update public.perfis set status_usuario = 'BLOQUEADO' where id = '${authUsers.admin}';`,
);

await expectFailure(
  "last approved admin cannot be deleted by direct table mutation",
  `delete from public.perfis where id = '${authUsers.admin}';`,
);

await expectAuthenticatedFailure(
  "pending user self approval",
  authUsers.selfPending,
  `select public.aprovar_usuario('${authUsers.selfPending}', 'ADMIN', null);`,
);

await expectAuthenticatedFailure(
  "RH promotes ADMIN",
  authUsers.rh,
  `select public.aprovar_usuario('${authUsers.pendingAdminRole}', 'ADMIN', null);`,
);

await expectAuthenticatedFailure(
  "RH promotes RH",
  authUsers.rh,
  `select public.aprovar_usuario('${authUsers.pendingRhRole}', 'RH', null);`,
);

await asAuthenticated(authUsers.rh, () => database.exec(`
  select public.aprovar_usuario('${authUsers.manager}', 'GESTOR', null);
  select public.aprovar_usuario('${authUsers.reader}', 'LEITURA', null);
`));

await asAuthenticated(authUsers.admin, () => database.exec(`
  select public.aprovar_usuario('${authUsers.pendingRhRole}', 'RH', null);
`));

await expectAuthenticatedFailure(
  "RH blocks ADMIN",
  authUsers.rh,
  `select public.bloquear_usuario('${authUsers.admin}');`,
);

await expectAuthenticatedFailure(
  "RH blocks RH",
  authUsers.rh,
  `select public.bloquear_usuario('${authUsers.pendingRhRole}');`,
);

await expectAuthenticatedFailure(
  "admin blocks self",
  authUsers.admin,
  `select public.bloquear_usuario('${authUsers.admin}');`,
);

await expectFailure(
  "last approved admin protection",
  `select private.assert_active_admin_remains('${authUsers.admin}');`,
);

await database.exec(`
  update public.perfis
  set status_usuario = 'APROVADO', papel_usuario = 'ADMIN', aprovado_em = now()
  where id = '${authUsers.secondAdmin}';
`);

await asAuthenticated(authUsers.admin, () => database.exec(
  `select public.bloquear_usuario('${authUsers.secondAdmin}');`,
));

const remainingAdmins = await database.query(`
  select count(*)::integer as count
  from public.perfis
  where status_usuario = 'APROVADO' and papel_usuario = 'ADMIN';
`);
if (remainingAdmins.rows[0].count !== 1) {
  throw new Error(`blocking another admin did not preserve one approved admin: ${JSON.stringify(remainingAdmins.rows[0])}`);
}

await expectAuthenticatedFailure(
  "blocked admin cannot block remaining admin",
  authUsers.secondAdmin,
  `select public.bloquear_usuario('${authUsers.admin}');`,
);

await asAuthenticated(authUsers.rh, () => database.exec(`select public.bloquear_usuario('${authUsers.manager}');`));
await asAuthenticated(authUsers.rh, () => database.exec(`select public.reativar_usuario('${authUsers.manager}');`));
await asAuthenticated(authUsers.admin, () => database.exec(`select public.bloquear_usuario('${authUsers.pendingRhRole}');`));
await asAuthenticated(authUsers.admin, () => database.exec(`select public.reativar_usuario('${authUsers.pendingRhRole}');`));

await expectAuthenticatedFailure(
  "user edits own role",
  authUsers.reader,
  `update public.perfis set papel_usuario = 'ADMIN' where id = '${authUsers.reader}';`,
);

const ownProfileRows = await asAuthenticated(authUsers.reader, () => database.query(`
  select id, nome_completo, status_usuario, papel_usuario
  from public.perfis;
`));
if (ownProfileRows.rows.length !== 1 || ownProfileRows.rows[0].id !== authUsers.reader) {
  throw new Error(`own-profile RLS mismatch: ${JSON.stringify(ownProfileRows.rows)}`);
}

await expectAuthenticatedFailure(
  "manager lists users",
  authUsers.manager,
  `select * from public.listar_usuarios(null, null, null);`,
);

await expectAuthenticatedFailure(
  "reader lists users",
  authUsers.reader,
  `select * from public.listar_usuarios(null, null, null);`,
);

const administrativeUsers = await asAuthenticated(authUsers.admin, () => database.query(`
  select cpf_mascarado
  from public.listar_usuarios(null, null, null);
`));
if (
  administrativeUsers.rows.length !== 8
  || administrativeUsers.rows.some((row) => !/^\*\*\*\.\*\*\*\.\*\*\*-[0-9]{2}$/.test(row.cpf_mascarado))
) {
  throw new Error(`administrative CPF masking mismatch: ${JSON.stringify(administrativeUsers.rows)}`);
}

const pendingUsers = await asAuthenticated(authUsers.admin, () => database.query(`
  select id
  from public.listar_usuarios('PENDENTE', null, null);
`));
if (pendingUsers.rows.length !== 2) {
  throw new Error(`status filter mismatch: ${JSON.stringify(pendingUsers.rows)}`);
}

const cpfSearch = await asAuthenticated(authUsers.admin, () => database.query(`
  select id, cpf_mascarado
  from public.listar_usuarios(null, null, '00000000004');
`));
if (cpfSearch.rows.length !== 1 || cpfSearch.rows[0].cpf_mascarado !== "***.***.***-04") {
  throw new Error(`CPF search filter mismatch: ${JSON.stringify(cpfSearch.rows)}`);
}

const rhUsers = await asAuthenticated(authUsers.rh, () => database.query(`
  select id
  from public.listar_usuarios(null, null, null);
`));
if (rhUsers.rows.length !== 8) {
  throw new Error(`approved RH administrative access mismatch: ${JSON.stringify(rhUsers.rows)}`);
}

const authorizationStates = await database.query(`
  select id, status_usuario, papel_usuario
  from public.perfis
  where id in (
    '${authUsers.manager}',
    '${authUsers.reader}',
    '${authUsers.pendingRhRole}'
  )
  order by id;
`);
if (authorizationStates.rows.some((row) => row.status_usuario !== "APROVADO")) {
  throw new Error(`approval/block/reactivation mismatch: ${JSON.stringify(authorizationStates.rows)}`);
}

const blockFunction = await database.query(`
  select pg_get_functiondef('private.bloquear_usuario_impl(uuid)'::regprocedure) as definition;
`);
if (!blockFunction.rows[0].definition.includes("pg_advisory_xact_lock(824202609, 1)")) {
  throw new Error("admin block RPC is missing its transaction-scoped concurrency lock");
}

const triggerFunctions = await database.query(`
  select count(*)::integer as protected_triggers
  from pg_trigger
  where tgrelid = 'public.perfis'::regclass
    and not tgisinternal
    and tgname in ('perfis_admin_mutation_lock', 'perfis_preserve_last_approved_admin');
`);
if (triggerFunctions.rows[0].protected_triggers !== 2) {
  throw new Error(`last-admin mutation triggers missing: ${JSON.stringify(triggerFunctions.rows[0])}`);
}

const privateFunctionGrants = await database.query(`
  select has_function_privilege('authenticated', 'private.assert_active_admin_remains(uuid)', 'EXECUTE') as helper_exposed,
         has_function_privilege('anon', 'private.assert_active_admin_remains(uuid)', 'EXECUTE') as anon_helper_exposed;
`);
if (privateFunctionGrants.rows[0].helper_exposed || privateFunctionGrants.rows[0].anon_helper_exposed) {
  throw new Error(`last-admin helper execute privilege expanded: ${JSON.stringify(privateFunctionGrants.rows[0])}`);
}

await expectAuthenticatedFailure(
  "RH cannot read daily call",
  authUsers.rh,
  `select public.ler_chamada_diaria('2026-09-21', '2026-09-01', '2026-09-30');`,
);
await expectAuthenticatedFailure(
  "blocked ADMIN cannot read daily call",
  authUsers.secondAdmin,
  `select public.ler_chamada_diaria('2026-09-21', '2026-09-01', '2026-09-30');`,
);
await expectAuthenticatedFailure(
  "invalid period cannot read daily call",
  authUsers.admin,
  `select public.ler_chamada_diaria('2026-09-21', '2026-09-30', '2026-09-01');`,
);

const dailyCall = await asAuthenticated(authUsers.admin, () => database.query(`
  select public.ler_chamada_diaria('2026-09-21', '2026-09-01', '2026-09-30') as snapshot;
`));
const snapshot = dailyCall.rows[0].snapshot;
if (
  snapshot.employees.length !== 1
  || snapshot.employees[0].balanceDays !== 3
  || snapshot.employees[0].usedCompensationDays !== 1
  || snapshot.employees[0].pendingCompensationDays !== 2
  || snapshot.employees[0].attendance.length !== 3
  || JSON.stringify(snapshot).includes("cpf")
) throw new Error("daily call read contract mismatch");

const beforeBaseline = await asAuthenticated(authUsers.admin, () => database.query(`
  select public.ler_chamada_diaria('2026-09-12', '2026-09-01', '2026-09-12') as snapshot;
`));
if (beforeBaseline.rows[0].snapshot.employees[0].balanceMinutes !== null) {
  throw new Error("future measurement leaked into past date");
}

// Fictitious population matrix: no manager or bank extract may hide an eligible employee.
await database.exec(`
  insert into public.colaboradores (matricula, nome, unidade_id, situacao, admissao)
  select v.matricula, v.nome, u.id, v.situacao::public.situacao_colaborador, '2026-09-01'
  from (values
    ('FICT-ACTIVE', 'Active Fictitious', 'ATIVO'),
    ('FICT-VACATION', 'Vacation Fictitious', 'FERIAS'),
    ('FICT-NEW', 'New Hire Fictitious', 'NOVO_ADMITIDO'),
    ('FICT-LEAVE', 'Leave Fictitious', 'AFASTADO'),
    ('FICT-NOTICE', 'Notice Fictitious', 'AVISO_PREVIO'),
    ('FICT-MATERNITY', 'Maternity Fictitious', 'LICENCA_MATERNIDADE'),
    ('FICT-ACCIDENT', 'Accident Fictitious', 'ACIDENTE_TRABALHO'),
    ('FICT-OTHER', 'Other Leave Fictitious', 'OUTRO_AFASTAMENTO')
  ) as v(matricula, nome, situacao)
  cross join public.unidades u
  where u.codigo = 'CD FLV';
`);
const measuredPopulation = await database.query(`
  select matricula, gestor_id from public.vw_colaboradores_mensurados
  where matricula like 'FICT-%' order by matricula;
`);
const expectedPopulation = ['FICT-001', 'FICT-ACTIVE', 'FICT-NEW', 'FICT-VACATION'];
if (
  JSON.stringify(measuredPopulation.rows.map((row) => row.matricula)) !== JSON.stringify(expectedPopulation)
  || measuredPopulation.rows.slice(1).some((row) => row.gestor_id !== null)
) throw new Error(`daily call view population mismatch: ${JSON.stringify(measuredPopulation.rows)}`);
const populationRpc = await asAuthenticated(authUsers.admin, () => database.query(`
  select public.ler_chamada_diaria('2026-09-21', '2026-09-01', '2026-09-30') as snapshot;
`));
const populationEmployees = populationRpc.rows[0].snapshot.employees;
if (
  JSON.stringify(populationEmployees.map((employee) => employee.employeeNumber).sort()) !== JSON.stringify(expectedPopulation)
  || populationEmployees.filter((employee) => employee.employeeNumber !== 'FICT-001').some(
    (employee) => employee.manager !== null || employee.balanceMinutes !== null,
  )
) throw new Error('daily call RPC population or optional joins mismatch');

const dailyCallGrants = await database.query(`
  select has_function_privilege('anon', 'public.ler_chamada_diaria(date,date,date)', 'EXECUTE') as anon_execute,
         has_function_privilege('authenticated', 'public.ler_chamada_diaria(date,date,date)', 'EXECUTE') as authenticated_execute,
         has_table_privilege('authenticated', 'public.chamada_diaria', 'INSERT') as attendance_insert,
         has_table_privilege('authenticated', 'public.chamada_diaria', 'UPDATE') as attendance_update,
         has_table_privilege('authenticated', 'public.chamada_diaria', 'DELETE') as attendance_delete;
`);
if (
  dailyCallGrants.rows[0].anon_execute
  || !dailyCallGrants.rows[0].authenticated_execute
  || dailyCallGrants.rows[0].attendance_insert
  || dailyCallGrants.rows[0].attendance_update
  || dailyCallGrants.rows[0].attendance_delete
) throw new Error("daily call privileges expanded unexpectedly");

const cycles = await database.query(`
  select aplica_a_partir_de, dias_g_ciclo, dias_pendentes_compensar, situacao_banco
  from public.vw_banco_horas_ciclos
  order by aplica_a_partir_de;
`);

const referenceUnits = await database.query(`
  select codigo, nome, ativo
  from public.unidades
  order by codigo;
`);

const expectedReferenceUnits = [
  { codigo: "CD FLV", nome: "CD FLV", ativo: true },
  { codigo: "CD I", nome: "CD I", ativo: true },
  { codigo: "CD II", nome: "CD II", ativo: true },
];

if (JSON.stringify(referenceUnits.rows) !== JSON.stringify(expectedReferenceUnits)) {
  throw new Error(`reference units mismatch: ${JSON.stringify(referenceUnits.rows)}`);
}

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
      'banco_horas_medicoes', 'chamada_diaria', 'perfis'
    )
    and relrowsecurity;
`);

if (rls.rows[0].protected_tables !== 7) {
  throw new Error(`RLS mismatch: ${JSON.stringify(rls.rows[0])}`);
}

const policies = await database.query(`
  select tablename, policyname, cmd, roles
  from pg_policies
  where schemaname = 'public'
  order by tablename, policyname;
`);
const expectedPolicies = [
  { tablename: "perfis", policyname: "perfis_select_proprio", cmd: "SELECT", roles: ["authenticated"] },
];
if (JSON.stringify(policies.rows) !== JSON.stringify(expectedPolicies)) {
  throw new Error(`RLS policies mismatch: ${JSON.stringify(policies.rows)}`);
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
  referenceUnitsVerified: referenceUnits.rows,
  constraintsVerified: 4,
  approvedAdminsRemainingAfterBlockTest: remainingAdmins.rows[0].count,
  lastAdminTriggersVerified: triggerFunctions.rows[0].protected_triggers,
  filtersVerified: { pendingUsers: pendingUsers.rows.length, cpfSearch: cpfSearch.rows.length },
  adminAndRhListAccessVerified: { adminUsers: administrativeUsers.rows.length, rhUsers: rhUsers.rows.length },
  baselineCyclesVerified: normalizedCycles,
  rlsTablesVerified: rls.rows[0].protected_tables,
  policiesVerified: policies.rows,
  exposedGrantsVerified: exposedGrants.rows[0].grant_count,
  securityInvokerViewsVerified: secureViews.rows[0].secure_views,
  missingForeignKeyIndexes: missingForeignKeyIndexes.rows.length,
}, null, 2));

await database.close();
