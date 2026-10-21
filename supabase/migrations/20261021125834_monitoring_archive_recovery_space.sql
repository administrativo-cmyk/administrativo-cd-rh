-- Recover bootstrap space without removing records or uniqueness constraints.
-- The device index is replaced by an access-only index after the archive cutover.
do $$begin
 if exists(select 1 from pg_index where indexrelid=to_regclass('public.monitoring_events_device_time') and (indisunique or indisprimary)) then raise exception 'ARCHIVE_UNSAFE_INDEX';end if;
end $$;
drop index if exists public.monitoring_events_device_time;
