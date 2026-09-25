create or replace function private.lock_admin_profile_mutations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(824202609, 1);
  return null;
end;
$$;

create or replace function private.guard_last_approved_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status_usuario = 'APROVADO' and old.papel_usuario = 'ADMIN' then
      perform private.assert_active_admin_remains(old.id);
    end if;
    return old;
  end if;

  if old.status_usuario = 'APROVADO'
    and old.papel_usuario = 'ADMIN'
    and (new.status_usuario is distinct from old.status_usuario
      or new.papel_usuario is distinct from old.papel_usuario) then
    perform private.assert_active_admin_remains(old.id);
  end if;

  return new;
end;
$$;

revoke all on function private.lock_admin_profile_mutations() from public, anon, authenticated;
revoke all on function private.guard_last_approved_admin() from public, anon, authenticated;

create trigger perfis_admin_mutation_lock
before update of status_usuario, papel_usuario or delete on public.perfis
for each statement execute function private.lock_admin_profile_mutations();

create trigger perfis_preserve_last_approved_admin
before update of status_usuario, papel_usuario or delete on public.perfis
for each row execute function private.guard_last_approved_admin();
