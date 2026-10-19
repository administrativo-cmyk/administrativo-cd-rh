-- Complete the existing audit entry with final lifecycle fields. Automatic returns
-- share the scoped, redacted history without impersonating an administrator.
do $migration$
declare definition text;needle text;view_definition text;
begin
 definition:=pg_get_functiondef('private.administration_lifecycle(text,text,jsonb)'::regprocedure);
 needle:='cpf_value:=nullif(p_data->>''cpf'','''');pis_value:=nullif(p_data->>''pis'','''');';
 if strpos(definition,needle)=0 then raise exception 'LIFECYCLE_IDENTIFIER_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,'cpf_value:=case when p_data?''cpf'' then nullif(p_data->>''cpf'','''') else (select cpf from private.employee_identifiers where employee_id=previous.id) end;pis_value:=case when p_data?''pis'' then nullif(p_data->>''pis'','''') else (select pis from private.employee_identifiers where employee_id=previous.id) end;');
 needle:='return result||jsonb_build_object(''record'',after_row);';
 if strpos(definition,needle)=0 then raise exception 'LIFECYCLE_AUDIT_DEFINITION_CHANGED';end if;
 execute replace(definition,needle,'update private.administration_audit set after_record=after_row where id=(result->>''auditId'')::bigint; '||needle);
 view_definition:=rtrim(pg_get_viewdef('private.audit_history_records'::regclass,true),E';\n ');
 execute 'create or replace view private.audit_history_records with(security_invoker=true) as '||view_definition||' union all select ''lifecycle:''||id::text,''cadastros''::text,''employee''::text,employee_id::text,action,actor,created_at,reason,before_record,after_record||jsonb_build_object(''evidence'',evidence),employee_id from private.employee_lifecycle_audit where action=''automatic_return''';
end $migration$;
revoke all on private.audit_history_records from public,anon,authenticated,service_role;
