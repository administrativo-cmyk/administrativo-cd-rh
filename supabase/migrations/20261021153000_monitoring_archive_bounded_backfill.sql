-- Bounded bulk acknowledgment uses the exact existing fenced day transaction.
create table private.monitoring_calculation_receipts (
 id uuid primary key, sha256 text not null, finished integer not null check(finished between 1 and 10), created_at timestamptz not null default clock_timestamp()
);
create index monitoring_calculation_receipt_age on private.monitoring_calculation_receipts(created_at);
alter table private.monitoring_calculation_receipts enable row level security;
revoke all on private.monitoring_calculation_receipts from public,anon,authenticated,service_role;
alter function private.monitoring_worker_impl(text,jsonb) rename to monitoring_worker_before_bounded_finish;
create function private.monitoring_worker_impl(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare request_id uuid; request_hash text; receipt private.monitoring_calculation_receipts; item jsonb;n integer;
begin
 if p_action<>'finish_many' then return private.monitoring_worker_before_bounded_finish(p_action,p_data);end if;
 request_id:=(p_data->>'id')::uuid;
 if request_id is null or jsonb_typeof(p_data->'jobs') is distinct from 'array' or jsonb_array_length(p_data->'jobs') not between 1 and 10 then raise exception 'MONITORING_BATCH_INVALID';end if;
 request_hash:=encode(sha256(convert_to((p_data->'jobs')::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(request_id::text,0));
 select * into receipt from private.monitoring_calculation_receipts where id=request_id;
 if found then
  if receipt.sha256<>request_hash then raise exception 'MONITORING_BATCH_CHANGED';end if;
  return jsonb_build_object('finished',receipt.finished,'replayed',true);
 end if;
 n:=0;for item in select value from jsonb_array_elements(p_data->'jobs') loop
  perform private.monitoring_worker_before_bounded_finish('finish',item);n:=n+1;
 end loop;
 insert into private.monitoring_calculation_receipts(id,sha256,finished) values(request_id,request_hash,n);
 delete from private.monitoring_calculation_receipts where created_at<clock_timestamp()-interval '3 months';
 return jsonb_build_object('finished',n);
end $$;
revoke all on function private.monitoring_worker_before_bounded_finish(text,jsonb),private.monitoring_worker_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_worker_impl(text,jsonb) to service_role;
