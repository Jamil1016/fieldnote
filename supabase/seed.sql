-- =============================================================================
-- Fieldnote: demo seed (idempotent; defines fn_demo.load_seed() and calls it)
--
-- HOW TO APPLY
--   Run supabase/schema.sql first, then this file, then supabase/reset_demo.sql.
--   Only fn_app and fn_analytics belong in Supabase "Exposed schemas".
--   Nightly reset via pg_cron (19:10 UTC):
--     select cron.schedule('fieldnote-nightly-reset', '10 19 * * *',
--                          $$select fn_demo.reset_demo()$$);
--
-- WHAT IT BUILDS
--   Everything here is invented: the company (Example Co Field Services), the
--   five teams, every person, every client label and every number.
--   All dates are RELATIVE to today (UTC) so the demo always looks current.
--   The data is deterministic: every "random" draw is a hash of a stable key
--   (member id, working-day offset, purpose), so two loads on the same day give
--   identical rows. setseed() is called as well for any plain random() use.
--
--   48 people: 42 reporting field staff in 5 teams, 5 team leads, 1 operations
--   manager (6 approvers). 60 working days of daily reports, task lines and
--   timer entries, with these deliberate stories:
--     - Metro Closeout claims more hours than its timers show on most days
--     - two members habitually file after the 10:00 cutoff
--     - one member under-claims now and then
--     - the Ridgeway Survey lead has approved nothing for several working days
--     - a few reports are missing for the most recent working days
--     - some timer entries overlap, a few cross midnight
-- =============================================================================

create or replace function fn_demo.rnd(p_key text)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select (('x' || substr(md5(p_key), 1, 8))::bit(32)::bigint)::double precision / 4294967296.0;
$$;

create or replace function fn_demo.is_working_day(p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select extract(isodow from p_date) < 6
     and not exists (select 1 from fn_demo.holidays h where h.holiday_date = p_date);
$$;

create or replace function fn_demo.next_working_day(p_date date)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_d date := p_date + 1;
begin
  while not fn_demo.is_working_day(v_d) loop
    v_d := v_d + 1;
  end loop;
  return v_d;
end;
$$;

create or replace function fn_demo.load_seed()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_now    timestamptz := now();
  v_today  date := (now() at time zone 'UTC')::date;

  c_first text[] := array['Avery','Blake','Carmen','Dario','Elise','Farid','Greta','Hollis','Imani','Jonas',
                          'Keiko','Laszlo','Mirela','Nadim','Odessa','Pavel','Quinn','Rosalind','Soren','Tamsin',
                          'Ulises','Vesna','Wendell','Xiomara','Yusuf'];
  c_last  text[] := array['Aldercott','Brightwater','Castellane','Dunmore','Eskildsen','Fairweather','Galloway','Hartsfield',
                          'Ironwood','Jessop','Kilbride','Lindqvist','Marchetti','Northgate','Okonkwo-Reyes','Pemberley',
                          'Quillfeather','Ravenscroft','Stonebridge','Thackeray','Underhill','Valdespino','Whitlock','Yarrow'];
  c_tasks text[] := array['Site survey','Cable pull','Closeout photos','Punch list','Conduit run','Panel termination',
                          'Fiber splice','Rack and stack','Labeling pass','As-built markup','Safety walkthrough',
                          'Material staging','Signal test','Customer walkthrough'];
  c_positions text[] := array['Field Technician','Senior Technician','Site Surveyor','Cable Installer',
                              'QA Inspector','Closeout Coordinator'];
  c_clients text[] := array['Client North','Client Harbor','Client Ridge','Client Metro','Client Summit'];
  -- reporting members per team (teams 1..5) = 42
  c_team_sizes integer[] := array[10, 9, 8, 8, 7];

  v_days        date[];
  v_day         date;
  v_k           integer;
  v_m           record;
  v_key         text;
  v_id          integer;
  v_team        integer;
  v_i           integer;
  v_j           integer;
  v_n           integer;
  v_first       text;
  v_last        text;

  v_report_id   integer := 0;
  v_line_id     integer := 0;
  v_timer_id    integer := 0;

  v_shift_start integer;
  v_cursor      integer;
  v_target      double precision;
  v_weights     double precision[];
  v_wsum        double precision;
  v_dur         integer;
  v_seg_start   integer[];
  v_seg_dur     integer[];
  v_tracked     integer;
  v_has_timer   boolean;
  v_factor      double precision;
  v_claimed     numeric(5, 2);
  v_quarters    integer;
  v_left        integer;
  v_q           integer;
  v_lines       integer;
  v_summary     text;
  v_task        text;
  v_tasks_used  text[];
  v_filed       timestamptz;
  v_late        boolean;
  v_p_late      double precision;
  v_approver    integer;
  v_profile     text;
  v_delay_h     double precision;
  v_approved_at timestamptz;
  v_mid_start   integer;
  v_mid_end     integer;
  v_off         integer;
  v_h           date;
begin
  perform setseed(0.42);

  truncate fn_demo.report_task_lines, fn_demo.timer_entries, fn_demo.daily_reports,
           fn_demo.approver_assignments, fn_demo.members, fn_demo.teams,
           fn_demo.holidays, fn_demo.pipeline_runs;

  -- Holidays: a small invented list, placed relative to today and moved off
  -- weekends so each one actually removes a working day.
  for v_i in 1..4 loop
    v_off := (array[-17, -38, -66, 12])[v_i];
    v_h := v_today + v_off;
    if extract(isodow from v_h) = 6 then v_h := v_h - 1; end if;
    if extract(isodow from v_h) = 7 then v_h := v_h - 2; end if;
    insert into fn_demo.holidays (holiday_date, name)
    values (v_h, (array['Founders Day', 'Midyear Shutdown', 'Inventory Day', 'Safety Stand-down'])[v_i])
    on conflict do nothing;
  end loop;

  -- The last 60 working days before today, most recent first.
  select array_agg(d order by d desc) into v_days
  from (
    select g::date as d
    from generate_series(v_today - 130, v_today - 1, interval '1 day') g
    where fn_demo.is_working_day(g::date)
    order by g desc
    limit 60
  ) x;

  insert into fn_demo.teams (id, code, name, client_label) values
    (1, 'NLI', 'Northline Install',  'Client North'),
    (2, 'HBF', 'Harbor Fiber',       'Client Harbor'),
    (3, 'RDG', 'Ridgeway Survey',    'Client Ridge'),
    (4, 'MTC', 'Metro Closeout',     'Client Metro'),
    (5, 'SMT', 'Summit Maintenance', 'Client Summit');

  -- People. ids 1..5 team leads, 6 operations manager, 7..48 reporting staff.
  v_id := 0;
  for v_i in 1..48 loop
    v_id := v_i;
    v_first := c_first[1 + (v_i * 7) % 25];
    v_last  := c_last[1 + (v_i * 11) % 24];
    if v_i <= 5 then
      v_team := v_i;
    elsif v_i = 6 then
      v_team := 1;
    else
      -- walk the team sizes
      v_n := v_i - 6;
      v_team := 1;
      while v_n > c_team_sizes[v_team] loop
        v_n := v_n - c_team_sizes[v_team];
        v_team := v_team + 1;
      end loop;
    end if;

    insert into fn_demo.members (id, full_name, email, team_id, position, shift, work_arrangement,
                                 status, files_reports, hired_on)
    values (
      v_id,
      v_first || ' ' || v_last,
      lower(v_first || '.' || replace(v_last, '-', '')) || '@example.com',
      v_team,
      case when v_i <= 5 then 'Team Lead'
           when v_i = 6 then 'Operations Manager'
           else c_positions[1 + floor(fn_demo.rnd('pos' || v_i) * 6)::integer] end,
      case when v_i <= 6 then 'day'
           when fn_demo.rnd('shift' || v_i) < 0.25 then 'early'
           when fn_demo.rnd('shift' || v_i) < 0.75 then 'day'
           else 'late' end,
      case when fn_demo.rnd('arr' || v_i) < 0.65 then 'on_site'
           when fn_demo.rnd('arr' || v_i) < 0.90 then 'hybrid'
           else 'remote' end,
      case when v_i in (19, 37) then 'on_leave'
           when v_i = 44 then 'inactive'
           else 'active' end,
      v_i > 6,
      case when v_i = 48 then v_days[20]
           else v_today - (220 + floor(fn_demo.rnd('hire' || v_i) * 1500)::integer) end
    );
  end loop;

  insert into fn_demo.approver_assignments (team_id, approver_member_id, is_primary) values
    (1, 1, true), (2, 2, true), (3, 3, true), (4, 4, true), (5, 5, true),
    (1, 6, false);

  -- Member-days, oldest first so ids rise with time.
  for v_k in reverse 60..1 loop
    v_day := v_days[v_k];
    continue when v_day is null;

    for v_m in select * from fn_demo.members where files_reports order by id loop
      v_key := v_m.id || ':' || v_k;

      -- Absences: leave, departure, not yet hired.
      continue when v_m.status = 'on_leave' and v_k <= 8;
      continue when v_m.status = 'inactive' and v_k <= 25;
      continue when v_day < v_m.hired_on;

      -- ---- timer entries -------------------------------------------------
      v_shift_start := case v_m.shift when 'early' then 360 when 'day' then 480 else 720 end;
      v_cursor := v_shift_start + floor(fn_demo.rnd('st' || v_key) * 30)::integer - 10;
      v_n := 4 + floor(fn_demo.rnd('n' || v_key) * 4)::integer;
      v_target := 430 + fn_demo.rnd('tt' || v_key) * 100;
      v_has_timer := fn_demo.rnd('nt' || v_key) >= 0.010;

      v_weights := array[]::double precision[];
      v_wsum := 0;
      for v_j in 1..v_n loop
        v_weights := v_weights || (0.6 + fn_demo.rnd('w' || v_key || ':' || v_j));
        v_wsum := v_wsum + v_weights[v_j];
      end loop;

      v_seg_start := array[]::integer[];
      v_seg_dur := array[]::integer[];
      v_tracked := 0;
      for v_j in 1..v_n loop
        v_dur := greatest(15, round(v_target * v_weights[v_j] / v_wsum)::integer);
        v_seg_start := v_seg_start || v_cursor;
        v_seg_dur := v_seg_dur || v_dur;
        v_tracked := v_tracked + v_dur;
        v_cursor := v_cursor + v_dur
          + case when v_j = (v_n + 1) / 2
                 then 30 + floor(fn_demo.rnd('lg' || v_key) * 20)::integer
                 else 10 + floor(fn_demo.rnd('g' || v_key || ':' || v_j) * 14)::integer end;
      end loop;

      if v_has_timer then
        for v_j in 1..v_n loop
          v_timer_id := v_timer_id + 1;
          insert into fn_demo.timer_entries (id, member_id, started_at, ended_at, task_name)
          values (v_timer_id, v_m.id,
                  (v_day::timestamp + make_interval(mins => v_seg_start[v_j])) at time zone 'UTC',
                  (v_day::timestamp + make_interval(mins => v_seg_start[v_j] + v_seg_dur[v_j])) at time zone 'UTC',
                  c_tasks[1 + floor(fn_demo.rnd('tk' || v_key || ':' || v_j) * 14)::integer]);
        end loop;

        -- A second timer left running: overlaps the back half of one segment
        -- and spills 5 minutes into the gap after it.
        if fn_demo.rnd('ov' || v_key) < 0.30 then
          v_j := 1 + floor(fn_demo.rnd('ovj' || v_key) * v_n)::integer;
          v_timer_id := v_timer_id + 1;
          insert into fn_demo.timer_entries (id, member_id, started_at, ended_at, task_name)
          values (v_timer_id, v_m.id,
                  (v_day::timestamp + make_interval(mins => v_seg_start[v_j] + v_seg_dur[v_j] / 2)) at time zone 'UTC',
                  (v_day::timestamp + make_interval(mins => v_seg_start[v_j] + v_seg_dur[v_j] + 5)) at time zone 'UTC',
                  c_tasks[1 + floor(fn_demo.rnd('ovt' || v_key) * 14)::integer]);
          v_tracked := v_tracked + 5;
        end if;

        -- Late-shift overtime that runs past midnight.
        if v_m.shift = 'late' and fn_demo.rnd('mid' || v_key) < 0.05 then
          v_mid_start := greatest(v_cursor, 1355 + floor(fn_demo.rnd('ms' || v_key) * 10)::integer);
          v_mid_end := 1460 + floor(fn_demo.rnd('me' || v_key) * 40)::integer;
          v_timer_id := v_timer_id + 1;
          insert into fn_demo.timer_entries (id, member_id, started_at, ended_at, task_name)
          values (v_timer_id, v_m.id,
                  (v_day::timestamp + make_interval(mins => v_mid_start)) at time zone 'UTC',
                  (v_day::timestamp + make_interval(mins => v_mid_end)) at time zone 'UTC',
                  'Signal test');
          v_tracked := v_tracked + (v_mid_end - v_mid_start);
        end if;
      end if;

      -- ---- daily report ---------------------------------------------------
      -- Missing reports: a thin random scatter plus a deliberate handful on
      -- the two most recent working days so the reminders page has work to do.
      continue when fn_demo.rnd('miss' || v_key) < 0.012;
      continue when v_k = 1 and v_m.id in (9, 12, 21, 29, 33, 41);
      continue when v_k = 2 and v_m.id in (12, 26, 40);

      v_factor := 1 + (fn_demo.rnd('nz' || v_key) - 0.5) * 0.12;
      if fn_demo.rnd('out' || v_key) < 0.03 then
        v_factor := case when fn_demo.rnd('outs' || v_key) < 0.5 then 0.72 else 1.24 end
                    + fn_demo.rnd('outm' || v_key) * 0.08;
      end if;
      if v_m.team_id = 4 and fn_demo.rnd('infl' || v_key) < 0.68 then
        v_factor := 1.17 + fn_demo.rnd('inflm' || v_key) * 0.15;
      end if;
      if v_m.id = 23 and fn_demo.rnd('under' || v_key) < 0.45 then
        v_factor := 0.76 + fn_demo.rnd('underm' || v_key) * 0.07;
      end if;

      v_quarters := greatest(4, round(v_tracked / 60.0 * v_factor * 4)::integer);
      v_claimed := v_quarters / 4.0;

      v_p_late := case when v_m.id in (12, 29) then 0.65 else 0.05 end;
      v_late := fn_demo.rnd('late' || v_key) < v_p_late;
      if v_late then
        v_filed := (fn_demo.next_working_day(v_day)::timestamp
                    + make_interval(mins => 620 + floor(fn_demo.rnd('lf' || v_key) * 300)::integer)) at time zone 'UTC';
        if fn_demo.rnd('lf2' || v_key) < 0.2 then
          v_filed := v_filed + interval '1 day';
        end if;
      else
        v_filed := (v_day::timestamp + make_interval(mins =>
                      case when v_m.shift = 'late' then 1350 + floor(fn_demo.rnd('f' || v_key) * 60)::integer
                           else 1005 + floor(fn_demo.rnd('f' || v_key) * 150)::integer end)) at time zone 'UTC';
      end if;
      -- A filing time still in the future means "not filed yet".
      continue when v_filed > v_now;

      -- Approval: each approver has a pace; some reports simply get stuck.
      v_approver := case when v_m.team_id = 1 and fn_demo.rnd('ap' || v_key) < 0.35 then 6 else v_m.team_id end;
      v_profile := case v_approver when 1 then 'fast' when 5 then 'fast' when 3 then 'slow' else 'medium' end;
      v_delay_h := case v_profile
                     when 'fast' then 3 + fn_demo.rnd('d' || v_key) * 34
                     when 'medium' then 8 + fn_demo.rnd('d' || v_key) * 58
                     else 20 + fn_demo.rnd('d' || v_key) * 90 end;
      if fn_demo.rnd('stuck' || v_key) < 0.19 then
        v_delay_h := 90 + fn_demo.rnd('stuckd' || v_key) * 1000;
      end if;
      -- The Ridgeway Survey lead has been away from the queue.
      if v_approver = 3 and v_k <= 10 then
        v_delay_h := 100000;
      end if;
      v_approved_at := v_filed + make_interval(secs => v_delay_h * 3600);

      v_report_id := v_report_id + 1;

      -- Task lines: split the claimed quarter-hours across 2 to 4 tasks.
      v_lines := 2 + floor(fn_demo.rnd('ln' || v_key) * 3)::integer;
      v_left := v_quarters;
      v_tasks_used := array[]::text[];
      v_wsum := 0;
      for v_j in 1..v_lines loop
        v_wsum := v_wsum + 0.5 + fn_demo.rnd('lw' || v_key || ':' || v_j);
      end loop;

      v_summary := '';
      insert into fn_demo.daily_reports (id, member_id, report_date, hours_claimed, summary, filed_at,
                                         seed_status, seed_approved_at, seed_approved_by)
      values (v_report_id, v_m.id, v_day, v_claimed, '', v_filed,
              case when v_approved_at <= v_now then 'approved' else 'awaiting' end,
              case when v_approved_at <= v_now then v_approved_at end,
              case when v_approved_at <= v_now then v_approver end);

      for v_j in 1..v_lines loop
        if v_j = v_lines then
          v_q := v_left;
        else
          v_q := least(v_left, greatest(1, floor(v_quarters * (0.5 + fn_demo.rnd('lw' || v_key || ':' || v_j)) / v_wsum)::integer));
        end if;
        v_left := v_left - v_q;
        v_task := c_tasks[1 + (floor(fn_demo.rnd('lt' || v_key) * 14)::integer + (v_j - 1) * 3) % 14];
        v_tasks_used := v_tasks_used || v_task;
        v_line_id := v_line_id + 1;
        insert into fn_demo.report_task_lines (id, report_id, line_no, task_name, client_label, hours)
        values (v_line_id, v_report_id, v_j, v_task,
                case when fn_demo.rnd('cl' || v_key || ':' || v_j) < 0.9
                     then c_clients[v_m.team_id]
                     else c_clients[1 + floor(fn_demo.rnd('cl2' || v_key || ':' || v_j) * 5)::integer] end,
                v_q / 4.0);
      end loop;

      update fn_demo.daily_reports
      set summary = array_to_string(v_tasks_used, ', ')
      where id = v_report_id;
    end loop;
  end loop;

  -- Pipeline runs: one load every 6 hours for the last 10 days, newest within
  -- the hour, two failures in the history. The app refuses to call the data
  -- "live" if the last success is more than 26 hours old.
  for v_i in reverse 39..0 loop
    insert into fn_demo.pipeline_runs (id, source, started_at, finished_at, status, rows_loaded)
    values (
      40 - v_i,
      'timer-export',
      date_trunc('hour', v_now) - make_interval(hours => v_i * 6) - interval '50 minutes',
      date_trunc('hour', v_now) - make_interval(hours => v_i * 6) - interval '50 minutes'
        + make_interval(secs => 240 + floor(fn_demo.rnd('pr' || v_i) * 300)::integer),
      case when v_i in (5, 17) then 'failed' else 'succeeded' end,
      case when v_i in (5, 17) then 0 else 180 + floor(fn_demo.rnd('prr' || v_i) * 90)::integer end
    );
  end loop;

  -- App users and pinned settings. The demo account is a manager, linked to
  -- the operations manager so that "View as lead" scopes to one team.
  insert into fn_app.app_user (email, display_name, role, member_id)
  select 'demo@example.com', m.full_name, 'manager', m.id
  from fn_demo.members m where m.id = 6
  on conflict (email) do update
    set display_name = excluded.display_name, role = excluded.role, member_id = excluded.member_id;

  insert into fn_app.settings (key, value) values
    ('reminder_mode', 'sample'),
    ('sample_inbox', 'reminders-sandbox@example.com')
  on conflict (key) do update set value = excluded.value;
end;
$$;

revoke execute on all functions in schema fn_demo from public, anon, authenticated;

select fn_demo.load_seed();
