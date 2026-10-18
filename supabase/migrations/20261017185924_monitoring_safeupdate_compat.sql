-- Supabase/PostgREST safeupdate rejects UPDATE without a WHERE clause, even
-- for singleton revision tables. Their boolean primary key is constrained true.
-- Keep safeupdate enabled and address the actual singleton row by its key.
-- The guarded replacements preserve function OIDs, grants, settings and callers.
do $migration$
declare
  target record;
  original_definition text;
  patched_definition text;
  actual_matches integer;
begin
  for target in select * from (values
    ('private.monitoring_ingest_impl(jsonb)',
      'update private.monitoring_revision set version=version+1;',2),
    ('private.monitoring_query_impl(text,jsonb)',
      'update private.monitoring_revision set version=version+1;',1),
    ('private.monitoring_save_result_before_attendance(jsonb)',
      'update private.monitoring_revision set results_version=results_version+1;',1),
    ('private.daily_call_change()',
      'update private.daily_call_revision set version=version+1;',1),
    ('private.daily_call_apply_import_impl(jsonb)',
      'update private.daily_call_revision set version=version+1;',1),
    ('chamada_privada.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamp with time zone)',
      'update private.daily_call_revision set version=version+1;',1),
    ('private.daily_call_source_ready()',
      'update private.monitoring_revision set version=version+1;',1),
    ('private.daily_call_source_failure()',
      'update private.monitoring_revision set version=version+1;',1),
    ('private.daily_call_baseline_changed()',
      'update private.daily_call_revision set version=version+1;',1)
  ) as patches(signature,statement,expected_matches)
  loop
    select pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(target.signature)) into original_definition;
    if original_definition is null then
      raise exception 'SAFEUPDATE_COMPAT_MISSING_FUNCTION: %',target.signature;
    end if;
    actual_matches := (length(original_definition)-length(replace(original_definition,target.statement,'')))/length(target.statement);
    if actual_matches <> target.expected_matches then
      raise exception 'SAFEUPDATE_COMPAT_UNEXPECTED_DEFINITION: % (expected %, found %)',target.signature,target.expected_matches,actual_matches;
    end if;
    patched_definition := replace(original_definition,target.statement,
      left(target.statement,length(target.statement)-1)||' where id=true;');
    execute patched_definition;
  end loop;
end;
$migration$;
