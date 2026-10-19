-- Compare immutable, completed Defense exports. Detection does not decide historical validity.
create table private.monitoring_group_files (
 file_id uuid primary key references public.monitoring_files,
 captured_at timestamptz not null, time_origin text not null check(time_origin in ('filename','received')),
 detected_at timestamptz not null default clock_timestamp()
);
create table private.monitoring_group_observations (
 file_id uuid not null references private.monitoring_group_files,
 namespace text not null, source_id text not null references public.monitoring_sources, external_id text not null,
 names jsonb not null check(jsonb_typeof(names)='array'), variants jsonb not null check(jsonb_typeof(variants)='array'),
 primary key(file_id,external_id)
);
create index monitoring_groups_identity on private.monitoring_group_observations(namespace,external_id);
create index monitoring_groups_source on private.monitoring_group_observations(source_id,external_id);
alter table private.monitoring_group_files enable row level security;
alter table private.monitoring_group_observations enable row level security;
revoke all on private.monitoring_group_files,private.monitoring_group_observations from public,anon,authenticated,service_role;

create function private.monitoring_normalize_defense_groups(p_groups jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(g order by g),'[]'::jsonb) from (
  select distinct upper(normalize(regexp_replace(btrim(regexp_replace(part,'^.*[/\\]','')), '\s+',' ','g'),NFC)) g
  from jsonb_array_elements_text(case when jsonb_typeof(p_groups)='array' then p_groups else '[]'::jsonb end) v
  cross join lateral regexp_split_to_table(v,',') part
 ) groups where g<>''
$$;
revoke all on function private.monitoring_normalize_defense_groups(jsonb) from public,anon,authenticated,service_role;

create function private.monitoring_defense_file_time(p_file uuid) returns table(captured_at timestamptz,time_origin text)
language plpgsql stable security definer set search_path='' as $$
declare f public.monitoring_files; zone text; stamp text; received timestamptz; parsed timestamptz;
begin
 select * into strict f from public.monitoring_files where id=p_file;
 select timezone into zone from public.monitoring_sources where id=f.source_id;
 select min(received_at) into received from public.monitoring_batches where file_id=p_file;
 received:=coalesce(received,f.completed_at,f.last_attempt_at);
 stamp:=substring(regexp_replace(f.relative_path,'^.*[/\\]','') from '^(?:Person|AccessRecords)([0-9]{14})');
 if stamp is not null then
  begin
   parsed:=make_timestamp(substring(stamp,1,4)::int,substring(stamp,5,2)::int,substring(stamp,7,2)::int,
     substring(stamp,9,2)::int,substring(stamp,11,2)::int,substring(stamp,13,2)::double precision) at time zone zone;
   if parsed<=received+interval '1 day' and substring(stamp,1,4)::int between 2000 and 2100 then
    return query select parsed,'filename'::text;return;
   end if;
  exception when datetime_field_overflow or invalid_datetime_format then null;
  end;
 end if;
 return query select received,'received'::text;
end $$;
revoke all on function private.monitoring_defense_file_time(uuid) from public,anon,authenticated,service_role;

create function private.monitoring_collect_group_file(p_file uuid) returns void
language plpgsql security definer set search_path='' as $$
declare f public.monitoring_files; s public.monitoring_sources; saved uuid; count_people int;
begin
 select * into strict f from public.monitoring_files where id=p_file;
 select * into strict s from public.monitoring_sources where id=f.source_id;
 if f.status<>'complete' or f.completed_at is null or s.kind not in ('defense-person','defense-access') then return;end if;
 insert into private.monitoring_group_files(file_id,captured_at,time_origin)
 select p_file,t.captured_at,t.time_origin from private.monitoring_defense_file_time(p_file) t
 on conflict do nothing returning file_id into saved;
 if saved is null then return;end if;
 with raw_values as materialized (
  select distinct case when s.kind='defense-person' then o.payload#>>'{person,externalId}' else o.payload#>>'{event,identity,value}' end external_id,
   case when s.kind='defense-person' then o.payload#>>'{person,name}' else o.payload#>>'{event,original,name}' end name,
   case when s.kind='defense-person' then o.payload#>'{person,groups}'
     else to_jsonb(string_to_array(o.payload#>>'{event,original,groups}',',')) end groups
  from public.monitoring_occurrences o where o.file_id=p_file and not o.conflict
   and not exists(select 1 from jsonb_array_elements(coalesce(o.payload->'issues','[]'::jsonb)) i where i->>'severity'='error')
   and ((s.kind='defense-person' and o.payload->'person' is not null and jsonb_typeof(o.payload#>'{person,groups}')='array')
    or (s.kind='defense-access' and o.payload#>>'{event,identity,type}'='defense' and btrim(coalesce(o.payload#>>'{event,original,groups}',''))<>''))
 ), raw as (
  select external_id,upper(normalize(regexp_replace(btrim(name),'\s+',' ','g'),NFC)) name,
   private.monitoring_normalize_defense_groups(groups) groups from raw_values
 ) insert into private.monitoring_group_observations(file_id,namespace,source_id,external_id,names,variants)
 select p_file,s.identity_namespace,s.id,external_id,jsonb_agg(distinct name order by name),jsonb_agg(distinct groups order by groups)
 from raw where coalesce(external_id,'')<>'' and coalesce(name,'')<>'' group by external_id;
 get diagnostics count_people=row_count;
 -- Current person groups follow the newest completed person export, never a partial batch or SHA ordering.
 if s.kind='defense-person' then
  update public.monitoring_people pe set groups=o.variants->0
  from private.monitoring_group_observations o join private.monitoring_group_files gf on gf.file_id=o.file_id
  where o.file_id=p_file and pe.source_id=o.source_id and pe.external_id=o.external_id
   and jsonb_array_length(o.variants)=1 and jsonb_array_length(o.names)=1
   and upper(normalize(regexp_replace(btrim(pe.name),'\s+',' ','g'),NFC))=o.names->>0
   and not exists(select 1 from private.monitoring_group_observations other join private.monitoring_group_files og on og.file_id=other.file_id
     where other.source_id=o.source_id and other.external_id=o.external_id and
      (og.captured_at>gf.captured_at or (og.captured_at=gf.captured_at and other.variants is distinct from o.variants)));
 end if;
 insert into public.monitoring_audit(actor,action,target,detail) values(null,'defense_group_observed',p_file::text,
  jsonb_build_object('reason','Comparação automática dos grupos de arquivo Defense concluído','people',count_people));
end $$;
revoke all on function private.monitoring_collect_group_file(uuid) from public,anon,authenticated,service_role;
create function private.monitoring_group_file_completed() returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.monitoring_collect_group_file(new.id);return new;end $$;
revoke all on function private.monitoring_group_file_completed() from public,anon,authenticated,service_role;
create trigger monitoring_group_file_completed after insert or update of status,completed_at on public.monitoring_files
 for each row when(new.status='complete' and new.completed_at is not null) execute function private.monitoring_group_file_completed();

-- A group change alone is not an identity conflict. Preserve existing groups until the file completes.
do $$declare definition text; old_ambiguity text:=' or public.monitoring_people.groups is distinct from excluded.groups';
 old_groups text:='groups=case when (select sha256 from public.monitoring_files where id=f)<(select sha256 from public.monitoring_files where id=public.monitoring_people.file_id) then excluded.groups else public.monitoring_people.groups end,';
begin
 definition:=pg_get_functiondef('private.monitoring_ingest_before_source_management(jsonb)'::regprocedure);
 if strpos(definition,old_ambiguity)=0 or strpos(definition,old_groups)=0 then raise exception 'DEFENSE_GROUP_PATCH_TARGET_CHANGED';end if;
 definition:=replace(replace(definition,old_ambiguity,''),old_groups,'groups=public.monitoring_people.groups,');execute definition;
end $$;

-- Seed evidence from already imported originals; no punches, dates, attendance or bank entries change.
do $$declare f record;begin
 for f in select mf.id from public.monitoring_files mf join public.monitoring_sources s on s.id=mf.source_id
 cross join lateral private.monitoring_defense_file_time(mf.id) t
 where mf.status='complete' and mf.completed_at is not null and s.kind in ('defense-person','defense-access') order by t.captured_at,mf.id
 loop perform private.monitoring_collect_group_file(f.id);end loop;
end $$;

create function private.monitoring_group_changes() returns table(
 key text,namespace text,external_id text,employee_id uuid,name text,employee_number text,
 old_groups jsonb,new_groups jsonb,variants jsonb,observed_at timestamptz,detected_at timestamptz,
 file_name text,previous_file text,source_id text,time_origin text,status text)
language sql stable security definer set search_path='' as $$
 with observations as materialized (
  select o.*,gf.captured_at,gf.detected_at,gf.time_origin,f.relative_path,s.timezone,
   lag(o.variants) over w prior_variants,lag(o.names) over w prior_names,lag(f.relative_path) over w prior_file
  from private.monitoring_group_observations o join private.monitoring_group_files gf on gf.file_id=o.file_id
  join public.monitoring_files f on f.id=o.file_id join public.monitoring_sources s on s.id=o.source_id
  window w as(partition by o.namespace,o.external_id order by gf.captured_at,o.file_id)
 ), transitions as (
  select *,row_number() over(partition by o.namespace,o.external_id order by captured_at desc,file_id desc) position
  from observations o where prior_variants is not null and (variants is distinct from prior_variants or names is distinct from prior_names)
 ), latest as (
  select t.*,b.ids,coalesce(c.nome,t.names->>0) employee_name,c.matricula,
   exists(select 1 from observations other where other.namespace=t.namespace and other.external_id=t.external_id
    and other.captured_at=t.captured_at and other.variants is distinct from t.variants) time_conflict,
   exists(select 1 from public.monitoring_bindings mb join public.monitoring_sources bs on bs.id=mb.source_id
    where bs.identity_namespace=t.namespace and mb.identity_type='defense' and mb.employee_id=b.ids[1]
     and mb.identity_value<>t.external_id and mb.revoked_at is null
     and mb.valid_from<=(t.captured_at at time zone t.timezone)::date and (mb.valid_to is null or mb.valid_to>=(t.captured_at at time zone t.timezone)::date)) duplicate_identity,
   exists(select 1 from public.monitoring_settings ms where ms.kind='group_snapshot' and ms.target=b.ids[1]::text and ms.revoked_at is null
    and not exists(select 1 from public.monitoring_settings next where next.supersedes_id=ms.id)
    and ms.valid_from<=(t.captured_at at time zone t.timezone)::date and (ms.valid_to is null or ms.valid_to>=(t.captured_at at time zone t.timezone)::date)
    and private.monitoring_normalize_defense_groups(ms.payload->'groups')=t.variants->0)
   and not exists(select 1 from public.monitoring_settings ms where ms.kind='group_snapshot' and ms.target=b.ids[1]::text and ms.revoked_at is null
    and not exists(select 1 from public.monitoring_settings next where next.supersedes_id=ms.id)
    and ms.valid_from<=(t.captured_at at time zone t.timezone)::date and (ms.valid_to is null or ms.valid_to>=(t.captured_at at time zone t.timezone)::date)
    and private.monitoring_normalize_defense_groups(ms.payload->'groups') is distinct from t.variants->0) confirmed
  from transitions t left join lateral(select array_agg(distinct mb.employee_id order by mb.employee_id) ids
   from public.monitoring_bindings mb join public.monitoring_sources bs on bs.id=mb.source_id
   where bs.identity_namespace=t.namespace and mb.identity_type='defense' and mb.identity_value=t.external_id and mb.revoked_at is null
    and mb.valid_from<=(t.captured_at at time zone t.timezone)::date and (mb.valid_to is null or mb.valid_to>=(t.captured_at at time zone t.timezone)::date)) b on true
  left join public.colaboradores c on c.id=b.ids[1] where position=1
 ) select 'defense-group:'||encode(sha256(convert_to(file_id::text||':'||l.external_id||':'||prior_variants::text,'UTF8')),'hex'),l.namespace,l.external_id,
  case when cardinality(ids)=1 then ids[1] end,employee_name,coalesce(matricula,l.external_id),prior_variants->0,l.variants->0,l.variants,
  captured_at,l.detected_at,relative_path,prior_file,l.source_id,l.time_origin,
  case when jsonb_array_length(l.variants)<>1 or jsonb_array_length(prior_variants)<>1 or names is distinct from prior_names
    or jsonb_array_length(names)<>1 or cardinality(ids)>1 or time_conflict or duplicate_identity then 'conflict'
   when coalesce(cardinality(ids),0)=0 then 'unlinked' when confirmed then 'confirmed' else 'pending' end
 from latest l
$$;
revoke all on function private.monitoring_group_changes() from public,anon,authenticated,service_role;

create function private.monitoring_defense_group_changes_impl(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile public.perfis; result jsonb; page_offset int:=coalesce((p_data->>'offset')::int,0); page_limit int:=coalesce((p_data->>'limit')::int,50);
begin
 select * into profile from public.perfis where id=auth.uid() and status_usuario='APROVADO';
 if profile.id is null or profile.papel_usuario not in ('ADMIN','RH') then raise exception using errcode='42501',message='DEFENSE_GROUP_FORBIDDEN';end if;
 if p_action is distinct from 'list' or jsonb_typeof(p_data) is distinct from 'object' or page_offset not between 0 and 100000 or page_limit not between 1 and 100 or length(coalesce(p_data->>'query',''))>100 then raise exception 'DEFENSE_GROUP_INVALID';end if;
 with candidates as materialized(select * from private.monitoring_group_changes()), filtered as (
  select * from candidates where (p_data->>'includeConfirmed'='true' or status<>'confirmed')
   and (coalesce(p_data->>'query','')='' or position(lower(p_data->>'query') in lower(name||' '||employee_number||' '||external_id))>0)
 ), page as (select * from filtered order by detected_at desc,name,key limit page_limit offset page_offset)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]'::jsonb),'total',(select count(*) from filtered),
  'pending',(select count(*) from candidates where status<>'confirmed'),'checkedFiles',(select count(*) from private.monitoring_group_files),
  'checkedAt',clock_timestamp()) into result;
 return result;
end $$;
revoke all on function private.monitoring_defense_group_changes_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_defense_group_changes_impl(text,jsonb) to authenticated;
create function public.monitoring_defense_group_changes(p_action text,p_data jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select private.monitoring_defense_group_changes_impl(p_action,p_data)$$;
revoke all on function public.monitoring_defense_group_changes(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.monitoring_defense_group_changes(text,jsonb) to authenticated;

-- Keep the bulk historical confirmation tied to the export date, even when an older file is uploaded later.
alter function private.monitoring_query_impl(text,jsonb) rename to monitoring_query_before_group_observations;
create function private.monitoring_query_impl(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 result:=private.monitoring_query_before_group_observations(p_action,p_data);
 if p_action='admin' then
  result:=result||jsonb_build_object('files',(select coalesce(jsonb_agg(f.value||jsonb_build_object('group_observed_at',gf.captured_at) order by f.position),'[]'::jsonb)
   from jsonb_array_elements(result->'files') with ordinality f(value,position)
   left join private.monitoring_group_files gf on gf.file_id=(f.value->>'id')::uuid));
 end if;return result;
end $$;
revoke all on function private.monitoring_query_before_group_observations(text,jsonb),private.monitoring_query_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_query_impl(text,jsonb) to authenticated;

alter function private.workspace_notifications(uuid,public.papel_usuario,uuid) rename to workspace_notifications_before_defense_groups;
create function private.workspace_notifications(p_actor uuid,p_role public.papel_usuario,p_manager uuid)
returns table(key text,title text,body text,href text,created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select * from private.workspace_notifications_before_defense_groups(p_actor,p_role,p_manager)
 union all
 select g.key,case g.status when 'pending' then 'Mudança de grupo no Defense' else 'Conferir grupo do Defense' end,
  g.name||' · '||g.employee_number||' — Grupo anterior: '||coalesce((select string_agg(v,', ') from jsonb_array_elements_text(g.old_groups) v),'Sem grupos')
   ||'. Grupo observado: '||coalesce((select string_agg(v,', ') from jsonb_array_elements_text(g.new_groups) v),'Sem grupos')||'. Confirme a data real antes de alterar a vigência.',
  '/monitoramento?tab=configuracao#mudancas-grupos',g.detected_at
 from private.monitoring_group_changes() g where p_role in ('ADMIN','RH') and g.status<>'confirmed'
$$;
revoke all on function private.workspace_notifications(uuid,public.papel_usuario,uuid),private.workspace_notifications_before_defense_groups(uuid,public.papel_usuario,uuid) from public,anon,authenticated,service_role;
