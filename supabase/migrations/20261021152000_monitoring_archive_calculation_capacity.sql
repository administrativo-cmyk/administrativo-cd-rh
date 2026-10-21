-- Calculation revisions and audit must respect the same reserve as imported events.
create trigger monitoring_archive_capacity before insert on public.monitoring_results for each statement execute function private.monitoring_archive_capacity();
create trigger monitoring_archive_capacity before insert on public.monitoring_audit for each statement execute function private.monitoring_archive_capacity();
