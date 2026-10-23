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
  insert into public.gestores (id, nome) values
    ('20000000-0000-0000-0000-000000000001', 'Gestor A Ficticio'),
    ('20000000-0000-0000-0000-000000000002', 'Gestor B Ficticio');

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
  managerB: "10000000-0000-0000-0000-000000000009",
  unlinkedManager: "10000000-0000-0000-0000-000000000010",
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
    ('${authUsers.secondAdmin}', encode(sha256(convert_to('00000000008', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid', '{"nome_completo":"Segundo Admin","cpf_normalizado":"00000000008"}'),
    ('${authUsers.managerB}', encode(sha256(convert_to('00000000009', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid', '{"nome_completo":"Gestor B Local","cpf_normalizado":"00000000009"}'),
    ('${authUsers.unlinkedManager}', encode(sha256(convert_to('00000000010', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid', '{"nome_completo":"Gestor Legado","cpf_normalizado":"00000000010"}');

  update public.perfis
  set status_usuario = 'APROVADO', papel_usuario = 'ADMIN', aprovado_em = now()
  where id = '${authUsers.admin}';

  update public.perfis
  set status_usuario = 'APROVADO', papel_usuario = 'RH', aprovado_em = now()
  where id = '${authUsers.rh}';

  update public.perfis
  set status_usuario = 'APROVADO', papel_usuario = 'GESTOR',
      gestor_id = '20000000-0000-0000-0000-000000000002', aprovado_em = now()
  where id = '${authUsers.managerB}';

  -- Simulates a legacy approved GESTOR without a link; access must fail closed.
  update public.perfis
  set status_usuario = 'APROVADO', papel_usuario = 'GESTOR', aprovado_em = now()
  where id = '${authUsers.unlinkedManager}';
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

await expectAuthenticatedFailure(
  "manager approval requires a manager link",
  authUsers.rh,
  `select public.aprovar_usuario('${authUsers.manager}', 'GESTOR', null);`,
);

await asAuthenticated(authUsers.rh, () => database.exec(`
  select public.aprovar_usuario('${authUsers.manager}', 'GESTOR', '20000000-0000-0000-0000-000000000001');
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
  administrativeUsers.rows.length !== 10
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
if (rhUsers.rows.length !== 10) {
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
  JSON.stringify(populationEmployees.map((employee) => employee.employeeNumber).sort()) !== JSON.stringify([...expectedPopulation, 'FICT-LEAVE', 'FICT-NOTICE', 'FICT-MATERNITY', 'FICT-ACCIDENT', 'FICT-OTHER'].sort())
  || populationEmployees.filter((employee) => employee.employeeNumber !== 'FICT-001').some(
    (employee) => employee.manager !== null || employee.balanceMinutes !== null,
  )
) throw new Error('daily call RPC population or optional joins mismatch');

const teamAEmployee = '30000000-0000-0000-0000-000000000001';
const teamBEmployee = '30000000-0000-0000-0000-000000000002';
await database.exec(`
  insert into public.colaboradores (id, matricula, nome, unidade_id, gestor_id, situacao)
  values ('${teamBEmployee}', 'FICT-B', 'Team B Fictitious',
    (select id from public.unidades where codigo = 'CD II'),
    '20000000-0000-0000-0000-000000000002', 'ATIVO');
`);
const readCall = async (actor) => (await asAuthenticated(actor, () => database.query(`
  select public.ler_chamada_diaria('2026-09-21', '2026-09-01', '2026-09-30') as snapshot;
`))).rows[0].snapshot.employees;
const fullPopulation = [authUsers.admin, authUsers.rh, authUsers.reader];
for (const actor of fullPopulation) {
  const rows = await readCall(actor);
  if (rows.length !== 10 || !rows.some((row) => row.id === teamAEmployee)
      || !rows.some((row) => row.id === teamBEmployee)
      || !rows.some((row) => row.manager === null)) {
    throw new Error('ADMIN/RH/LEITURA read scope mismatch');
  }
}
for (const [actor, employee] of [[authUsers.manager, teamAEmployee], [authUsers.managerB, teamBEmployee]]) {
  const rows = await readCall(actor);
  if (rows.length !== 1 || rows[0].id !== employee) throw new Error('GESTOR team read scope mismatch');
}
if ((await readCall(authUsers.unlinkedManager)).length !== 0) {
  throw new Error('unlinked GESTOR obtained employees');
}
await expectAuthenticatedFailure('pending cannot read daily call', authUsers.pendingAdminRole,
  `select public.ler_chamada_diaria('2026-09-21', '2026-09-01', '2026-09-30');`);
await expectAuthenticatedFailure('anon cannot read daily call', authUsers.selfPending,
  `set role anon; select public.ler_chamada_diaria('2026-09-21', '2026-09-01', '2026-09-30'); reset role;`);
await database.exec('reset role;');

const readWorkforce = async (actor) => (await asAuthenticated(actor, () => database.query(`
  select public.ler_quadro_atual() as snapshot;
`))).rows[0].snapshot.employees;
for (const actor of [authUsers.admin, authUsers.rh, authUsers.reader]) {
  const rows = await readWorkforce(actor);
  if (rows.length !== 10 || rows.filter((row) => row.managerId === null).length !== 8
      || rows.filter((row) => row.bankBalanceMinutes === null).length !== 9
      || !rows.some((row) => row.situation === 'AFASTADO')
      || !rows.some((row) => row.id === teamAEmployee)
      || !rows.some((row) => row.id === teamBEmployee)) {
    throw new Error('global workforce read scope or complete population mismatch');
  }
}
for (const [actor, ownEmployee, otherEmployee] of [
  [authUsers.manager, teamAEmployee, teamBEmployee],
  [authUsers.managerB, teamBEmployee, teamAEmployee],
]) {
  const rows = await readWorkforce(actor);
  if (rows.length !== 1 || rows[0].id !== ownEmployee || rows.some((row) => row.id === otherEmployee)) {
    throw new Error('GESTOR workforce isolation mismatch');
  }
}
if ((await readWorkforce(authUsers.unlinkedManager)).length !== 0) {
  throw new Error('unlinked GESTOR obtained workforce rows');
}
await expectAuthenticatedFailure('pending cannot read workforce', authUsers.pendingAdminRole,
  'select public.ler_quadro_atual();');
await expectFailure('anon cannot read workforce', `
  set role anon; select public.ler_quadro_atual(); reset role;
`);
await database.exec('reset role;');
const workforceGrants = await database.query(`
  select has_function_privilege('anon', 'public.ler_quadro_atual()', 'EXECUTE') as anon_execute,
         has_function_privilege('authenticated', 'public.ler_quadro_atual()', 'EXECUTE') as authenticated_execute,
         has_table_privilege('authenticated', 'public.colaboradores', 'SELECT') as direct_employee_read;
`);
if (workforceGrants.rows[0].anon_execute || !workforceGrants.rows[0].authenticated_execute
    || workforceGrants.rows[0].direct_employee_read) {
  throw new Error('workforce read privileges expanded unexpectedly');
}

const readTimeBank = async (actor, date = '2026-09-21') => (await asAuthenticated(actor, () => database.query(`
  select public.ler_banco_horas_atual('${date}') as snapshot;
`))).rows[0].snapshot;
for (const actor of [authUsers.admin, authUsers.rh, authUsers.reader]) {
  const snapshot = await readTimeBank(actor);
  const rows = snapshot.employees;
  if (snapshot.asOfDate !== '2026-09-21' || rows.length !== 10
      || rows.filter((row) => row.managerId === null).length !== 8
      || rows.filter((row) => row.measuredMinutes === null).length !== 9
      || !rows.some((row) => row.situation === 'AFASTADO')
      || !rows.some((row) => row.id === teamAEmployee)
      || !rows.some((row) => row.id === teamBEmployee)) {
    throw new Error('global time-bank read scope or full-population mismatch');
  }
}
for (const [actor, ownEmployee, otherEmployee] of [
  [authUsers.manager, teamAEmployee, teamBEmployee],
  [authUsers.managerB, teamBEmployee, teamAEmployee],
]) {
  const rows = (await readTimeBank(actor)).employees;
  if (rows.length !== 1 || rows[0].id !== ownEmployee
      || rows.some((row) => row.id === otherEmployee)) {
    throw new Error('GESTOR time-bank isolation mismatch');
  }
}
if ((await readTimeBank(authUsers.unlinkedManager)).employees.length !== 0) {
  throw new Error('unlinked GESTOR obtained time-bank rows');
}
const scopedBank = (await readTimeBank(authUsers.manager)).employees[0];
const scopedCall = (await readCall(authUsers.manager))[0];
if (scopedBank.measuredMinutes !== scopedCall.balanceMinutes
    || scopedBank.measuredDays !== scopedCall.balanceDays
    || scopedBank.usedCompensationDays !== scopedCall.usedCompensationDays
    || scopedBank.pendingCompensationDays !== scopedCall.pendingCompensationDays
    || scopedBank.replacementDays !== scopedCall.replacementDays) {
  throw new Error('time-bank and Daily Call differ for same employee and date');
}
await expectAuthenticatedFailure('pending cannot read time bank', authUsers.pendingAdminRole,
  "select public.ler_banco_horas_atual('2026-09-21');");
await expectFailure('anon cannot read time bank', `
  set role anon; select public.ler_banco_horas_atual('2026-09-21'); reset role;
`);
await database.exec('reset role;');
const timeBankGrants = await database.query(`
  select has_function_privilege('anon', 'public.ler_banco_horas_atual(date)', 'EXECUTE') as anon_execute,
         has_function_privilege('authenticated', 'public.ler_banco_horas_atual(date)', 'EXECUTE') as authenticated_execute,
         has_function_privilege('authenticated', 'private.banco_horas_no_dia(uuid,date)', 'EXECUTE') as direct_helper_execute,
         has_table_privilege('authenticated', 'public.banco_horas_medicoes', 'SELECT') as direct_measurement_read;
`);
if (timeBankGrants.rows[0].anon_execute || !timeBankGrants.rows[0].authenticated_execute
    || timeBankGrants.rows[0].direct_helper_execute || timeBankGrants.rows[0].direct_measurement_read) {
  throw new Error('time-bank read privileges expanded unexpectedly');
}

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

const conversionBoundaries = await database.query(`
  select private.converter_saldo_minutos_em_dias(0, 7.3333) as zero,
         private.converter_saldo_minutos_em_dias(440, 7.3333) as one_day,
         private.converter_saldo_minutos_em_dias(740, 7.3333) as exact_five_hours,
         private.converter_saldo_minutos_em_dias(741, 7.3333) as five_hours_one_minute,
         private.converter_saldo_minutos_em_dias(-740, 7.3333) as negative_exact,
         private.converter_saldo_minutos_em_dias(-741, 7.3333) as negative_over,
         private.converter_saldo_minutos_em_dias(240, 4) as four_hour_day,
         private.converter_saldo_minutos_em_dias(360, 6) as six_hour_day,
         private.converter_saldo_minutos_em_dias(720, 12) as twelve_hour_day;
`);
const expectedConversions = {
  zero: 0, one_day: 1, exact_five_hours: 1, five_hours_one_minute: 2,
  negative_exact: -1, negative_over: -2, four_hour_day: 1,
  six_hour_day: 1, twelve_hour_day: 1,
};
if (JSON.stringify(conversionBoundaries.rows[0]) !== JSON.stringify(expectedConversions)) {
  throw new Error('signed-minute conversion boundary mismatch');
}

const rls = await database.query(`
  select count(*)::integer as protected_tables
  from pg_class
  where relnamespace = 'public'::regnamespace
    and relname in (
      'unidades', 'gestores', 'lotes_importacao', 'colaboradores',
      'banco_horas_medicoes', 'chamada_diaria', 'chamada_diaria_auditoria', 'perfis'
    )
    and relrowsecurity;
`);

if (rls.rows[0].protected_tables !== 8) {
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

// All writes below run only in this disposable in-memory PGlite instance.
const writeEmployee = "30000000-0000-0000-0000-000000000001";
const sqlLiteral = (value) => value === null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const saveCall = (actor, date, status, observation = null, version = null, employee = writeEmployee) =>
  asAuthenticated(actor, async () => (await database.query(`
    select public.salvar_chamada_diaria(
      '${employee}', '${date}', ${sqlLiteral(status)}::public.codigo_chamada,
      ${sqlLiteral(observation)}, ${sqlLiteral(version)}::timestamptz
    ) as result;
  `)).rows[0].result);
const writeDate = "2026-10-06";
let saved = await saveCall(authUsers.admin, writeDate, "P");
if (!saved.changed || saved.record.status !== "P" || !saved.record.updatedAt) {
  throw new Error(`ADMIN insert failed: ${JSON.stringify(saved)}`);
}
let version = saved.record.updatedAt;
saved = await saveCall(authUsers.admin, writeDate, "P", null, version);
if (saved.changed) throw new Error("identical save was not idempotent");
saved = await saveCall(authUsers.admin, writeDate, "F", "  texto <especial>  ", version);
if (saved.record.status !== "F" || saved.record.observation !== "texto <especial>" || saved.record.updatedAt === version) {
  throw new Error(`ADMIN update/trim/version failed: ${JSON.stringify(saved)}`);
}
await expectAuthenticatedFailure("stale write", authUsers.admin, `
  select public.salvar_chamada_diaria('${writeEmployee}', '${writeDate}', 'G', null, '${version}');
`);
version = saved.record.updatedAt;
saved = await saveCall(authUsers.admin, writeDate, null, null, version);
if (!saved.changed || saved.record !== null) throw new Error("ADMIN clear failed");
const written = await database.query(`
  select (select count(*)::integer from public.chamada_diaria where colaborador_id = '${writeEmployee}' and data = '${writeDate}') as current_count,
         (select string_agg(operacao, ',' order by alterado_em) from public.chamada_diaria_auditoria where colaborador_id = '${writeEmployee}' and data = '${writeDate}') as operations,
         (select bool_and(alterado_por = '${authUsers.admin}'::uuid) from public.chamada_diaria_auditoria where colaborador_id = '${writeEmployee}' and data = '${writeDate}') as attributed;
`);
if (written.rows[0].current_count !== 0 || written.rows[0].operations !== "INSERT,UPDATE,CLEAR" || !written.rows[0].attributed) {
  throw new Error(`audit or clear mismatch: ${JSON.stringify(written.rows[0])}`);
}

for (const [label, actor] of [
  ["pending", authUsers.pendingAdminRole], ["blocked", authUsers.secondAdmin],
  ["GESTOR without link", authUsers.unlinkedManager], ["LEITURA", authUsers.reader],
]) {
  await expectAuthenticatedFailure(`${label} cannot write daily call`, actor, `
    select public.salvar_chamada_diaria('${writeEmployee}', '${writeDate}', 'P', null, null);
  `);
}
await expectAuthenticatedFailure('cross-team UUID by GESTOR A', authUsers.manager, `
  select public.salvar_chamada_diaria('${teamBEmployee}', '2026-10-15', 'P', null, null);
`);
await expectAuthenticatedFailure('cross-team UUID by GESTOR B', authUsers.managerB, `
  select public.salvar_chamada_diaria('${teamAEmployee}', '2026-10-15', 'P', null, null);
`);
await expectAuthenticatedFailure('cross-team observation by GESTOR A', authUsers.manager, `
  select public.salvar_chamada_diaria('${teamBEmployee}', '2026-10-15', 'P', 'observacao indevida', null);
`);
const rhSave = await saveCall(authUsers.rh, '2026-10-15', 'P', 'RH ficticio', null, teamBEmployee);
const managerSave = await saveCall(authUsers.manager, '2026-10-15', 'G', null, null, teamAEmployee);
const managerBSave = await saveCall(authUsers.managerB, '2026-10-16', 'P', null, null, teamBEmployee);
const adminOtherTeam = await saveCall(authUsers.admin, '2026-10-17', 'P', null, null, teamBEmployee);
if (!rhSave.changed || !managerSave.changed || !managerBSave.changed || !adminOtherTeam.changed) {
  throw new Error('ADMIN/RH/GESTOR write matrix mismatch');
}
await expectAuthenticatedFailure('cross-team clear by GESTOR A', authUsers.manager, `
  select public.salvar_chamada_diaria('${teamBEmployee}', '2026-10-16', null, null, '${managerBSave.record.updatedAt}');
`);
await saveCall(authUsers.rh, '2026-10-15', null, null, rhSave.record.updatedAt, teamBEmployee);
await saveCall(authUsers.manager, '2026-10-15', null, null, managerSave.record.updatedAt, teamAEmployee);
const roleAudit = await database.query(`
  select alterado_por::text as actor, count(*)::integer as count
  from public.chamada_diaria_auditoria where data between '2026-10-15' and '2026-10-17'
  group by alterado_por order by actor;
`);
if (roleAudit.rows.length !== 4 || roleAudit.rows.some((row) => row.count < 1)
    || roleAudit.rows.some((row) => row.actor === authUsers.reader)) {
  throw new Error('role write audit attribution mismatch');
}
await expectFailure("anon cannot execute write RPC", `
  set role anon;
  select public.salvar_chamada_diaria('${writeEmployee}', '${writeDate}', 'P', null, null);
  reset role;
`);
await database.exec("reset role;");
await expectAuthenticatedFailure("invalid attendance code", authUsers.admin, `
  select public.salvar_chamada_diaria('${writeEmployee}', '${writeDate}', 'ZZ'::public.codigo_chamada, null, null);
`);
await expectAuthenticatedFailure("observation without status", authUsers.admin, `
  select public.salvar_chamada_diaria('${writeEmployee}', '${writeDate}', null, 'sem status', null);
`);
await expectAuthenticatedFailure("observation too long", authUsers.admin, `
  select public.salvar_chamada_diaria('${writeEmployee}', '${writeDate}', 'P', repeat('a', 501), null);
`);
await expectAuthenticatedFailure("non-operational employee", authUsers.admin, `
  select public.salvar_chamada_diaria('30000000-0000-0000-0000-000000000099', '${writeDate}', 'P', null, null);
`);
await database.exec(`
  insert into public.colaboradores (id, matricula, nome, unidade_id, situacao)
  values ('30000000-0000-0000-0000-000000000099', 'FICT-OUT', 'Excluded Fictitious',
    (select id from public.unidades where codigo = 'CD FLV'), 'DESLIGADO');
`);
await expectAuthenticatedFailure("excluded employee", authUsers.admin, `
  select public.salvar_chamada_diaria('30000000-0000-0000-0000-000000000099', '${writeDate}', 'P', null, null);
`);
version = null;
for (const code of ["P", "F", "A", "I", "B", "X", "H", "G", "D", "AF"]) {
  const result = await saveCall(authUsers.admin, writeDate, code, null, version);
  if (result.record.status !== code) throw new Error(`attendance code ${code} was not saved`);
  version = result.record.updatedAt;
}
const codeCount = await database.query(`
  select count(*)::integer as count from public.chamada_diaria
  where colaborador_id = '${writeEmployee}' and data = '${writeDate}';
`);
if (codeCount.rows[0].count !== 1) throw new Error("upsert created duplicate current rows");
const auditGrants = await database.query(`
  select has_table_privilege('authenticated', 'public.chamada_diaria_auditoria', 'SELECT') as audit_read,
    has_table_privilege('authenticated', 'public.chamada_diaria_auditoria', 'INSERT') as audit_insert,
    has_table_privilege('authenticated', 'public.chamada_diaria', 'INSERT') as direct_insert,
    has_function_privilege('anon', 'public.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamptz)', 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', 'public.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamptz)', 'EXECUTE') as authenticated_execute;
`);
if (auditGrants.rows[0].audit_read || auditGrants.rows[0].audit_insert || auditGrants.rows[0].direct_insert
    || auditGrants.rows[0].anon_execute || !auditGrants.rows[0].authenticated_execute) {
  throw new Error(`daily call write grants expanded: ${JSON.stringify(auditGrants.rows[0])}`);
}

const readBank = async (employee, date) => {
  const result = await asAuthenticated(authUsers.admin, () => database.query(`
    select public.ler_chamada_diaria('${date}', '${date.slice(0, 7)}-01', '${date.slice(0, 7)}-31') as snapshot;
  `));
  return result.rows[0].snapshot.employees.find((row) => row.id === employee);
};
let g1 = await saveCall(authUsers.admin, "2026-10-07", "G");
let bank = await readBank(writeEmployee, "2026-10-08");
if (bank.pendingCompensationDays !== 1 || bank.usedCompensationDays !== 2) throw new Error("first G did not reduce pending balance");
let g2 = await saveCall(authUsers.admin, "2026-10-08", "G");
bank = await readBank(writeEmployee, "2026-10-08");
if (bank.pendingCompensationDays !== 0 || bank.usedCompensationDays !== 3) throw new Error("second G did not reduce pending balance");
await saveCall(authUsers.admin, "2026-10-09", "G");
bank = await readBank(writeEmployee, "2026-10-09");
if (bank.pendingCompensationDays !== 0) throw new Error("G made pending balance negative");
await saveCall(authUsers.admin, "2026-10-08", "P", null, g2.record.updatedAt);
bank = await readBank(writeEmployee, "2026-10-08");
if (bank.pendingCompensationDays !== 1) throw new Error("editing G to P did not restore a day");
await saveCall(authUsers.admin, "2026-10-07", null, null, g1.record.updatedAt);
bank = await readBank(writeEmployee, "2026-10-08");
if (bank.pendingCompensationDays !== 2) throw new Error("clearing G did not restore a day");

const negativeId = "30000000-0000-0000-0000-000000000097";
const zeroId = "30000000-0000-0000-0000-000000000096";
await database.exec(`
  insert into public.colaboradores (id, matricula, nome, unidade_id, situacao)
  values ('${negativeId}', 'FICT-NEG', 'Negative Fictitious', (select id from public.unidades where codigo = 'CD I'), 'ATIVO'),
         ('${zeroId}', 'FICT-ZERO', 'Zero Fictitious', (select id from public.unidades where codigo = 'CD I'), 'FERIAS');
  insert into public.banco_horas_medicoes (colaborador_id, data_medicao, aplica_a_partir_de, jornada_horas_dia, saldo_minutos)
  values ('${negativeId}', '2026-09-28', '2026-09-28', 7.3333, -880),
         ('${zeroId}', '2026-09-28', '2026-09-28', 7.3333, 0);
`);
await saveCall(authUsers.admin, "2026-10-08", "G", null, null, negativeId);
await saveCall(authUsers.admin, "2026-10-08", "G", null, null, zeroId);
const negative = await readBank(negativeId, "2026-10-08");
const zero = await readBank(zeroId, "2026-10-08");
if (negative.replacementDays !== 2 || negative.pendingCompensationDays !== 0
    || zero.balanceMinutes !== 0 || zero.pendingCompensationDays !== 0) {
  throw new Error("G changed negative or zero balance semantics");
}
const bankAtCurrentCycle = (await readTimeBank(authUsers.admin, '2026-10-08')).employees;
for (const [employeeId, daily] of [
  [writeEmployee, await readBank(writeEmployee, '2026-10-08')],
  [negativeId, negative],
  [zeroId, zero],
  [teamBEmployee, await readBank(teamBEmployee, '2026-10-08')],
]) {
  const row = bankAtCurrentCycle.find((item) => item.id === employeeId);
  if (!row || row.measuredMinutes !== daily.balanceMinutes
      || row.measuredDays !== daily.balanceDays
      || row.usedCompensationDays !== daily.usedCompensationDays
      || row.pendingCompensationDays !== daily.pendingCompensationDays
      || row.replacementDays !== daily.replacementDays) {
    throw new Error('positive/negative/zero/no-extract bank and Daily Call mismatch');
  }
}
const positiveBank = bankAtCurrentCycle.find((row) => row.id === writeEmployee);
const negativeBank = bankAtCurrentCycle.find((row) => row.id === negativeId);
const zeroBank = bankAtCurrentCycle.find((row) => row.id === zeroId);
if (positiveBank.measuredMinutes !== 1320 || positiveBank.effectiveDays !== 2
    || negativeBank.measuredMinutes !== -880 || negativeBank.effectiveDays !== -2
    || zeroBank.measuredMinutes !== 0 || zeroBank.effectiveDays !== 0) {
  throw new Error('measured balance changed or G reduced negative/zero balance');
}
const historicalMeasurement = await database.query(`
  select saldo_minutos from public.banco_horas_medicoes
  where colaborador_id = '${negativeId}';
`);
if (historicalMeasurement.rows[0].saldo_minutos !== -880) {
  throw new Error('G modified the append-only historical measurement');
}
await database.exec(`
  insert into public.banco_horas_medicoes
    (colaborador_id, data_medicao, aplica_a_partir_de, jornada_horas_dia, saldo_minutos)
  values ('${writeEmployee}', '2026-10-10', '2026-10-10', 7.3333, 880);
`);
bank = await readBank(writeEmployee, "2026-10-11");
if (bank.pendingCompensationDays !== 2 || bank.usedCompensationDays !== 0) throw new Error("new baseline inherited old G");
await saveCall(authUsers.admin, "2026-10-11", "G");
bank = await readBank(writeEmployee, "2026-10-11");
if (bank.pendingCompensationDays !== 1 || bank.usedCompensationDays !== 1) throw new Error("new baseline G cycle mismatch");
const bankAfterNewBaseline = (await readTimeBank(authUsers.admin, '2026-10-11')).employees
  .find((row) => row.id === writeEmployee);
if (bankAfterNewBaseline.measuredMinutes !== 880 || bankAfterNewBaseline.measuredDays !== 2
    || bankAfterNewBaseline.usedCompensationDays !== 1
    || bankAfterNewBaseline.pendingCompensationDays !== bank.pendingCompensationDays
    || bankAfterNewBaseline.effectiveFrom !== '2026-10-10') {
  throw new Error('new baseline or G contaminated current time-bank cycle');
}

// Authorization must use the current manager relationship, not a stale UI snapshot.
await database.exec(`
  update public.colaboradores set gestor_id = '20000000-0000-0000-0000-000000000002'
  where id = '${teamAEmployee}';
`);
if ((await readCall(authUsers.manager)).length !== 0 || (await readCall(authUsers.managerB)).length !== 2) {
  throw new Error('manager reassignment did not update read scope');
}
await expectAuthenticatedFailure('old manager after reassignment', authUsers.manager, `
  select public.salvar_chamada_diaria('${teamAEmployee}', '2026-10-20', 'P', null, null);
`);
const transferred = await saveCall(authUsers.managerB, '2026-10-20', 'P', null, null, teamAEmployee);
if (!transferred.changed) throw new Error('new manager could not write after reassignment');

const managerOptions = await asAuthenticated(authUsers.admin, () => database.query(`
  select id, nome from public.listar_gestores_quadro();
`));
if (managerOptions.rows.length !== 2) throw new Error('manager option RPC mismatch');
await expectAuthenticatedFailure('GESTOR cannot list administrative manager options', authUsers.manager,
  'select * from public.listar_gestores_quadro();');
await expectAuthenticatedFailure('LEITURA cannot list administrative manager options', authUsers.reader,
  'select * from public.listar_gestores_quadro();');
await expectAuthenticatedFailure('GESTOR cannot link user manager', authUsers.manager, `
  select public.vincular_gestor_usuario('${authUsers.unlinkedManager}', '20000000-0000-0000-0000-000000000002');
`);
await expectAuthenticatedFailure('RH cannot link ADMIN target', authUsers.rh, `
  select public.vincular_gestor_usuario('${authUsers.admin}', '20000000-0000-0000-0000-000000000002');
`);
await asAuthenticated(authUsers.rh, () => database.exec(`select public.bloquear_usuario('${authUsers.unlinkedManager}');`));
await expectAuthenticatedFailure('unlinked blocked GESTOR cannot be reactivated', authUsers.rh, `
  select public.reativar_usuario('${authUsers.unlinkedManager}');
`);
await asAuthenticated(authUsers.rh, () => database.exec(`
  select public.vincular_gestor_usuario('${authUsers.unlinkedManager}', '20000000-0000-0000-0000-000000000002');
  select public.reativar_usuario('${authUsers.unlinkedManager}');
`));
if ((await readCall(authUsers.unlinkedManager)).length !== 2) {
  throw new Error('RH manager link did not update read scope');
}
await asAuthenticated(authUsers.admin, () => database.exec(`
  select public.vincular_gestor_usuario('${authUsers.unlinkedManager}', '20000000-0000-0000-0000-000000000001');
`));
if ((await readCall(authUsers.unlinkedManager)).length !== 0) {
  throw new Error('ADMIN manager relink did not immediately update read scope');
}
const linkAudit = await database.query(`
  select alterado_por::text as actor from private.perfis_gestor_auditoria
  where usuario_id = '${authUsers.unlinkedManager}' order by alterado_em;
`);
if (linkAudit.rows.length !== 2 || linkAudit.rows[0].actor !== authUsers.rh
    || linkAudit.rows[1].actor !== authUsers.admin) {
  throw new Error('manager-link audit attribution mismatch');
}

// Integrity regressions: direct authorized RPC calls must enforce the same
// domain as HTTP. Future finite dates remain valid for legitimate planning.
for (const invalidDate of ['infinity', '-infinity']) {
  await expectAuthenticatedFailure('non-finite attendance RPC', authUsers.admin, `
    select public.salvar_chamada_diaria('30000000-0000-0000-0000-000000000001', '${invalidDate}', 'P', null, null);
  `);
  await expectAuthenticatedFailure('non-finite read RPC', authUsers.admin, `
    select public.ler_chamada_diaria('${invalidDate}', '2026-10-01', '2026-10-31');
  `);
  await expectAuthenticatedFailure('non-finite bank RPC', authUsers.admin, `
    select public.ler_banco_horas_atual('${invalidDate}');
  `);
  await expectFailure('non-finite direct attendance', `
    insert into public.chamada_diaria(colaborador_id, data, status)
    values ('30000000-0000-0000-0000-000000000001', '${invalidDate}', 'P');
  `);
}
const futureCall = await saveCall(authUsers.admin, '2035-01-01', 'P');
if (!futureCall.changed) throw new Error('future finite planning date was rejected');
const outsidePeriod = await asAuthenticated(authUsers.admin, () => database.query(`
  select public.ler_chamada_diaria('2035-01-01', '2026-09-01', '2026-09-30') as snapshot;
`));
const futureEmployee = outsidePeriod.rows[0].snapshot.employees.find((row) => row.id === '30000000-0000-0000-0000-000000000001');
if (!futureEmployee.attendance.some((record) => record.date === '2035-01-01' && record.status === 'P')) {
  throw new Error('selected date outside the loaded period was omitted');
}
await expectFailure('baseline hash cannot be null', `
  insert into public.lotes_importacao(tipo, fonte, nome_arquivo, data_referencia, status, source_hash, started_at, completed_at)
  values ('EXCEL', 'BASELINE_RH', 'Banco de dados RH.xlsx', '2026-09-28', 'CONCLUIDO', null, now(), now());
`);
await expectFailure('baseline incomplete state cannot impersonate completion', `
  insert into public.lotes_importacao(tipo, fonte, nome_arquivo, data_referencia, status, source_hash, started_at, completed_at)
  values ('EXCEL', 'BASELINE_RH', 'Banco de dados RH.xlsx', '2026-09-28', 'PROCESSANDO', repeat('A', 64), now(), now());
`);
for (const search of ['000000', '04', 'prefix00000000004']) {
  const partialCpf = await asAuthenticated(authUsers.admin, () => database.query(`
    select id from public.listar_usuarios(null, null, '${search}');
  `));
  if (partialCpf.rows.length) throw new Error('partial CPF search disclosed a masked identifier');
}
const formattedCpf = await asAuthenticated(authUsers.admin, () => database.query(`
  select id from public.listar_usuarios(null, null, '000.000.000-04');
`));
if (formattedCpf.rows.length !== 1) throw new Error('exact formatted CPF search failed');

// Monitoring has its own fixtures and transaction; run alongside base checks.
const monitoringTests = path.resolve('supabase/tests/monitoring.sql');
try {
  const monitoringSql = await readFile(monitoringTests, 'utf8');
  await database.exec(monitoringSql);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

// Payroll options come from actual attendance and retain the reader's team scope.
await database.exec("begin");
try {
  await database.exec(`
    insert into public.colaboradores (id,matricula,nome,unidade_id,gestor_id,situacao) values
      ('30000000-0000-4000-8000-000000000091','PAYROLL-A','Payroll A',(select id from public.unidades where codigo='CD I'),'20000000-0000-0000-0000-000000000001','ATIVO'),
      ('30000000-0000-4000-8000-000000000092','PAYROLL-B','Payroll B',(select id from public.unidades where codigo='CD I'),'20000000-0000-0000-0000-000000000002','ATIVO');
    insert into public.chamada_diaria(colaborador_id,data,status) values
      ('30000000-0000-4000-8000-000000000091','2035-01-20','P'),
      ('30000000-0000-4000-8000-000000000091','2035-01-21','P'),
      ('30000000-0000-4000-8000-000000000091','2035-01-22','P'),
      ('30000000-0000-4000-8000-000000000092','2035-06-21','P');
  `);
  const periodsFor = async actor => (await asAuthenticated(actor, () => database.query(`
    select public.daily_call_read('2026-10-23','2026-10-21','2026-11-20') as snapshot;
  `))).rows[0].snapshot.payrollPeriods;
  const adminPeriods = await periodsFor(authUsers.admin);
  const managerPeriods = await periodsFor(authUsers.manager);
  if (!adminPeriods.includes('2035-07') || !managerPeriods.includes('2035-01') || !managerPeriods.includes('2035-02')
      || managerPeriods.includes('2035-07') || adminPeriods.includes('2035-03')
      || new Set(adminPeriods).size !== adminPeriods.length) throw new Error('payroll period data/scope mismatch');
  await database.exec(`update public.perfis set gestor_id=null where id='${authUsers.unlinkedManager}';`);
  if ((await periodsFor(authUsers.unlinkedManager)).length) throw new Error('unlinked manager obtained payroll periods');
  await expectAuthenticatedFailure('pending cannot read payroll periods',authUsers.pendingAdminRole,
    `select public.daily_call_read('2026-10-23','2026-10-21','2026-11-20');`);
} finally { await database.exec("rollback"); }

console.log(JSON.stringify({
  migrationsApplied: migrations.length,
  integrityRegressionsVerified: true,
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
