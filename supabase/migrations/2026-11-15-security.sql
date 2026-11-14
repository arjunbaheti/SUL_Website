-- 2026-11-15: abuse cap on anonymous form tracking.
-- Run once in Supabase -> SQL Editor. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Cap anonymous form tracking
-- ---------------------------------------------------------------------------
-- Anyone can log form events (that's how the Health tab works), so someone could script junk
-- rows to skew the numbers or bloat the table. Extra events are silently dropped:
--   * at most 150 events per visit (a real application is ~30)
--   * at most 600 events per minute across everyone (far above real traffic)
create or replace function public.form_events_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.form_events where session_id = new.session_id) >= 150 then
    return null;
  end if;
  if (select count(*) from public.form_events where created_at > now() - interval '1 minute') >= 600 then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function public.form_events_cap() from public;
drop trigger if exists form_events_cap on public.form_events;
create trigger form_events_cap before insert on public.form_events
  for each row execute function public.form_events_cap();
