-- Canonical catalogs preserve every original spelling and the pre-migration employee values.
create function private.catalog_key(p_value text) returns text language sql immutable set search_path='' as $$
 select regexp_replace(normalize(lower(regexp_replace(btrim(p_value),'\s+',' ','g')),NFD),'[̀-ͯ]','','g')
$$;
create table private.canonical_catalog (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('department','job','category')),
 name text not null check(length(btrim(name)) between 1 and 200), name_key text not null,
 active boolean not null default true, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(kind,name_key)
);
create table private.canonical_catalog_alias (
 kind text not null, label text not null, catalog_id uuid not null references private.canonical_catalog(id) on delete restrict,
 primary key(kind,label)
);
create index canonical_catalog_alias_catalog on private.canonical_catalog_alias(catalog_id);
create table private.employee_catalog_legacy (
 employee_id uuid primary key references public.colaboradores(id) on delete restrict,
 department text, job text, category text, captured_at timestamptz not null default clock_timestamp()
);
insert into private.employee_catalog_legacy(employee_id,department,job,category) select id,setor,funcao,categoria from public.colaboradores;
alter table private.canonical_catalog enable row level security;
alter table private.canonical_catalog_alias enable row level security;
alter table private.employee_catalog_legacy enable row level security;
revoke all on private.canonical_catalog,private.canonical_catalog_alias,private.employee_catalog_legacy from public,anon,authenticated,service_role;
create trigger canonical_catalog_touch before update on private.canonical_catalog for each row execute function private.administration_touch();
alter table public.colaboradores add column department_catalog_id uuid references private.canonical_catalog(id) on delete restrict,
 add column job_catalog_id uuid references private.canonical_catalog(id) on delete restrict,
 add column category_catalog_id uuid references private.canonical_catalog(id) on delete restrict;
create index colaboradores_department_catalog on public.colaboradores(department_catalog_id);
create index colaboradores_job_catalog on public.colaboradores(job_catalog_id);
create index colaboradores_category_catalog on public.colaboradores(category_catalog_id);

create function private.catalog_ensure(p_kind text,p_label text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_key text:=private.catalog_key(p_label);
begin
 if coalesce(v_key,'')='' then return null; end if;
 select id into v_id from private.canonical_catalog where kind=p_kind and name_key=v_key;
 if v_id is null then
  select catalog_id into v_id from private.canonical_catalog_alias where kind=p_kind and private.catalog_key(label)=v_key order by label limit 1;
 end if;
 if v_id is null then
  insert into private.canonical_catalog(kind,name,name_key) values(p_kind,regexp_replace(btrim(p_label),'\s+',' ','g'),v_key)
  on conflict(kind,name_key) do update set name_key=excluded.name_key returning id into v_id;
 end if;
 insert into private.canonical_catalog_alias(kind,label,catalog_id) values(p_kind,p_label,v_id) on conflict(kind,label) do nothing;
 return v_id;
end $$;
create function private.employee_canonical_catalogs() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.department_catalog_id:=private.catalog_ensure('department',new.setor);
 new.job_catalog_id:=private.catalog_ensure('job',new.funcao);
 new.category_catalog_id:=private.catalog_ensure('category',new.categoria);
 if new.ativo_no_sistema and exists(select 1 from private.canonical_catalog where id=any(array[new.department_catalog_id,new.job_catalog_id,new.category_catalog_id]) and not active) then raise exception 'ADMINISTRATION_INACTIVE_REFERENCE';end if;
 if new.department_catalog_id is not null then select name into new.setor from private.canonical_catalog where id=new.department_catalog_id; end if;
 if new.job_catalog_id is not null then select name into new.funcao from private.canonical_catalog where id=new.job_catalog_id; end if;
 if new.category_catalog_id is not null then select name into new.categoria from private.canonical_catalog where id=new.category_catalog_id; end if;
 return new;
end $$;
create trigger employee_canonical_catalogs before insert or update of setor,funcao,categoria,ativo_no_sistema on public.colaboradores for each row execute function private.employee_canonical_catalogs();
update public.colaboradores set setor=setor,funcao=funcao,categoria=categoria where setor is not null or funcao is not null or categoria is not null;

create function private.catalog_row(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'name',name,'active',active,'createdAt',created_at,'updatedAt',updated_at,
  'aliases',(select coalesce(jsonb_agg(label order by label),'[]'::jsonb) from private.canonical_catalog_alias where catalog_id=c.id))
 from private.canonical_catalog c where id=p_id
$$;
create function private.administration_catalogs(p_entity text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_role public.papel_usuario; v_actor uuid:=auth.uid(); v_result jsonb; v_options jsonb; v_id uuid; v_old private.canonical_catalog;
 v_name text; v_key text; v_reason text:=btrim(p_data->>'reason'); v_before jsonb; v_after jsonb; v_total integer; v_rows jsonb; v_catalogs jsonb;
 v_offset integer:=coalesce((p_data->>'offset')::integer,0); v_limit integer:=coalesce((p_data->>'limit')::integer,100); v_employee uuid;
begin
 if p_action is distinct from 'list' then perform pg_advisory_xact_lock(824202609,1); perform pg_advisory_xact_lock(791800,1); end if;
 select papel_usuario into v_role from public.perfis where id=v_actor and status_usuario='APROVADO' for share;
 if v_role is null then raise exception using errcode='42501',message='ADMINISTRATION_FORBIDDEN'; end if;
 if p_entity not in ('department','job','category') then
  -- Keep the existing authorization, CAS, audit and import-compatible employee contract.
  if p_entity='employee' and p_action='save' then
   if exists(select 1 from private.canonical_catalog c where not active and
    (c.name_key=private.catalog_key(case c.kind when 'department' then p_data->>'department' when 'job' then p_data->>'role' else p_data->>'category' end) or exists(select 1 from private.canonical_catalog_alias a where a.catalog_id=c.id and private.catalog_key(a.label)=private.catalog_key(case c.kind when 'department' then p_data->>'department' when 'job' then p_data->>'role' else p_data->>'category' end))))
    then raise exception 'ADMINISTRATION_INACTIVE_REFERENCE'; end if;
  end if;
  v_result:=private.administration_impl(p_entity,p_action,p_data);
  if p_action<>'list' then return v_result; end if;
 else
  if v_role not in ('ADMIN','RH') then raise exception using errcode='42501',message='ADMINISTRATION_FORBIDDEN'; end if;
  if p_action is null or p_action not in ('list','save','archive','restore') or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'ADMINISTRATION_INVALID_INPUT'; end if;
  if p_action='list' then
   if v_offset<0 or v_offset>100000 or v_limit<1 or v_limit>500 or length(coalesce(p_data->>'query',''))>100 then raise exception 'ADMINISTRATION_INVALID_INPUT'; end if;
   with scoped as (select id from private.canonical_catalog where kind=p_entity and (coalesce((p_data->>'includeArchived')::boolean,false) or active)
    and (coalesce(p_data->>'query','')='' or name_key like '%'||private.catalog_key(p_data->>'query')||'%')),
   page as (select c.id from scoped s join private.canonical_catalog c using(id) order by c.name,c.id limit v_limit offset v_offset)
   select (select count(*) from scoped),(select coalesce(jsonb_agg(private.catalog_row(id)),'[]'::jsonb) from page) into v_total,v_rows;
   v_result:=jsonb_build_object('entity',p_entity,'rows',v_rows,'total',v_total,'options',jsonb_build_object('units','[]'::jsonb,'managers','[]'::jsonb,'employees','[]'::jsonb),'permissions',jsonb_build_object('canManageRegisters',true,'canApproveVacation',true,'canProposeVacation',true));
  else
   if coalesce(length(v_reason),0) not between 5 and 1000 then raise exception 'ADMINISTRATION_INVALID_INPUT'; end if;
   v_id:=(p_data->>'id')::uuid;
   if v_id is not null then
    select * into v_old from private.canonical_catalog where id=v_id and kind=p_entity for update;
    if not found then raise exception 'ADMINISTRATION_NOT_FOUND'; end if;
    if (p_data->>'expectedUpdatedAt')::timestamptz is distinct from v_old.updated_at then raise exception 'ADMINISTRATION_STALE'; end if;
    v_before:=private.catalog_row(v_id);
   elsif p_action<>'save' or p_data->>'expectedUpdatedAt' is not null then raise exception 'ADMINISTRATION_INVALID_INPUT'; end if;
   if p_action='save' then
    if v_id is not null and not v_old.active then raise exception 'ADMINISTRATION_ARCHIVED'; end if;
    v_name:=regexp_replace(btrim(p_data->>'name'),'\s+',' ','g'); v_key:=private.catalog_key(v_name);
    if coalesce(length(v_name),0) not between 1 and 200 then raise exception 'ADMINISTRATION_INVALID_INPUT'; end if;
    if exists(select 1 from private.canonical_catalog where kind=p_entity and name_key=v_key and id is distinct from v_id)
      or exists(select 1 from private.canonical_catalog_alias where kind=p_entity and private.catalog_key(label)=v_key and catalog_id is distinct from v_id) then raise exception 'ADMINISTRATION_DUPLICATE'; end if;
    if v_id is null then insert into private.canonical_catalog(kind,name,name_key) values(p_entity,v_name,v_key) returning id into v_id;
    else update private.canonical_catalog set name=v_name,name_key=v_key where id=v_id; end if;
    insert into private.canonical_catalog_alias(kind,label,catalog_id) values(p_entity,v_name,v_id) on conflict(kind,label) do nothing;
    -- Match worker order: revision precedes employee locks. Rename changes metadata only.
    perform 1 from private.monitoring_revision where id=true for update;
    update public.colaboradores set setor=v_name where p_entity='department' and department_catalog_id=v_id and setor is distinct from v_name;
    update public.colaboradores set funcao=v_name where p_entity='job' and job_catalog_id=v_id and funcao is distinct from v_name;
    update public.colaboradores set categoria=v_name where p_entity='category' and category_catalog_id=v_id and categoria is distinct from v_name;
   else
    if (p_action='archive' and not v_old.active) or (p_action='restore' and v_old.active) then raise exception 'ADMINISTRATION_STALE'; end if;
    if p_action='archive' and exists(select 1 from public.colaboradores where ativo_no_sistema and
     (department_catalog_id=v_id or job_catalog_id=v_id or category_catalog_id=v_id)) then raise exception 'ADMINISTRATION_REFERENCED'; end if;
    update private.canonical_catalog set active=(p_action='restore') where id=v_id;
   end if;
   v_after:=private.catalog_row(v_id);
   insert into private.administration_audit(entity,entity_id,action,actor,reason,before_record,after_record) values(p_entity,v_id,p_action,v_actor,v_reason,v_before,v_after);
   update private.monitoring_revision set results_version=results_version+1 where id=true;
   update private.daily_call_revision set version=version+1 where id=true;
   return jsonb_build_object('record',v_after,'changed',true);
  end if;
 end if;
 select coalesce(jsonb_agg(private.catalog_row(id)||jsonb_build_object('kind',kind) order by kind,name,id),'[]'::jsonb) into v_catalogs from private.canonical_catalog;
 v_options:=coalesce(v_result->'options','{}'::jsonb)||jsonb_build_object('catalogs',v_catalogs);
 v_result:=jsonb_set(v_result,'{options}',v_options);
 return v_result||jsonb_build_object('datasetVersion',md5(coalesce(v_result->>'datasetVersion','')||v_catalogs::text||coalesce(v_result->>'total','')));
end $$;
create or replace function public.administration(p_entity text,p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.administration_catalogs(p_entity,p_action,p_data) $$;
revoke all on function private.catalog_key(text),private.catalog_ensure(text,text),private.employee_canonical_catalogs(),private.catalog_row(uuid),private.administration_catalogs(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.administration_catalogs(text,text,jsonb) to authenticated;
