-- =============================================================================
-- Fieldnote: demo reset (idempotent; defines fn_demo.reset_demo())
--
-- HOW TO APPLY
--   Run after supabase/schema.sql and supabase/seed.sql.
--   Only fn_app and fn_analytics belong in Supabase "Exposed schemas".
--
-- NIGHTLY RESET at 19:10 UTC (enable the pg_cron extension first):
--   select cron.schedule('fieldnote-nightly-reset', '10 19 * * *',
--                        $$select fn_demo.reset_demo()$$);
--
-- reset_demo() clears everything a visitor can have written (batches, the
-- approval overlay, the simulated PM ledger, reminder and audit logs) and
-- rebuilds the seed relative to today's date.
-- =============================================================================

create or replace function fn_demo.reset_demo()
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- One reset at a time.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('fn_demo.reset_demo'));

  truncate fn_app.approval_batch_item, fn_app.approval_batch, fn_app.approval_log,
           fn_app.pm_sim_ledger, fn_app.reminder_log, fn_app.audit_log
           restart identity;

  perform fn_demo.load_seed();

  insert into fn_app.audit_log (actor_email, action, entity, entity_id)
  values ('system', 'demo.reset', 'demo', 'all');
end;
$$;

-- Callable by the app (service role) so a visitor who finds the approval queue
-- drained by earlier visitors can restore it without waiting for the nightly
-- job. It refuses unless the queue really is nearly empty, so it cannot be
-- used to wipe a healthy demo. SECURITY DEFINER because the service role has
-- read-only access to fn_demo.
create or replace function fn_app.restore_demo_if_depleted(p_actor_email text, p_threshold integer default 25)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_awaiting integer;
begin
  select count(*) into v_awaiting from fn_analytics.v_approval_queue;
  if v_awaiting >= least(greatest(p_threshold, 0), 25) then
    return false;
  end if;
  perform fn_demo.reset_demo();
  insert into fn_app.audit_log (actor_email, action, entity, entity_id, detail)
  values (p_actor_email, 'demo.restore_requested', 'demo', 'all',
          jsonb_build_object('awaiting_before', v_awaiting));
  return true;
end;
$$;

revoke execute on all functions in schema fn_demo, fn_app from public, anon, authenticated;
grant execute on function fn_app.restore_demo_if_depleted(text, integer) to service_role;
