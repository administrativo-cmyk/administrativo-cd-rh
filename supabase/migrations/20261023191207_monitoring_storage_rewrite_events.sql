set local lock_timeout='5s';
set local statement_timeout='120s';
do $$begin if exists(select 1 from private.monitoring_archive_control where active and not maintenance) then raise exception 'ARCHIVE_MAINTENANCE_REQUIRED';end if;end $$;
-- A same-type expression forces a fresh heap and indexes without UPDATE
-- triggers, retaining IDs, NSRs, timestamps and hashes. The codec is lossless.
alter table public.monitoring_events alter column payload type jsonb using
 private.monitoring_pack_event_payload(payload,jsonb_build_object('key',event_key,'type',event_type,
  'identity',jsonb_build_object('type',identity_type,'value',identity_value),'device',device,
  'classification',classification,'eligible',eligible,'nsr',nsr,'rawIdentifier',identity_value));
analyze public.monitoring_events;
alter table public.monitoring_events set(autovacuum_vacuum_scale_factor=0.02,autovacuum_vacuum_threshold=500,autovacuum_analyze_scale_factor=0.05,autovacuum_analyze_threshold=500);
