-- =============================================================================
-- Fieldnote: database schema (idempotent; safe to run repeatedly)
--
-- HOW TO APPLY
--   1. Supabase Dashboard -> SQL Editor -> paste and run this file.
--   2. Then run supabase/seed.sql, then supabase/reset_demo.sql.
--   3. Dashboard -> Project Settings -> API -> "Exposed schemas": add
--        fn_app, fn_analytics
--      and nothing else from this file. fn_demo must NOT be exposed; the app
--      only reaches it through the fn_analytics views and functions.
--   4. Nightly reset (optional, needs the pg_cron extension):
--        select cron.schedule('fieldnote-nightly-reset', '10 19 * * *',
--                             $$select fn_demo.reset_demo()$$);
--
-- LAYOUT
--   fn_demo       base seed tables (teams, members, reports, timers, ...)
--   fn_app        working tables the app writes (batches, logs, settings)
--   fn_analytics  read views and RPCs the app queries
--
-- SECURITY MODEL
--   The app reads and writes only through the service-role key, on the server.
--   RLS is enabled on every table with NO policies, nothing is granted to
--   anon or authenticated, and EXECUTE on every function is revoked from
--   public, anon and authenticated. Every function pins search_path = ''.
--   All three schemas are new, so this file can share a Supabase project with
--   another demo without touching its objects.
-- =============================================================================

create schema if not exists fn_demo;
create schema if not exists fn_app;
create schema if not exists fn_analytics;

-- -----------------------------------------------------------------------------
-- fn_demo: base seed tables
-- -----------------------------------------------------------------------------

create table if not exists fn_demo.teams (
  id            integer primary key,
  code          text not null unique,
  name          text not null,
  client_label  text not null
);

create table if not exists fn_demo.members (
  id                integer primary key,
  full_name         text not null,
  email             text not null unique,
  team_id           integer not null references fn_demo.teams (id),
  position          text not null,
  shift             text not null check (shift in ('early', 'day', 'late')),
  work_arrangement  text not null check (work_arrangement in ('on_site', 'hybrid', 'remote')),
  status            text not null check (status in ('active', 'on_leave', 'inactive')),
  files_reports     boolean not null default true,
  hired_on          date not null
);

create table if not exists fn_demo.approver_assignments (
  team_id             integer not null references fn_demo.teams (id),
  approver_member_id  integer not null references fn_demo.members (id),
  is_primary          boolean not null default false,
  primary key (team_id, approver_member_id)
);

create table if not exists fn_demo.daily_reports (
  id                integer primary key,
  member_id         integer not null references fn_demo.members (id),
  report_date       date not null,
  hours_claimed     numeric(5, 2) not null check (hours_claimed >= 0),
  summary           text not null,
  filed_at          timestamptz not null,
  seed_status       text not null check (seed_status in ('awaiting', 'approved')),
  seed_approved_at  timestamptz,
  seed_approved_by  integer references fn_demo.members (id),
  unique (member_id, report_date)
);
create index if not exists daily_reports_date_idx on fn_demo.daily_reports (report_date);
create index if not exists daily_reports_awaiting_idx on fn_demo.daily_reports (seed_status) where seed_status = 'awaiting';

create table if not exists fn_demo.report_task_lines (
  id            integer primary key,
  report_id     integer not null references fn_demo.daily_reports (id) on delete cascade,
  line_no       integer not null,
  task_name     text not null,
  client_label  text not null,
  hours         numeric(5, 2) not null,
  unique (report_id, line_no)
);

create table if not exists fn_demo.timer_entries (
  id          integer primary key,
  member_id   integer not null references fn_demo.members (id),
  started_at  timestamptz not null,
  ended_at    timestamptz not null,
  task_name   text not null,
  check (ended_at > started_at)
);
create index if not exists timer_entries_member_start_idx on fn_demo.timer_entries (member_id, started_at);
create index if not exists timer_entries_start_idx on fn_demo.timer_entries (started_at);

create table if not exists fn_demo.holidays (
  holiday_date  date primary key,
  name          text not null
);

create table if not exists fn_demo.pipeline_runs (
  id           integer primary key,
  source       text not null,
  started_at   timestamptz not null,
  finished_at  timestamptz,
  status       text not null check (status in ('succeeded', 'failed', 'running')),
  rows_loaded  integer not null default 0
);

-- -----------------------------------------------------------------------------
-- fn_app: working tables
-- -----------------------------------------------------------------------------

create table if not exists fn_app.app_user (
  email         text primary key,
  display_name  text not null,
  role          text not null check (role in ('viewer', 'lead', 'manager', 'hr_staff', 'admin')),
  member_id     integer
);

create table if not exists fn_app.settings (
  key    text primary key,
  value  text not null
);

-- Append-only record of approvals made in the app. One row per report, ever:
-- the primary key is the database-level idempotency guarantee.
create table if not exists fn_app.approval_log (
  report_id           integer primary key,
  approver_email      text not null,
  approver_member_id  integer,
  batch_id            uuid,
  pm_reference        text,
  created_at          timestamptz not null default now()
);

create table if not exists fn_app.approval_batch (
  id              uuid primary key default gen_random_uuid(),
  created_by      text not null,
  created_at      timestamptz not null default now(),
  outage_after    integer check (outage_after is null or outage_after >= 0),
  outage_cleared  boolean not null default false
);
create index if not exists approval_batch_created_idx on fn_app.approval_batch (created_at desc);

create table if not exists fn_app.approval_batch_item (
  id            bigint generated always as identity primary key,
  batch_id      uuid not null references fn_app.approval_batch (id) on delete cascade,
  report_id     integer not null,
  status        text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  attempts      integer not null default 0,
  last_error    text,
  claimed_at    timestamptz,
  claimed_by    text,
  pm_reference  text,
  finished_at   timestamptz,
  unique (batch_id, report_id)
);
create index if not exists approval_batch_item_claim_idx on fn_app.approval_batch_item (batch_id, status, id);
create index if not exists approval_batch_item_report_idx on fn_app.approval_batch_item (report_id) where status = 'pending';

-- State of the SIMULATED project-management system: which idempotency keys it
-- has already accepted. A real integration would not have this table; the
-- remote system would hold that state.
create table if not exists fn_app.pm_sim_ledger (
  idempotency_key  text primary key,
  reference        text not null,
  received_at      timestamptz not null default now()
);

create table if not exists fn_app.reminder_log (
  id                  bigint generated always as identity primary key,
  kind                text not null check (kind in ('missing_report', 'approval_overdue')),
  subject_key         text not null,
  period              text not null,
  mode                text not null check (mode in ('sample', 'live')),
  recipient           text not null,
  intended_recipient  text not null,
  subject             text not null,
  run_id              uuid not null,
  delivery            text not null default 'claimed' check (delivery in ('claimed', 'logged', 'failed')),
  created_at          timestamptz not null default now(),
  constraint reminder_log_once unique (kind, subject_key, period)
);

create table if not exists fn_app.audit_log (
  id           bigint generated always as identity primary key,
  actor_email  text not null,
  action       text not null,
  entity       text not null,
  entity_id    text not null,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists audit_log_created_idx on fn_app.audit_log (created_at desc);

-- Append-only enforcement (row-level; TRUNCATE by the reset job is allowed).
create or replace function fn_app.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end;
$$;

drop trigger if exists approval_log_append_only on fn_app.approval_log;
create trigger approval_log_append_only
  before update or delete on fn_app.approval_log
  for each row execute function fn_app.forbid_mutation();

drop trigger if exists audit_log_append_only on fn_app.audit_log;
create trigger audit_log_append_only
  before update or delete on fn_app.audit_log
  for each row execute function fn_app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- fn_analytics: read views
-- -----------------------------------------------------------------------------

-- Every report with the in-app approval overlay applied on top of the seed.
create or replace view fn_analytics.v_report_status with (security_invoker = true) as
select
  r.id                                                   as report_id,
  r.member_id,
  r.report_date,
  r.hours_claimed,
  r.summary,
  r.filed_at,
  case when r.seed_status = 'approved' or l.report_id is not null
       then 'approved' else 'awaiting' end               as status,
  coalesce(l.created_at, r.seed_approved_at)             as approved_at,
  coalesce(l.approver_member_id, r.seed_approved_by)     as approved_by_member_id,
  (l.report_id is not null)                              as approved_in_app
from fn_demo.daily_reports r
left join fn_app.approval_log l on l.report_id = r.id;

-- The approval queue: reports still awaiting approval after the overlay.
-- Policy (invented): a report must be approved within 48 hours of filing.
create or replace view fn_analytics.v_approval_queue with (security_invoker = true) as
select
  s.report_id,
  s.member_id,
  m.full_name                          as member_name,
  m.position                           as member_position,
  m.team_id,
  t.name                               as team_name,
  t.client_label,
  s.report_date,
  s.hours_claimed,
  s.summary,
  s.filed_at,
  s.filed_at + interval '48 hours'     as approval_due_at,
  (select count(*)::integer from fn_demo.report_task_lines tl where tl.report_id = s.report_id) as task_count,
  exists (
    select 1 from fn_app.approval_batch_item i
    where i.report_id = s.report_id and i.status = 'pending'
  )                                    as in_open_batch
from fn_analytics.v_report_status s
join fn_demo.members m on m.id = s.member_id
join fn_demo.teams t on t.id = m.team_id
where s.status = 'awaiting';

create or replace view fn_analytics.v_directory with (security_invoker = true) as
select
  m.id             as member_id,
  m.full_name,
  m.email,
  m.position,
  m.shift,
  m.work_arrangement,
  m.status,
  m.files_reports,
  m.hired_on,
  m.team_id,
  t.name           as team_name,
  t.code           as team_code,
  t.client_label,
  lead.id          as lead_member_id,
  lead.full_name   as lead_name,
  exists (select 1 from fn_demo.approver_assignments a where a.approver_member_id = m.id) as is_approver
from fn_demo.members m
join fn_demo.teams t on t.id = m.team_id
left join fn_demo.approver_assignments pa on pa.team_id = m.team_id and pa.is_primary
left join fn_demo.members lead on lead.id = pa.approver_member_id;

create or replace view fn_analytics.v_approver_teams with (security_invoker = true) as
select a.approver_member_id, a.team_id, a.is_primary, t.name as team_name
from fn_demo.approver_assignments a
join fn_demo.teams t on t.id = a.team_id;

create or replace view fn_analytics.v_holidays with (security_invoker = true) as
select holiday_date, name from fn_demo.holidays;

create or replace view fn_analytics.v_pipeline_runs with (security_invoker = true) as
select id, source, started_at, finished_at, status, rows_loaded
from fn_demo.pipeline_runs;

-- Batch totals are COMPUTED from the items, never stored.
create or replace view fn_analytics.v_batch_summary with (security_invoker = true) as
select
  b.id                as batch_id,
  b.created_by,
  b.created_at,
  b.outage_after,
  b.outage_cleared,
  count(i.id)::integer                                            as total,
  count(i.id) filter (where i.status = 'pending')::integer        as pending,
  count(i.id) filter (where i.status = 'succeeded')::integer      as succeeded,
  count(i.id) filter (where i.status = 'failed')::integer         as failed,
  count(i.id) filter (
    where i.status = 'pending' and i.claimed_at is not null
      and i.claimed_at >= now() - interval '2 minutes'
  )::integer                                                      as active_claims,
  max(greatest(i.claimed_at, i.finished_at))                      as last_activity_at
from fn_app.approval_batch b
left join fn_app.approval_batch_item i on i.batch_id = b.id
group by b.id;

create or replace view fn_analytics.v_batch_items with (security_invoker = true) as
select
  i.id            as item_id,
  i.batch_id,
  i.report_id,
  i.status,
  i.attempts,
  i.last_error,
  i.claimed_at,
  i.claimed_by,
  i.pm_reference,
  i.finished_at,
  m.full_name     as member_name,
  t.name          as team_name,
  r.report_date,
  r.hours_claimed
from fn_app.approval_batch_item i
join fn_demo.daily_reports r on r.id = i.report_id
join fn_demo.members m on m.id = r.member_id
join fn_demo.teams t on t.id = m.team_id;

-- -----------------------------------------------------------------------------
-- fn_analytics: RPCs
-- -----------------------------------------------------------------------------

-- Per-approver scorecard over the last p_days days, computed in SQL.
create or replace function fn_analytics.approver_scorecard(p_days integer default 30)
returns table (
  approver_member_id       integer,
  approver_name            text,
  teams                    text,
  approved_count           integer,
  median_hours_to_approve  numeric,
  pct_within_sla           numeric,
  backlog                  integer,
  overdue_backlog          integer
)
language sql
stable
set search_path = ''
as $$
  with approvers as (
    select a.approver_member_id,
           m.full_name,
           string_agg(t.name, ', ' order by t.name) as teams
    from fn_demo.approver_assignments a
    join fn_demo.members m on m.id = a.approver_member_id
    join fn_demo.teams t on t.id = a.team_id
    group by a.approver_member_id, m.full_name
  ),
  done as (
    select s.approved_by_member_id as approver_member_id,
           extract(epoch from (s.approved_at - s.filed_at)) / 3600.0 as hours_to_approve
    from fn_analytics.v_report_status s
    where s.status = 'approved'
      and s.approved_at >= now() - make_interval(days => greatest(p_days, 1))
  ),
  done_agg as (
    select d.approver_member_id,
           count(*)::integer as approved_count,
           round((percentile_cont(0.5) within group (order by d.hours_to_approve))::numeric, 1) as median_hours,
           round(100.0 * count(*) filter (where d.hours_to_approve <= 48) / count(*), 1) as pct_within_sla
    from done d
    group by d.approver_member_id
  ),
  backlog as (
    select a.approver_member_id,
           count(*)::integer as backlog,
           count(*) filter (where q.approval_due_at < now())::integer as overdue_backlog
    from fn_analytics.v_approval_queue q
    join fn_demo.approver_assignments a on a.team_id = q.team_id
    group by a.approver_member_id
  )
  select ap.approver_member_id,
         ap.full_name,
         ap.teams,
         coalesce(da.approved_count, 0),
         da.median_hours,
         da.pct_within_sla,
         coalesce(b.backlog, 0),
         coalesce(b.overdue_backlog, 0)
  from approvers ap
  left join done_agg da on da.approver_member_id = ap.approver_member_id
  left join backlog b on b.approver_member_id = ap.approver_member_id
  order by ap.full_name;
$$;

-- Raw material for the variance analysis, returned as ONE json document so the
-- API row cap never truncates it. The maths happens in TypeScript (lib/analysis).
--   reports: [member_id, 'YYYY-MM-DD', hours_claimed, report_id]
--   timers:  [member_id, start_epoch_seconds, end_epoch_seconds]
create or replace function fn_analytics.variance_source(
  p_from date,
  p_to date,
  p_member_id integer default null
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'reports', coalesce((
      select jsonb_agg(jsonb_build_array(r.member_id, r.report_date, r.hours_claimed, r.id)
                       order by r.member_id, r.report_date)
      from fn_demo.daily_reports r
      where r.report_date between p_from and p_to
        and (p_member_id is null or r.member_id = p_member_id)
    ), '[]'::jsonb),
    'timers', coalesce((
      select jsonb_agg(jsonb_build_array(
                         e.member_id,
                         extract(epoch from e.started_at)::bigint,
                         extract(epoch from e.ended_at)::bigint)
                       order by e.member_id, e.started_at)
      from fn_demo.timer_entries e
      where e.started_at < ((p_to + 1)::timestamp at time zone 'UTC')
        and e.ended_at > (p_from::timestamp at time zone 'UTC')
        and (p_member_id is null or e.member_id = p_member_id)
    ), '[]'::jsonb)
  );
$$;

-- One member-day: the report (if any), its task lines, and the timer entries
-- that touch that UTC day. Used by the queue drawer and the heatmap drill-in.
create or replace function fn_analytics.member_day_detail(p_member_id integer, p_date date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'member', (
      select jsonb_build_object('member_id', d.member_id, 'full_name', d.full_name,
                                'team_name', d.team_name, 'position', d.position,
                                'shift', d.shift, 'lead_name', d.lead_name)
      from fn_analytics.v_directory d where d.member_id = p_member_id
    ),
    'date', p_date,
    'report', (
      select jsonb_build_object('report_id', s.report_id, 'hours_claimed', s.hours_claimed,
                                'summary', s.summary, 'filed_at', s.filed_at,
                                'status', s.status, 'approved_at', s.approved_at)
      from fn_analytics.v_report_status s
      where s.member_id = p_member_id and s.report_date = p_date
    ),
    'task_lines', coalesce((
      select jsonb_agg(jsonb_build_object('line_no', tl.line_no, 'task_name', tl.task_name,
                                          'client_label', tl.client_label, 'hours', tl.hours)
                       order by tl.line_no)
      from fn_demo.report_task_lines tl
      join fn_demo.daily_reports r on r.id = tl.report_id
      where r.member_id = p_member_id and r.report_date = p_date
    ), '[]'::jsonb),
    'timer_entries', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'started_at', e.started_at,
                                          'ended_at', e.ended_at, 'task_name', e.task_name)
                       order by e.started_at)
      from fn_demo.timer_entries e
      where e.member_id = p_member_id
        and e.started_at < ((p_date + 1)::timestamp at time zone 'UTC')
        and e.ended_at > (p_date::timestamp at time zone 'UTC')
    ), '[]'::jsonb)
  );
$$;

-- Reminder facts. The RULES (cutoff, working-day calendar, dedupe key) live in
-- TypeScript (lib/reminders); these functions only report who has not filed
-- for a given date and which approvers hold overdue reports.
create or replace function fn_analytics.members_missing_report(p_date date)
returns table (
  member_id  integer,
  full_name  text,
  email      text,
  team_name  text,
  lead_name  text
)
language sql
stable
set search_path = ''
as $$
  select d.member_id, d.full_name, d.email, d.team_name, d.lead_name
  from fn_analytics.v_directory d
  where d.status = 'active'
    and d.files_reports
    and d.hired_on <= p_date
    and not exists (
      select 1 from fn_demo.daily_reports r
      where r.member_id = d.member_id and r.report_date = p_date
    )
  order by d.team_name, d.full_name;
$$;

create or replace function fn_analytics.approvers_with_overdue(p_now timestamptz default now())
returns table (
  approver_member_id  integer,
  full_name           text,
  email               text,
  overdue_count       integer,
  oldest_filed_at     timestamptz
)
language sql
stable
set search_path = ''
as $$
  select a.approver_member_id, m.full_name, m.email,
         count(*)::integer, min(q.filed_at)
  from fn_analytics.v_approval_queue q
  join fn_demo.approver_assignments a on a.team_id = q.team_id
  join fn_demo.members m on m.id = a.approver_member_id
  where q.approval_due_at < p_now
  group by a.approver_member_id, m.full_name, m.email
  order by m.full_name;
$$;

-- -----------------------------------------------------------------------------
-- fn_app: batch functions
-- -----------------------------------------------------------------------------

-- Create a durable batch. Server-side limits (the app checks them too):
--   at most 200 items per batch, at most 10 batches per rolling 10 minutes.
-- Only reports that are still awaiting approval, inside the caller's team
-- scope, and not already pending in another batch become items.
create or replace function fn_app.create_approval_batch(
  p_actor_email text,
  p_report_ids integer[],
  p_team_ids integer[] default null,
  p_outage_after integer default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_batch_id uuid;
  v_recent integer;
  v_inserted integer;
begin
  if p_report_ids is null or cardinality(p_report_ids) = 0 then
    raise exception 'empty_batch' using errcode = 'P0001';
  end if;
  if cardinality(p_report_ids) > 200 then
    raise exception 'batch_too_large' using errcode = 'P0001';
  end if;

  -- Serialise creation so the rate-limit count cannot be raced.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('fn_app.create_approval_batch'));

  select count(*) into v_recent
  from fn_app.approval_batch b
  where b.created_at > now() - interval '10 minutes';
  if v_recent >= 10 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into fn_app.approval_batch (created_by, outage_after)
  values (p_actor_email, p_outage_after)
  returning id into v_batch_id;

  insert into fn_app.approval_batch_item (batch_id, report_id)
  select v_batch_id, q.report_id
  from fn_analytics.v_approval_queue q
  where q.report_id = any (p_report_ids)
    and not q.in_open_batch
    and (p_team_ids is null or q.team_id = any (p_team_ids))
  order by q.filed_at, q.report_id;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    raise exception 'nothing_to_approve' using errcode = 'P0001';
  end if;

  insert into fn_app.audit_log (actor_email, action, entity, entity_id, detail)
  values (p_actor_email, 'batch.created', 'approval_batch', v_batch_id::text,
          jsonb_build_object('requested', cardinality(p_report_ids), 'items', v_inserted,
                             'outage_after', p_outage_after));
  return v_batch_id;
end;
$$;

-- CLAIM up to p_limit items for one runner. FOR UPDATE SKIP LOCKED means two
-- concurrent runners can never be handed the same row: the second skips rows
-- the first has locked instead of waiting for them. A claim older than two
-- minutes is treated as abandoned and may be claimed again.
create or replace function fn_app.claim_batch_items(
  p_batch_id uuid,
  p_limit integer,
  p_runner text
)
returns table (item_id bigint, report_id integer, attempts integer)
language sql
volatile
set search_path = ''
as $$
  with picked as (
    select i.id
    from fn_app.approval_batch_item i
    where i.batch_id = p_batch_id
      and i.status = 'pending'
      and (i.claimed_at is null or i.claimed_at < now() - interval '2 minutes')
    order by i.id
    limit greatest(least(p_limit, 50), 0)
    for update skip locked
  )
  update fn_app.approval_batch_item i
  set claimed_at = now(),
      claimed_by = p_runner,
      attempts = i.attempts + 1
  from picked
  where i.id = picked.id
  returning i.id, i.report_id, i.attempts;
$$;

-- Record the outcome of one item. Only the runner that holds the claim may
-- complete it. On success the approval log and the audit log are written in
-- the same transaction; the approval log's primary key makes a second
-- approval of the same report a no-op.
create or replace function fn_app.complete_batch_item(
  p_item_id bigint,
  p_runner text,
  p_ok boolean,
  p_reference text,
  p_error text,
  p_actor_email text,
  p_actor_member_id integer default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_report_id integer;
  v_batch_id uuid;
begin
  update fn_app.approval_batch_item i
  set status = case when p_ok then 'succeeded' else 'failed' end,
      last_error = case when p_ok then null else left(coalesce(p_error, 'unknown error'), 500) end,
      pm_reference = case when p_ok then p_reference else i.pm_reference end,
      finished_at = now()
  where i.id = p_item_id
    and i.status = 'pending'
    and i.claimed_by = p_runner
  returning i.report_id, i.batch_id into v_report_id, v_batch_id;

  if not found then
    return false;
  end if;

  if p_ok then
    insert into fn_app.approval_log (report_id, approver_email, approver_member_id, batch_id, pm_reference)
    values (v_report_id, p_actor_email, p_actor_member_id, v_batch_id, p_reference)
    on conflict (report_id) do nothing;

    insert into fn_app.audit_log (actor_email, action, entity, entity_id, detail)
    values (p_actor_email, 'report.approved', 'daily_report', v_report_id::text,
            jsonb_build_object('batch_id', v_batch_id, 'pm_reference', p_reference));
  end if;
  return true;
end;
$$;

-- Give claimed-but-unprocessed items back (used when a runner halts early).
create or replace function fn_app.release_batch_items(p_item_ids bigint[], p_runner text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  update fn_app.approval_batch_item i
  set claimed_at = null, claimed_by = null, attempts = greatest(i.attempts - 1, 0)
  where i.id = any (p_item_ids) and i.status = 'pending' and i.claimed_by = p_runner;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Put failed items back in the queue. Succeeded items are never touched.
create or replace function fn_app.retry_failed_items(p_batch_id uuid, p_actor_email text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  update fn_app.approval_batch_item i
  set status = 'pending', claimed_at = null, claimed_by = null, finished_at = null
  where i.batch_id = p_batch_id and i.status = 'failed';
  get diagnostics v_count = row_count;

  if v_count > 0 then
    insert into fn_app.audit_log (actor_email, action, entity, entity_id, detail)
    values (p_actor_email, 'batch.retry_failed', 'approval_batch', p_batch_id::text,
            jsonb_build_object('requeued', v_count));
  end if;
  return v_count;
end;
$$;

-- Demo control: end the simulated outage for a batch so a resume can succeed.
create or replace function fn_app.clear_batch_outage(p_batch_id uuid, p_actor_email text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update fn_app.approval_batch b
  set outage_cleared = true
  where b.id = p_batch_id and b.outage_after is not null and not b.outage_cleared;
  if found then
    insert into fn_app.audit_log (actor_email, action, entity, entity_id)
    values (p_actor_email, 'batch.outage_cleared', 'approval_batch', p_batch_id::text);
    return true;
  end if;
  return false;
end;
$$;

-- -----------------------------------------------------------------------------
-- Lockdown: RLS on with no policies, service_role only, no public EXECUTE.
-- -----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename from pg_catalog.pg_tables
    where schemaname in ('fn_demo', 'fn_app')
  loop
    execute format('alter table %I.%I enable row level security', r.schemaname, r.tablename);
  end loop;
end;
$$;

revoke all on schema fn_demo, fn_app, fn_analytics from public, anon, authenticated;
revoke all on all tables in schema fn_demo, fn_app, fn_analytics from public, anon, authenticated;
revoke all on all sequences in schema fn_demo, fn_app, fn_analytics from public, anon, authenticated;
revoke execute on all functions in schema fn_demo, fn_app, fn_analytics from public, anon, authenticated;

grant usage on schema fn_demo, fn_app, fn_analytics to service_role;
grant select on all tables in schema fn_demo to service_role;
grant select on all tables in schema fn_analytics to service_role;
grant select, insert, update, delete on all tables in schema fn_app to service_role;
grant usage, select on all sequences in schema fn_app to service_role;
grant execute on all functions in schema fn_app, fn_analytics to service_role;
