-- An observed time pattern can attribute an overnight punch, but cannot establish
-- the employee's weekly roster or authorize an automatic absence.
do $migration$
declare
 definition text;
 needle text:=$old$ elsif n=1 and not v_expected then v_state:='not_expected';v_blockers:='[]';$old$;
 replacement text:=$new$ elsif n=1 and (sched.payload->>'weeklyRosterConfirmed'='false' or sched.payload->>'estimated'='true') then
   v_blockers:=v_blockers||'"WEEKLY_ROSTER_UNCONFIRMED"'::jsonb;
 elsif n=1 and not v_expected then v_state:='not_expected';v_blockers:='[]';$new$;
begin
 if strpos(pg_get_functiondef('private.daily_call_evidence(uuid,date)'::regprocedure),
   'private.daily_call_evidence_before_calendar(p_employee,p_date)')=0 then
   raise exception 'ESTIMATED_SCHEDULE_UNEXPECTED_CALENDAR_WRAPPER';
 end if;
 definition:=pg_get_functiondef('private.daily_call_evidence_before_calendar(uuid,date)'::regprocedure);
 if strpos(definition,replacement)>0 then return; end if;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
   raise exception 'ESTIMATED_SCHEDULE_UNEXPECTED_EVIDENCE_DEFINITION';
 end if;
 execute replace(definition,needle,replacement);
end;
$migration$;
