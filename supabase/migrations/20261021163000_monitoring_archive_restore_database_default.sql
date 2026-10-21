-- The temporary override was used only to recover a full database. Once the
-- operational archive is active and below the reserve, use the platform default.
do $$begin
 if exists(select 1 from private.monitoring_archive_control where id and active and not maintenance)
  and pg_database_size(current_database())<470*1024*1024 then
  execute format('alter database %I reset default_transaction_read_only',current_database());
 end if;
end $$;
