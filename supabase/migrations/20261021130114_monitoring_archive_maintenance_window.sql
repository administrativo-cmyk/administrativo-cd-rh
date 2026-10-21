-- Only an explicitly opened archive maintenance run may enable this temporary
-- database-level override. Monitored tables remain frozen by their write guard.
do $$begin
 if exists(select 1 from private.monitoring_archive_control where id and maintenance) then
  execute format('alter database %I set default_transaction_read_only = off',current_database());
 end if;
end $$;
