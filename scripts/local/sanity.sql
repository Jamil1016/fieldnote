\pset footer off
\echo == row counts
select 'teams' t, count(*) from fn_demo.teams union all select 'members', count(*) from fn_demo.members
union all select 'approver_assignments', count(*) from fn_demo.approver_assignments
union all select 'daily_reports', count(*) from fn_demo.daily_reports
union all select 'report_task_lines', count(*) from fn_demo.report_task_lines
union all select 'timer_entries', count(*) from fn_demo.timer_entries
union all select 'holidays', count(*) from fn_demo.holidays
union all select 'pipeline_runs', count(*) from fn_demo.pipeline_runs
union all select 'app_user', count(*) from fn_app.app_user
union all select 'settings', count(*) from fn_app.settings
union all select 'approval_log', count(*) from fn_app.approval_log
union all select 'approval_batch', count(*) from fn_app.approval_batch
union all select 'approval_batch_item', count(*) from fn_app.approval_batch_item
union all select 'reminder_log', count(*) from fn_app.reminder_log
union all select 'audit_log', count(*) from fn_app.audit_log;
\echo == awaiting approval
select count(*) awaiting, round(100.0*count(*)/(select count(*) from fn_demo.daily_reports),1) pct from fn_analytics.v_approval_queue;
\echo == SLA buckets (48h rule, due soon = under 12h left)
select case when approval_due_at < now() then 'overdue' when approval_due_at < now() + interval '12 hours' then 'due_soon' else 'on_time' end bucket, count(*)
from fn_analytics.v_approval_queue group by 1 order by 1;
\echo == awaiting per team
select team_name, count(*) from fn_analytics.v_approval_queue group by 1 order by 1;
\echo == variance breach rate per team (naive timer sum in SQL, last 30 working days approx; app uses merged intervals in TS)
with t as (select member_id, (started_at at time zone 'UTC')::date d, sum(extract(epoch from ended_at-started_at))/3600 h from fn_demo.timer_entries group by 1,2)
select tm.name, count(*) days, round(100.0*count(*) filter (where abs(r.hours_claimed - t.h)/t.h >= 0.15)/count(*),1) breach_pct,
 round(avg((r.hours_claimed - t.h)/t.h*100)::numeric,1) mean_var_pct
from fn_demo.daily_reports r join t on t.member_id=r.member_id and t.d=r.report_date join fn_demo.members m on m.id=r.member_id join fn_demo.teams tm on tm.id=m.team_id
where r.report_date >= current_date - 42 group by 1 order by 1;
\echo == late filing (filed after 10:00 next working day)
select count(*) filter (where filed_at > (fn_demo.next_working_day(report_date)::timestamp + interval '10 hours') at time zone 'UTC') late, count(*) total from fn_demo.daily_reports;
\echo == timer entries crossing midnight / overlapping
select count(*) filter (where (started_at at time zone 'UTC')::date <> (ended_at at time zone 'UTC')::date) crossing from fn_demo.timer_entries;
select count(*) overlapping from fn_demo.timer_entries a where exists (select 1 from fn_demo.timer_entries b where b.member_id=a.member_id and b.id<a.id and b.ended_at > a.started_at and b.started_at < a.ended_at);
\echo == scorecard RPC
select * from fn_analytics.approver_scorecard(30);
\echo == reminder candidates
select fn_demo.is_working_day(current_date-1) y_is_wd, (select max(report_date) from fn_demo.daily_reports) last_report_day;
select count(*) missing_last_working_day from fn_analytics.members_missing_report((select max(report_date) from fn_demo.daily_reports));
select approver_member_id, full_name, overdue_count from fn_analytics.approvers_with_overdue();
\echo == freshness
select max(finished_at) last_success, now() - max(finished_at) age from fn_analytics.v_pipeline_runs where status='succeeded';
\echo == anon / authenticated privileges (expect all false / zero)
select n.nspname, has_schema_privilege('anon', n.nspname, 'usage') anon_usage, has_schema_privilege('authenticated', n.nspname, 'usage') auth_usage, has_schema_privilege('service_role', n.nspname, 'usage') service_usage
from pg_namespace n where n.nspname in ('fn_app','fn_demo','fn_analytics') order by 1;
select count(*) functions_executable_by_anon_or_public from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('fn_app','fn_demo','fn_analytics') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
select count(*) tables_without_rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('fn_app','fn_demo') and c.relkind='r' and not c.relrowsecurity;
select count(*) functions_without_pinned_search_path from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('fn_app','fn_demo','fn_analytics') and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%');
