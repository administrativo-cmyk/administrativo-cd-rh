create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create type public.situacao_colaborador as enum (
  'ATIVO',
  'FERIAS',
  'NOVO_ADMITIDO',
  'AFASTADO',
  'DESLIGADO',
  'AVISO_PREVIO',
  'LICENCA_MATERNIDADE',
  'ACIDENTE_TRABALHO',
  'OUTRO_AFASTAMENTO'
);

create type public.tipo_importacao as enum (
  'EXCEL',
  'GOOGLE_SHEETS',
  'OUTRO'
);

create type public.status_importacao as enum (
  'PENDENTE',
  'PROCESSANDO',
  'CONCLUIDO',
  'CONCLUIDO_COM_ERROS',
  'FALHOU'
);

create or replace function private.definir_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.definir_updated_at() from public, anon, authenticated;

create table public.unidades (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unidades_codigo_unique unique (codigo),
  constraint unidades_codigo_not_blank check (btrim(codigo) <> ''),
  constraint unidades_nome_not_blank check (btrim(nome) <> '')
);

create table public.gestores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  unidade_referencia_id uuid references public.unidades(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gestores_nome_not_blank check (btrim(nome) <> '')
);

create table public.lotes_importacao (
  id uuid primary key default gen_random_uuid(),
  tipo public.tipo_importacao not null,
  fonte text,
  nome_arquivo text,
  data_referencia date,
  status public.status_importacao not null default 'PENDENTE',
  registros_processados integer not null default 0,
  registros_com_erro integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint lotes_importacao_registros_processados_nonnegative check (registros_processados >= 0),
  constraint lotes_importacao_registros_com_erro_nonnegative check (registros_com_erro >= 0)
);

create table public.colaboradores (
  id uuid primary key default gen_random_uuid(),
  matricula text not null,
  nome text not null,
  unidade_id uuid not null references public.unidades(id) on delete restrict,
  gestor_id uuid references public.gestores(id) on delete set null,
  setor text,
  funcao text,
  situacao public.situacao_colaborador not null default 'ATIVO',
  categoria text,
  admissao date,
  movimento text,
  jornada_horas_dia_atual numeric(6, 4) not null default 7.3333,
  ativo_no_sistema boolean not null default true,
  observacao text,
  ultimo_lote_importacao_id uuid references public.lotes_importacao(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint colaboradores_matricula_unique unique (matricula),
  constraint colaboradores_matricula_not_blank check (btrim(matricula) <> ''),
  constraint colaboradores_nome_not_blank check (btrim(nome) <> ''),
  constraint colaboradores_jornada_valida check (jornada_horas_dia_atual > 0 and jornada_horas_dia_atual <= 24)
);

create trigger unidades_definir_updated_at
before update on public.unidades
for each row execute function private.definir_updated_at();

create trigger gestores_definir_updated_at
before update on public.gestores
for each row execute function private.definir_updated_at();

create trigger colaboradores_definir_updated_at
before update on public.colaboradores
for each row execute function private.definir_updated_at();
