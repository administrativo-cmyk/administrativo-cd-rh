-- Retain the open payroll cycle (21st through 20th) and its two predecessors.
-- Rows leave the operational database only through the existing verified archive.
create function private.monitoring_archive_payroll_cutoff(p_today date)
returns date language sql immutable strict set search_path='' as $$
 select (date_trunc('month',p_today::timestamp)
  -make_interval(months => case when extract(day from p_today)<21 then 3 else 2 end)
  +interval '20 days')::date
$$;
revoke all on function private.monitoring_archive_payroll_cutoff(date) from public,anon,authenticated,service_role;

create or replace function private.monitoring_archive_cutoff()
returns date language sql stable security definer set search_path='' as $$
 select private.monitoring_archive_payroll_cutoff((clock_timestamp() at time zone 'America/Sao_Paulo')::date)
$$;
revoke all on function private.monitoring_archive_cutoff() from public,anon,authenticated,service_role;

comment on column private.monitoring_archive_control.months is
 'Legacy name: retains three payroll cycles, the current cycle and two predecessors, each from the 21st to the 20th.';

-- Wake the existing cloud scheduler now; future cycle changes are checked there.
update private.monitoring_archive_retention set pending=true,checked_at='-infinity' where id;
