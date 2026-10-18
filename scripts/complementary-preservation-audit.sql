-- Read-only aggregate fingerprints, safe before and after complementary activation.
-- Catalog names/keys and updated_at are the intentional employee normalization.
-- Runtime heartbeat fields are excluded because the import watcher remains active.
-- New binding revision metadata is excluded; the existing binding facts are compared.
with rows as (
 select 'colaboradores_core' dataset, md5((to_jsonb(t)-array['setor','funcao','categoria','updated_at','department_catalog_id','job_catalog_id','category_catalog_id'])::text) fingerprint from public.colaboradores t
 union all select 'banco_horas_medicoes',md5(to_jsonb(t)::text) from public.banco_horas_medicoes t
 union all select 'chamada_diaria',md5(to_jsonb(t)::text) from public.chamada_diaria t
 union all select 'monitoring_sources_identity',md5(jsonb_build_object('id',id,'kind',kind,'timezone',timezone,'identity_namespace',identity_namespace)::text) from public.monitoring_sources
 union all select 'monitoring_events',md5(to_jsonb(t)::text) from public.monitoring_events t
 union all select 'monitoring_occurrences',md5(to_jsonb(t)::text) from public.monitoring_occurrences t
 union all select 'monitoring_people',md5(to_jsonb(t)::text) from public.monitoring_people t
 union all select 'monitoring_photos',md5(to_jsonb(t)::text) from public.monitoring_photos t
 union all select 'monitoring_bindings',md5((to_jsonb(t)-array['updated_at','revision','supersedes_id'])::text) from public.monitoring_bindings t
 union all select 'monitoring_settings',md5(to_jsonb(t)::text) from public.monitoring_settings t
), datasets as (
 select unnest(array['colaboradores_core','banco_horas_medicoes','chamada_diaria','monitoring_sources_identity','monitoring_events','monitoring_occurrences','monitoring_people','monitoring_photos','monitoring_bindings','monitoring_settings']) dataset
), totals as (
 select d.dataset,count(r.fingerprint) total,md5(coalesce(string_agg(r.fingerprint,'' order by r.fingerprint),'')) fingerprint
 from datasets d left join rows r using(dataset) group by d.dataset
)
select jsonb_build_object('captured_at',now(),'datasets',(select jsonb_object_agg(dataset,jsonb_build_object('total',total,'fingerprint',fingerprint)) from totals)) as preservation_audit;
