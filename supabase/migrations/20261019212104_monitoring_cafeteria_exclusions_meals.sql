-- Explicit request: leadership and kitchen do not enter cafeteria duration or meal counters.
-- Existing dated group history and individual policy precedence remain authoritative.
insert into public.monitoring_settings(kind,target,valid_from,valid_to,payload,reason)
select 'policy',p.target,p.valid_from,p.valid_to,
 jsonb_build_object('indicator','cafeteria','scope','group','exclude',true),
 'Liderança e cozinha excluídas do tempo de refeitório e das refeições sem ponto de descanso, conforme solicitação do usuário em 19/10/2026'
from public.monitoring_settings p
where p.kind='policy' and p.payload->>'scope'='group' and p.payload->>'indicator'='outsideOperation' and p.payload->>'exclude'='true'
 and private.monitoring_defense_comparison_text(p.target) in ('COZINHA JK','LIDERANCA JK')
 and p.revoked_at is null and not exists(select 1 from public.monitoring_settings n where n.supersedes_id=p.id)
 and not exists(select 1 from public.monitoring_settings c where c.kind='policy' and c.revoked_at is null
  and not exists(select 1 from public.monitoring_settings n where n.supersedes_id=c.id)
  and c.payload->>'indicator'='cafeteria' and c.payload->>'scope'='group'
  and private.monitoring_defense_comparison_text(c.target)=private.monitoring_defense_comparison_text(p.target)
  and c.valid_from=p.valid_from and c.valid_to is not distinct from p.valid_to);

-- Add the count to the same scoped summary query, before filters and pagination are returned.
do $$declare definition text;
 old_total text:='''cafeteriaSeconds'',sum((summary->>''cafeteriaSeconds'')::numeric),';
begin
 definition:=pg_get_functiondef('private.monitoring_query_before_group_observations(text,jsonb)'::regprocedure);
 if strpos(definition,old_total)=0 then raise exception 'MEAL_SUMMARY_PATCH_TARGET_CHANGED';end if;
 definition:=replace(definition,old_total,old_total||'''mealsWithoutRest'',sum((summary->>''mealsWithoutRest'')::numeric),');
 execute definition;
end $$;

-- Invalidate derived results only. Original events, Chamada and Bank measurements are untouched.
update public.monitoring_results set dirty=true where active;
select private.monitoring_enqueue();
insert into public.monitoring_audit(actor,action,target,detail)
values(null,'cafeteria_exclusions_meals_enabled','monitoring-1.4.0',jsonb_build_object('reason','Exclusões de liderança/cozinha e refeições sem descanso solicitadas pelo usuário'));
