-- Defense exports differ in accents between person and access reports.
-- Fold spelling only in this comparison; immutable occurrences retain the original labels.
create or replace function private.monitoring_defense_comparison_text(p_text text) returns text
language sql immutable returns null on null input set search_path='' as $$
 select upper(regexp_replace(normalize(regexp_replace(btrim(p_text),'\s+',' ','g'),NFD),U&'[\0300-\036F]','','g'))
$$;
revoke all on function private.monitoring_defense_comparison_text(text) from public,anon,authenticated,service_role;

create or replace function private.monitoring_normalize_defense_groups(p_groups jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(g order by g),'[]'::jsonb) from (
  select distinct private.monitoring_defense_comparison_text(btrim(regexp_replace(part,'^.*[/\\]',''))) g
  from jsonb_array_elements_text(case when jsonb_typeof(p_groups)='array' then p_groups else '[]'::jsonb end) v
  cross join lateral regexp_split_to_table(v,',') part
 ) groups where g<>''
$$;
revoke all on function private.monitoring_normalize_defense_groups(jsonb) from public,anon,authenticated,service_role;

-- Apply the same spelling comparison to names, without matching identities by name.
do $$declare definition text;
 old_name text:='upper(normalize(regexp_replace(btrim(name),''\s+'','' '',''g''),NFC))';
 old_person_name text:='upper(normalize(regexp_replace(btrim(pe.name),''\s+'','' '',''g''),NFC))';
begin
 definition:=pg_get_functiondef('private.monitoring_collect_group_file(uuid)'::regprocedure);
 if strpos(definition,old_name)>0 and strpos(definition,old_person_name)>0 then
  definition:=replace(replace(definition,old_name,'private.monitoring_defense_comparison_text(name)'),old_person_name,'private.monitoring_defense_comparison_text(pe.name)');execute definition;
 elsif strpos(definition,'private.monitoring_defense_comparison_text(pe.name)')=0 then
  raise exception 'DEFENSE_GROUP_SPELLING_TARGET_CHANGED';
 end if;
end $$;

-- Rebuild only the derived comparison values, preserving receipt dates and raw evidence.
update private.monitoring_group_observations o set
 names=(select coalesce(jsonb_agg(n order by n),'[]'::jsonb) from (
  select distinct private.monitoring_defense_comparison_text(v) n from jsonb_array_elements_text(o.names) v
 ) normalized),
 variants=(select coalesce(jsonb_agg(g order by g),'[]'::jsonb) from (
  select distinct private.monitoring_normalize_defense_groups(v) g from jsonb_array_elements(o.variants) v
 ) normalized);
