-- A newly detected return issue must be visible in today's notifications even
-- when maternity leave or another long absence was registered months ago.
alter table private.employee_lifecycle_signals add column detected_at timestamptz not null default clock_timestamp();
do $migration$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('private.employee_lifecycle_tick()'::regprocedure);
 needle:='on conflict(employee_id) do update set kind=excluded.kind,evidence=excluded.evidence,employee_version=excluded.employee_version,evaluated_at=clock_timestamp();';
 if strpos(definition,needle)=0 then raise exception 'RETURN_SIGNAL_DEFINITION_CHANGED';end if;
 execute replace(definition,needle,'on conflict(employee_id) do update set detected_at=case when private.employee_lifecycle_signals.kind is distinct from excluded.kind or private.employee_lifecycle_signals.employee_version is distinct from excluded.employee_version then clock_timestamp() else private.employee_lifecycle_signals.detected_at end,kind=excluded.kind,evidence=excluded.evidence,employee_version=excluded.employee_version,evaluated_at=clock_timestamp();');
 definition:=pg_get_functiondef('private.workspace_notifications(uuid,public.papel_usuario,uuid)'::regprocedure);
 needle:='''/administracao/colaboradores'',c.updated_at';
 if strpos(definition,needle)=0 then raise exception 'RETURN_NOTICE_DEFINITION_CHANGED';end if;
 execute replace(definition,needle,'''/administracao/colaboradores'',s.detected_at');
end $migration$;
