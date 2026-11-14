-- 2026-11-15: abuse cap on form tracking + two-factor sign-in for the committee portal.
-- Run once in Supabase -> SQL Editor. Safe to re-run.
--
-- IMPORTANT: deploy the matching website code (with the two-factor screens) BEFORE running
-- part 2, otherwise committee members can't reach the board until it's live.

-- ---------------------------------------------------------------------------
-- 1. Cap anonymous form tracking
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

-- ---------------------------------------------------------------------------
-- 2. Two-factor sign-in (TOTP authenticator app) for committee members
-- ---------------------------------------------------------------------------
-- is_committee() gates every committee table, the resumes bucket and the email route. It now
-- also requires the session to have passed two-factor (aal2), so a stolen password alone can't
-- read applicants' data. The portal walks each member through setting up an authenticator app
-- on their next sign-in.
--
-- Lost phone? Supabase -> Authentication -> Users -> (member) -> delete their MFA factor; they
-- set it up again on next sign-in.
create or replace function public.is_committee()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (
       select 1 from public.committee_members
        where email = lower(coalesce(auth.jwt() ->> 'email', ''))
     );
$$;
revoke all on function public.is_committee() from public;
grant execute on function public.is_committee() to anon, authenticated;
