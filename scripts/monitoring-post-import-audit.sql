-- Run in the authorized SQL editor of the verified target project.
-- Read-only aggregate audit: no names, identifiers, photo bytes or credentials.
-- Expected first import: 4 files, 45,266 canonical events, 45,717 occurrences,
-- 353 people, 299 photos, 0 bindings and 0 automatic attendance entries.

-- 1. Global totals and safeguards. Existing manual attendance remains separate.
select jsonb_build_object(
  'sources', (select count(*) from public.monitoring_sources),
  'files', (select count(*) from public.monitoring_files),
  'canonical_events', (select count(*) from public.monitoring_events),
  'raw_occurrences', (select count(*) from public.monitoring_occurrences),
  'people', (select count(*) from public.monitoring_people),
  'photos', (select count(*) from public.monitoring_photos),
  'bindings_total', (select count(*) from public.monitoring_bindings),
  'bindings_active', (select count(*) from public.monitoring_bindings where revoked_at is null),
  'account_links', (select count(*) from public.monitoring_settings where kind='user_link' and revoked_at is null),
  'attendance_total', (select count(*) from public.chamada_diaria),
  'attendance_manual', (select count(*) from public.chamada_diaria where origin='manual'),
  'attendance_imported', (select count(*) from public.chamada_diaria where origin in ('punch','automatic_absence')),
  'files_complete', (select count(*) from public.monitoring_files where status='complete'),
  'files_not_complete', (select count(*) from public.monitoring_files where status<>'complete'),
  'rejected_rows', (select coalesce(sum(rejected_rows),0) from public.monitoring_files),
  'conflict_rows', (select coalesce(sum(conflict_rows),0) from public.monitoring_files),
  'conflicted_events', (select count(*) from public.monitoring_events where conflicted),
  'conflicted_occurrences', (select count(*) from public.monitoring_occurrences where conflict),
  'canonical_key_duplicates', (select count(*) from (select source_id,event_key from public.monitoring_events group by source_id,event_key having count(*)>1) duplicates),
  'read_failures', (select count(*) from public.monitoring_attempts),
  'pending_jobs', (select count(*) from public.monitoring_jobs)
) as import_audit;

-- 2. Counts by source. Source IDs describe configured inputs, not employees.
with file_counts as (
  select source_id,count(*) files,count(*) filter(where status='complete') complete_files,
    count(*) filter(where status<>'complete') incomplete_files,
    coalesce(sum(expected_rows),0) expected_occurrences,coalesce(sum(processed_rows),0) processed_rows,
    coalesce(sum(accepted_rows),0) accepted_rows,coalesce(sum(new_events),0) new_events,
    coalesce(sum(repeated_events),0) repeated_events,coalesce(sum(rejected_rows),0) rejected_rows,
    coalesce(sum(conflict_rows),0) conflict_rows
  from public.monitoring_files group by source_id
), event_counts as (
  select source_id,count(*) canonical_events,count(*) filter(where event_type='punch') punches,
    count(*) filter(where event_type='access') access_events,
    count(distinct (identity_type,identity_value)) filter(where identity_value is not null) identities,
    count(*) filter(where conflicted) conflicted_events
  from public.monitoring_events group by source_id
), occurrence_counts as (
  select f.source_id,count(*) raw_occurrences,count(*) filter(where o.event_id is not null) event_occurrences
  from public.monitoring_occurrences o join public.monitoring_files f on f.id=o.file_id group by f.source_id
), people_counts as (
  select p.source_id,count(*) people,count(*) filter(where p.ambiguous) ambiguous_people,
    count(*) filter(where p.photo_reference is not null and btrim(p.photo_reference)<>'') photo_references,
    count(*) filter(where exists(select 1 from public.monitoring_photos photo where photo.source_id=p.source_id and photo.identity_value=p.external_id)) people_with_photo
  from public.monitoring_people p group by p.source_id
), photo_counts as (
  select source_id,count(*) photos from public.monitoring_photos group by source_id
)
select s.id as source_id,s.kind,s.worker_state,s.last_error,
  coalesce(f.files,0) files,coalesce(f.complete_files,0) complete_files,
  coalesce(f.incomplete_files,0) incomplete_files,coalesce(f.expected_occurrences,0) expected_occurrences,
  coalesce(f.processed_rows,0) processed_rows,coalesce(f.accepted_rows,0) accepted_rows,
  coalesce(e.canonical_events,0) canonical_events,coalesce(o.raw_occurrences,0) raw_occurrences,
  coalesce(o.event_occurrences,0) event_occurrences,coalesce(e.punches,0) punches,
  coalesce(e.access_events,0) access_events,coalesce(e.identities,0) distinct_identities,
  coalesce(f.new_events,0) new_events,coalesce(f.repeated_events,0) repeated_events,
  coalesce(f.rejected_rows,0) rejected_rows,coalesce(f.conflict_rows,0) conflict_rows,
  coalesce(e.conflicted_events,0) conflicted_events,coalesce(p.people,0) people,
  coalesce(p.ambiguous_people,0) ambiguous_people,coalesce(p.photo_references,0) photo_references,
  coalesce(p.people_with_photo,0) people_with_photo,coalesce(ph.photos,0) photos
from public.monitoring_sources s
left join file_counts f on f.source_id=s.id left join event_counts e on e.source_id=s.id
left join occurrence_counts o on o.source_id=s.id left join people_counts p on p.source_id=s.id
left join photo_counts ph on ph.source_id=s.id
order by s.kind,s.id;

-- 3. Photo integrity, without returning hashes, IDs or image content.
-- Invalid base64 is counted before decode so a malformed image cannot abort audit.
with encoded as (
  select source_id,identity_value,sha256,mime_type,base64,
    length(base64)>0 and length(base64)%4=0 and base64 ~ '^[A-Za-z0-9+/]*={0,2}$' as valid_base64
  from public.monitoring_photos
), decoded as (
  select *,case when valid_base64 then decode(base64,'base64') end as image_bytes from encoded
)
select source_id,count(*) photos,
  count(*) filter(where not valid_base64) invalid_base64,
  count(*) filter(where mime_type not in ('image/jpeg','image/png','image/webp')) unsupported_mime,
  min(octet_length(image_bytes)) min_decoded_bytes,max(octet_length(image_bytes)) max_decoded_bytes,
  sum(octet_length(image_bytes)) total_decoded_bytes,
  count(*) filter(where octet_length(image_bytes)=0 or octet_length(image_bytes)>2097152) invalid_size,
  count(*) filter(where valid_base64 and encode(sha256(image_bytes),'hex')<>sha256) hash_mismatches,
  count(*) filter(where not exists(select 1 from public.monitoring_people p where p.source_id=decoded.source_id and p.external_id=decoded.identity_value)) photos_without_person
from decoded group by source_id order by source_id;

-- 4. Raw versus canonical events. All repeated raw occurrences remain preserved.
with totals as (
  select e.source_id,e.event_type,e.classification,count(*) canonical_events,
    (select count(*) from public.monitoring_occurrences o join public.monitoring_events raw_event on raw_event.id=o.event_id
      where raw_event.source_id=e.source_id and raw_event.event_type=e.event_type and raw_event.classification=e.classification) raw_event_occurrences
  from public.monitoring_events e group by e.source_id,e.event_type,e.classification
)
select source_id,event_type,classification,canonical_events,raw_event_occurrences,
  raw_event_occurrences-canonical_events additional_raw_occurrences
from totals order by source_id,event_type,classification;

-- 5. Defense correspondence only; this is not an RH association.
with access_ids as (
  select distinct s.identity_namespace,e.identity_value
  from public.monitoring_events e join public.monitoring_sources s on s.id=e.source_id
  where e.event_type='access' and e.identity_type='defense' and e.identity_value is not null
), person_ids as (
  select distinct s.identity_namespace,p.external_id
  from public.monitoring_people p join public.monitoring_sources s on s.id=p.source_id
)
select (select count(*) from access_ids) access_identities,
  (select count(*) from person_ids) person_identities,
  (select count(*) from access_ids a where exists(select 1 from person_ids p where p.identity_namespace=a.identity_namespace and p.external_id=a.identity_value)) exact_defense_matches,
  (select count(*) from access_ids a where not exists(select 1 from person_ids p where p.identity_namespace=a.identity_namespace and p.external_id=a.identity_value)) access_ids_without_person,
  (select count(*) from person_ids p where not exists(select 1 from access_ids a where a.identity_namespace=p.identity_namespace and a.identity_value=p.external_id)) people_without_access;

-- 6. File-state totals without source filenames or file hashes.
select source_id,status,count(*) files,sum(expected_rows) expected_occurrences,
  sum(processed_rows) processed_rows,sum(accepted_rows) accepted_rows,
  sum(rejected_rows) rejected_rows,sum(conflict_rows) conflict_rows,
  count(*) filter(where completed_at is null) missing_completion_timestamp
from public.monitoring_files group by source_id,status order by source_id,status;
