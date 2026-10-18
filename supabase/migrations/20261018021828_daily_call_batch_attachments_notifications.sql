-- Manual batches reuse the same attendance mutation and transaction as a single review.
-- No balance is independently decremented: the existing G records define consumption.
create function private.daily_call_batch_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); profile public.perfis; item jsonb; c public.colaboradores; cd public.chamada_diaria;
 d date; employee uuid; proposed public.codigo_chamada; observation text; reason text:=btrim(p_data->>'reason');
 mode text:=p_data->>'mode'; rows jsonb:='[]'; decision bigint; eligible boolean; version text; result jsonb; changed integer:=0; bank jsonb;
begin
 select * into profile from public.perfis where id=actor and status_usuario='APROVADO' for share;
 if actor is null or profile.papel_usuario is null or profile.papel_usuario not in ('ADMIN','RH','GESTOR') then raise exception using errcode='42501',message='BATCH_FORBIDDEN'; end if;
 if p_action is null or p_action not in ('preview','apply') or mode is null or mode not in ('fill_blank','replace')
 or reason is null or length(reason) not between 5 and 500 or jsonb_typeof(p_data->'items') is distinct from 'array'
 or jsonb_array_length(p_data->'items') not between 1 and 100 then raise exception using errcode='22023',message='BATCH_INVALID'; end if;
 if exists(select 1 from jsonb_array_elements(p_data->'items') x group by x->>'employeeId',x->>'date' having count(*)>1) then raise exception using errcode='22023',message='BATCH_DUPLICATE'; end if;
 if (select max((x->>'date')::date)-min((x->>'date')::date) from jsonb_array_elements(p_data->'items') x)>30 then raise exception using errcode='22023',message='BATCH_PERIOD'; end if;
 -- Consistent order and the same per-person/day locks as automatic/manual attendance.
 for item in select value from jsonb_array_elements(p_data->'items') order by value->>'employeeId',value->>'date' loop
  employee:=(item->>'employeeId')::uuid; d:=(item->>'date')::date; proposed:=(item->>'status')::public.codigo_chamada;
  observation:=nullif(btrim(item->>'observation'),'');
  if employee is null or d is null or not isfinite(d) or proposed is null or length(coalesce(observation,''))>500 then raise exception using errcode='22023',message='BATCH_INVALID'; end if;
  select * into c from public.colaboradores where id=employee for share;
  if not found or (profile.papel_usuario='GESTOR' and (profile.gestor_id is null or c.gestor_id is distinct from profile.gestor_id)) then raise exception using errcode='42501',message='BATCH_FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtext(employee::text),hashtext(d::text));
  select * into cd from public.chamada_diaria where colaborador_id=employee and data=d for update;
  select coalesce(dec.version,0) into decision from private.daily_call_decisions dec where dec.employee_id=employee and dec.operational_date=d for update;
  select to_jsonb(b) into bank from private.banco_horas_no_dia(employee,d) b;
  eligible:=c.ativo_no_sistema and c.situacao in ('ATIVO','FERIAS','NOVO_ADMITIDO') and (c.admissao is null or d>=c.admissao) and (mode='replace' or cd.status is null);
  rows:=rows||jsonb_build_array(jsonb_build_object('employeeId',employee,'name',c.nome,'date',d,'currentStatus',cd.status,'origin',cd.origin,
   'status',proposed,'observation',observation,'expectedUpdatedAt',cd.updated_at,'expectedDecisionVersion',coalesce(decision,0)::text,
   'eligible',eligible,'explanation',case when not c.ativo_no_sistema or c.situacao not in ('ATIVO','FERIAS','NOVO_ADMITIDO') then 'Fora do quadro da Chamada'
    when c.admissao is not null and d<c.admissao then 'Anterior à admissão' when mode='fill_blank' and cd.status is not null then 'Lançamento existente preservado' else 'Revisão manual explícita' end,
   'employeeVersion',c.updated_at,'bankVersion',bank));
 end loop;
 version:=encode(sha256(convert_to(jsonb_build_object('actor',actor,'role',profile.papel_usuario,'manager',profile.gestor_id,'mode',mode,'reason',reason,'rows',rows)::text,'UTF8')),'hex');
 if p_action='apply' then
  if version is distinct from p_data->>'expectedVersion' then raise exception using errcode='PT409',message='BATCH_STALE'; end if;
  for item in select value from jsonb_array_elements(rows) where (value->>'eligible')::boolean loop
   result:=private.daily_call_workflow_impl('resolve',item||jsonb_build_object('reason',reason));
   if (result->>'changed')::boolean then changed:=changed+1; end if;
  end loop;
  return jsonb_build_object('changed',changed,'reviewed',(select count(*) from jsonb_array_elements(rows) x where (x->>'eligible')::boolean),'skipped',(select count(*) from jsonb_array_elements(rows) x where not (x->>'eligible')::boolean));
 end if;
 return jsonb_build_object('version',version,'rows',(select jsonb_agg(x-'employeeVersion'-'bankVersion') from jsonb_array_elements(rows) x),
  'eligible',(select count(*) from jsonb_array_elements(rows) x where (x->>'eligible')::boolean),'total',jsonb_array_length(rows));
end $$;
revoke all on function private.daily_call_batch_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.daily_call_batch_impl(text,jsonb) to authenticated;
create function public.daily_call_batch(p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.daily_call_batch_impl(p_action,p_data) $$;
revoke all on function public.daily_call_batch(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.daily_call_batch(text,jsonb) to authenticated;

-- Small confidential evidence stays in an unexposed table; never a public bucket or URL.
create table private.daily_call_attachments (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.colaboradores,
 operational_date date not null check(isfinite(operational_date)), file_name text not null check(length(file_name) between 1 and 150),
 media_type text not null check(media_type in ('application/pdf','image/png','image/jpeg')), content bytea not null check(octet_length(content) between 1 and 2097152),
 sha256 text not null, description text not null check(length(btrim(description)) between 5 and 500),
 created_by uuid not null references public.perfis, created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(), archived_at timestamptz
);
create index daily_call_attachment_scope on private.daily_call_attachments(employee_id,operational_date);
create table private.daily_call_attachment_audit (
 id bigint generated always as identity primary key, attachment_id uuid not null references private.daily_call_attachments,
 employee_id uuid not null references public.colaboradores, operational_date date not null,
 action text not null, actor uuid not null references public.perfis, reason text not null, metadata jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.daily_call_attachments enable row level security;
alter table private.daily_call_attachment_audit enable row level security;
revoke all on private.daily_call_attachments,private.daily_call_attachment_audit from public,anon,authenticated,service_role;
create function private.daily_call_attachment_internal(p_action text,p_data jsonb,p_actor uuid,p_validated_upload boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=p_actor; profile public.perfis; employee uuid; d date; c public.colaboradores; old private.daily_call_attachments;
 saved private.daily_call_attachments; bytes bytea; mime text:=p_data->>'mediaType'; filename text:=p_data->>'fileName'; reason text:=btrim(p_data->>'description');
begin
 select * into profile from public.perfis where id=actor and status_usuario='APROVADO' for share;
 if actor is null or profile.papel_usuario is null or profile.papel_usuario not in ('ADMIN','RH','GESTOR') then raise exception using errcode='42501',message='ATTACHMENT_FORBIDDEN'; end if;
 if p_action is null or p_action not in ('list','download','upload','archive','restore') then raise exception using errcode='22023',message='ATTACHMENT_INVALID'; end if;
 if p_action='upload' and not p_validated_upload then raise exception using errcode='42501',message='ATTACHMENT_VALIDATED_UPLOAD_REQUIRED'; end if;
 if p_action not in ('list','download') and profile.papel_usuario not in ('ADMIN','RH','GESTOR') then raise exception using errcode='42501',message='ATTACHMENT_FORBIDDEN'; end if;
 if p_action in ('download','archive','restore') then
  select * into old from private.daily_call_attachments where id=(p_data->>'id')::uuid for update;
  if not found then raise exception using errcode='42501',message='ATTACHMENT_FORBIDDEN'; end if;
  employee:=old.employee_id; d:=old.operational_date;
 else employee:=(p_data->>'employeeId')::uuid;d:=(p_data->>'date')::date; end if;
 if employee is null or d is null or not isfinite(d) then raise exception using errcode='22023',message='ATTACHMENT_INVALID'; end if;
 select * into c from public.colaboradores where id=employee for share;
 if not found or (profile.papel_usuario='GESTOR' and (profile.gestor_id is null or c.gestor_id is distinct from profile.gestor_id)) then raise exception using errcode='42501',message='ATTACHMENT_FORBIDDEN'; end if;
 if p_action='list' then return jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'fileName',a.file_name,'mediaType',a.media_type,'size',octet_length(a.content),'description',a.description,'createdAt',a.created_at,'updatedAt',a.updated_at,'archivedAt',a.archived_at) order by a.created_at desc) from private.daily_call_attachments a where a.employee_id=employee and a.operational_date=d),'[]')); end if;
 if p_action='download' then
  if old.archived_at is not null then raise exception using errcode='42501',message='ATTACHMENT_FORBIDDEN'; end if;
  return jsonb_build_object('fileName',old.file_name,'mediaType',old.media_type,'content',encode(old.content,'base64'));
 end if;
 perform pg_advisory_xact_lock(hashtext(employee::text),hashtext(d::text));
 if p_action='upload' then
  if not exists(select 1 from public.chamada_diaria where colaborador_id=employee and data=d) then raise exception using errcode='22023',message='ATTACHMENT_ATTENDANCE_REQUIRED'; end if;
  if reason is null or length(reason) not between 5 and 500 or filename is null or length(filename) not between 1 and 150 or filename ~ '[\x00-\x1f/\\]' or mime is null then raise exception using errcode='22023',message='ATTACHMENT_INVALID'; end if;
  if length(p_data->>'content')>2796204 then raise exception using errcode='22023',message='ATTACHMENT_SIZE'; end if;
  bytes:=decode(p_data->>'content','base64');
  if bytes is null or octet_length(bytes) not between 1 and 2097152 or not (
   (mime='application/pdf' and substring(bytes from 1 for 5)=decode('255044462d','hex') and position(convert_to('%%EOF','UTF8') in bytes)>0)
   or (mime='image/png' and substring(bytes from 1 for 8)=decode('89504e470d0a1a0a','hex') and substring(bytes from octet_length(bytes)-11)=decode('0000000049454e44ae426082','hex'))
   or (mime='image/jpeg' and substring(bytes from 1 for 3)=decode('ffd8ff','hex') and substring(bytes from octet_length(bytes)-1)=decode('ffd9','hex'))
  ) then raise exception using errcode='22023',message='ATTACHMENT_FORMAT'; end if;
  if mime='application/pdf' and encode(bytes,'escape') ~* '/(JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile|RichMedia)\M' then raise exception using errcode='22023',message='ATTACHMENT_FORMAT'; end if;
  -- Quotas count archived versions too, preventing archive/upload quota evasion.
  if (select count(*) from private.daily_call_attachments where employee_id=employee and operational_date=d)>=10
   or (select coalesce(sum(octet_length(content)),0) from private.daily_call_attachments where employee_id=employee and operational_date=d)+octet_length(bytes)>10485760
   or (select count(*) from private.daily_call_attachments where employee_id=employee and operational_date=d and archived_at is null)>=5 then raise exception using errcode='22023',message='ATTACHMENT_QUOTA'; end if;
  if exists(select 1 from private.daily_call_attachments where employee_id=employee and operational_date=d and sha256=encode(sha256(bytes),'hex')) then raise exception using errcode='PT409',message='ATTACHMENT_DUPLICATE'; end if;
  insert into private.daily_call_attachments(employee_id,operational_date,file_name,media_type,content,sha256,description,created_by)
   values(employee,d,filename,mime,bytes,encode(sha256(bytes),'hex'),reason,actor) returning * into saved;
 else
  reason:=btrim(p_data->>'reason');
  if reason is null or length(reason) not between 5 and 500 then raise exception using errcode='22023',message='ATTACHMENT_INVALID'; end if;
  if old.updated_at is distinct from (p_data->>'expectedUpdatedAt')::timestamptz then raise exception using errcode='PT409',message='ATTACHMENT_STALE'; end if;
  if (p_action='restore' and old.archived_at is null) or (p_action='archive' and old.archived_at is not null) then raise exception using errcode='PT409',message='ATTACHMENT_STALE'; end if;
  if p_action='restore' and (select count(*) from private.daily_call_attachments where employee_id=employee and operational_date=d and archived_at is null)>=5 then raise exception using errcode='22023',message='ATTACHMENT_QUOTA'; end if;
  update private.daily_call_attachments set archived_at=case when p_action='archive' then clock_timestamp() end,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=old.id returning * into saved;
 end if;
 insert into private.daily_call_attachment_audit(attachment_id,employee_id,operational_date,action,actor,reason,metadata)
 values(saved.id,employee,d,p_action,actor,reason,jsonb_build_object('fileName',saved.file_name,'mediaType',saved.media_type,'size',octet_length(saved.content),'sha256',saved.sha256,'archivedAt',saved.archived_at));
 return jsonb_build_object('id',saved.id,'updatedAt',saved.updated_at);
end $$;
revoke all on function private.daily_call_attachment_internal(text,jsonb,uuid,boolean) from public,anon,authenticated,service_role;
create function private.daily_call_attachment_impl(p_action text,p_data jsonb) returns jsonb language sql security definer set search_path='' as $$ select private.daily_call_attachment_internal(p_action,p_data,auth.uid(),false) $$;
revoke all on function private.daily_call_attachment_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.daily_call_attachment_impl(text,jsonb) to authenticated;
create function public.daily_call_attachments(p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.daily_call_attachment_impl(p_action,p_data) $$;
revoke all on function public.daily_call_attachments(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.daily_call_attachments(text,jsonb) to authenticated;
create function private.daily_call_attachment_upload(p_actor uuid,p_data jsonb) returns jsonb language sql security definer set search_path='' as $$ select private.daily_call_attachment_internal('upload',p_data,p_actor,true) $$;
revoke all on function private.daily_call_attachment_upload(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.daily_call_attachment_upload(uuid,jsonb) to service_role;
create function public.daily_call_attachment_upload(p_actor uuid,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.daily_call_attachment_upload(p_actor,p_data) $$;
revoke all on function public.daily_call_attachment_upload(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.daily_call_attachment_upload(uuid,jsonb) to service_role;
