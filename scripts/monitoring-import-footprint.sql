-- Read-only attribution for the three most recently submitted imports.
-- pg_column_size measures row data, not private allocations of shared pages,
-- indexes, WAL, dead tuples, or employee/day calculations. These totals are not
-- a before/after measurement of the physical database. Event counts must match
-- new_events before treating the event attribution as complete.
with latest as materialized (
 select j.*,f.id file_id,f.new_events
 from private.monitoring_cloud_jobs j join public.monitoring_files f
  on f.source_id=j.source_id and f.sha256=j.sha256 and f.parser_version=j.parser_version
 order by j.created_at desc limit 3
), row_data as (
 select j.id,j.file_name,j.created_at,j.completed_at,j.byte_length upload_bytes,j.new_events,
  'events' component,count(e.id) rows,coalesce(sum(pg_column_size(e)),0)::bigint bytes
 from latest j left join public.monitoring_events e
  on exists(select 1 from public.monitoring_occurrences o where o.file_id=j.file_id and o.event_id=e.id)
  and not exists(select 1 from public.monitoring_occurrences o join public.monitoring_files other on other.id=o.file_id
   where o.event_id=e.id and o.file_id<>j.file_id and other.completed_at<j.completed_at)
 group by j.id,j.file_name,j.created_at,j.completed_at,j.byte_length,j.new_events
), components as (
 select id,'events' component,bytes from row_data
 union all select j.id,'occurrences',coalesce(sum(pg_column_size(o)),0) from latest j left join public.monitoring_occurrences o on o.file_id=j.file_id group by j.id
 union all select j.id,'file',pg_column_size(f) from latest j join public.monitoring_files f on f.id=j.file_id
 union all select j.id,'cloud_job',pg_column_size(c) from latest j join private.monitoring_cloud_jobs c on c.id=j.id
 union all select j.id,'batches',coalesce(sum(pg_column_size(b)),0) from latest j left join public.monitoring_batches b on b.file_id=j.file_id group by j.id
 union all select j.id,'audit',coalesce(sum(pg_column_size(a)),0) from latest j left join public.monitoring_audit a on a.target in(j.id::text,j.file_id::text) group by j.id
 union all select j.id,'group_receipt',coalesce(sum(pg_column_size(g)),0) from latest j left join private.monitoring_group_files g on g.file_id=j.file_id group by j.id
 union all select j.id,'group_observations',coalesce(sum(pg_column_size(g)),0) from latest j left join private.monitoring_group_observations g on g.file_id=j.file_id group by j.id
 union all select j.id,'people',coalesce(sum(pg_column_size(p)),0) from latest j left join public.monitoring_people p on p.file_id=j.file_id group by j.id
 union all select j.id,'archive_receipt',coalesce(sum(pg_column_size(a)),0) from latest j left join private.monitoring_archive_files a on a.source_id=j.source_id and a.sha256=j.sha256 and a.parser_version=j.parser_version group by j.id
 union all select j.id,'archive_catalog_dedicated',coalesce(sum(pg_column_size(o)),0) from latest j left join private.monitoring_archive_objects o on o.metadata->>'fileSha256'=j.sha256 group by j.id
)
select r.file_name,r.created_at,r.completed_at,r.upload_bytes,r.new_events,r.rows attributed_events,
 sum(c.bytes) direct_database_row_bytes,jsonb_object_agg(c.component,c.bytes) database_components,
 (select coalesce(sum(o.bytes),0) from private.monitoring_archive_objects o where o.metadata->>'fileSha256'=j.sha256) dedicated_archive_storage_bytes,
 -- Shard indexes are shared with older imports. Report separately, never count
 -- their full size as incremental growth caused by this particular upload.
 (select coalesce(sum(o.bytes),0) from private.monitoring_archive_objects o
  where o.kind='nsr_index' and o.metadata->>'sourceId'=j.source_id and o.verified_at between j.created_at and j.completed_at) shared_index_objects_written_bytes,
 (select coalesce(sum(pg_column_size(o)),0) from private.monitoring_archive_objects o
  where o.kind='nsr_index' and o.metadata->>'sourceId'=j.source_id and o.verified_at between j.created_at and j.completed_at) shared_index_catalog_row_bytes,
 pg_database_size(current_database()) physical_database_bytes,clock_timestamp() measured_at
from row_data r join latest j on j.id=r.id join components c on c.id=r.id
group by r.id,r.file_name,r.created_at,r.completed_at,r.upload_bytes,r.new_events,r.rows,j.source_id,j.sha256,j.created_at,j.completed_at
order by r.created_at;
