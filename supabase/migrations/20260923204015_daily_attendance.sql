create type public.codigo_chamada as enum (
  'P',
  'F',
  'A',
  'I',
  'B',
  'X',
  'H',
  'G',
  'D',
  'AF'
);

create table public.chamada_diaria (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references public.colaboradores(id) on delete restrict,
  data date not null,
  status public.codigo_chamada not null,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint chamada_diaria_colaborador_data_unique unique (colaborador_id, data)
);

create trigger chamada_diaria_definir_updated_at
before update on public.chamada_diaria
for each row execute function private.definir_updated_at();
