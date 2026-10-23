-- Lossless normalization: scalar event fields have a single stored copy. A
-- versioned mask restores only keys that were byte-for-byte equivalent JSON.
create function private.monitoring_event_columns(e public.monitoring_events) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('key',e.event_key,'type',e.event_type,'identity',jsonb_build_object('type',e.identity_type,'value',e.identity_value),
  'device',e.device,'classification',e.classification,'eligible',e.eligible,'nsr',e.nsr,'rawIdentifier',e.identity_value)
$$;
create function private.monitoring_expand_event_payload(p_payload jsonb,p_columns jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare answer jsonb:=p_payload;mask integer;keys constant text[]:=array['key','type','identity','device','classification','eligible','nsr','rawIdentifier'];i integer;
begin
 if jsonb_typeof(p_payload->'_monitoringColumns') is distinct from 'number' then return p_payload;end if;
 mask:=(p_payload->>'_monitoringColumns')::integer;
 if mask not between 1 and 255 then raise exception 'MONITORING_EVENT_STORAGE_INVALID';end if;
 answer:=answer-'_monitoringColumns';
 for i in 1..array_length(keys,1) loop if (mask & (1 << (i-1)))<>0 then answer:=answer||jsonb_build_object(keys[i],p_columns->keys[i]);end if;end loop;
 return answer;
end $$;
create function private.monitoring_pack_event_payload(p_payload jsonb,p_columns jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare answer jsonb:=private.monitoring_expand_event_payload(p_payload,p_columns);mask integer:=0;keys constant text[]:=array['key','type','identity','device','classification','eligible','nsr','rawIdentifier'];i integer;
begin
 for i in 1..array_length(keys,1) loop
  if answer ? keys[i] and answer->keys[i]=p_columns->keys[i] then mask:=mask | (1 << (i-1));answer:=answer-keys[i];end if;
 end loop;
 return case when mask=0 then answer else answer||jsonb_build_object('_monitoringColumns',mask) end;
end $$;
create function private.monitoring_event_payload(e public.monitoring_events) returns jsonb
language sql immutable set search_path='' as $$select private.monitoring_expand_event_payload(e.payload,private.monitoring_event_columns(e))$$;
create function private.monitoring_store_event_columns() returns trigger
language plpgsql security definer set search_path='' as $$begin
 -- A conflict may change eligible without replacing payload. Reconstruct using
 -- OLD scalar values before packing against NEW, preserving the original event.
 if tg_op='UPDATE' and new.payload is not distinct from old.payload then new.payload:=private.monitoring_event_payload(old);end if;
 new.payload:=private.monitoring_pack_event_payload(new.payload,private.monitoring_event_columns(new));
 return new;
end $$;
create trigger monitoring_store_event_columns before insert or update on public.monitoring_events for each row execute function private.monitoring_store_event_columns();
revoke all on function private.monitoring_event_columns(public.monitoring_events),private.monitoring_expand_event_payload(jsonb,jsonb),private.monitoring_pack_event_payload(jsonb,jsonb),private.monitoring_event_payload(public.monitoring_events),private.monitoring_store_event_columns() from public,anon,authenticated,service_role;

do $$declare definition text;needle text:='''payload'',e.payload';begin
 definition:=pg_get_functiondef('private.monitoring_input_before_calendar(uuid,date,date)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'MONITORING_EVENT_INPUT_CHANGED';end if;
 execute replace(definition,needle,'''payload'',private.monitoring_event_payload(e)');
end $$;
