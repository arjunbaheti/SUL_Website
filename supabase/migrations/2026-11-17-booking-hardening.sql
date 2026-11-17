-- 2026-11-17: interview booking hardening. Run once after the 2026-11-16 / 16b / 16c updates.
-- Safe to re-run.
--
--   * Calendar events: every booking change gets a database-ordered sequence number, and a
--     cancelled event's UID is never reused (Google Calendar can ignore a revived UID).
--   * Races: the applicant's row (and everyone sharing their email) is locked before any check, so
--     simultaneous requests can't get round "one interview per person" or the daily change limit.
--   * Email abuse: at most 60 candidate-made changes an hour across everyone (protects the club's
--     Gmail quota), on top of 8 a day per applicant.
--   * Less data back to the website: the public functions only return what the booking emails need.
--   * Cancelling from the link needs the application to still be in the running.
--   * Editing a slot's start time keeps the booked applicant's interview time in step.
--   * The committee can't book an interview for someone already past the interview stage.
--   * Emails name the team they're actually interviewing for (their second choice, if that's the
--     session they booked).

-- ---------------------------------------------------------------------------
-- Counters for calendar events
-- ---------------------------------------------------------------------------
alter table public.applications add column if not exists interview_seq int not null default 0;        -- +1 on every booking change
alter table public.applications add column if not exists interview_booking_no int not null default 0; -- +1 each time a new booking starts
alter table public.applications add column if not exists interview_slot_seq int not null default 0;   -- interview_seq when the current slot was set

-- ---------------------------------------------------------------------------
-- The one place a booking changes (replaces the 2026-11-16 version)
-- ---------------------------------------------------------------------------
create or replace function public._move_interview(p_app uuid, p_slot uuid, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.applications%rowtype;
  o public.interview_slots%rowtype;
  n public.interview_slots%rowtype;
  new_status text;
  s jsonb;
  t timestamptz := clock_timestamp();
  seq int;
  bno int;
  team text;
  sess_teams text[];
begin
  select * into a from public.applications where id = p_app for update;
  if not found then raise exception 'invalid_link'; end if;
  if a.interview_slot_id is not distinct from p_slot then
    return jsonb_build_object('changed', false);
  end if;

  if a.interview_slot_id is not null then
    select * into o from public.interview_slots where id = a.interview_slot_id;
  end if;
  if p_slot is not null then
    select * into n from public.interview_slots where id = p_slot for update;
    if not found then raise exception 'slot_missing'; end if;
    if exists (select 1 from public.applications x where x.interview_slot_id = p_slot and x.id <> p_app) then
      raise exception 'slot_taken';
    end if;
  end if;

  new_status := case
    when p_slot is not null and a.status in ('applied', 'review', 'invited') then 'booked'
    when p_slot is null and a.status = 'booked' then 'invited'
    else a.status
  end;
  seq := a.interview_seq + 1;
  -- A new booking (from no booking) gets a new calendar event; a move keeps the same one.
  bno := case when a.interview_slot_id is null then a.interview_booking_no + 1 else a.interview_booking_no end;

  begin
    update public.applications
       set interview_slot_id = p_slot,
           interview_at = n.starts_at,
           status = new_status,
           interview_seq = seq,
           interview_booking_no = bno,
           interview_slot_seq = case when p_slot is null then 0 else seq end
     where id = p_app;
  exception when unique_violation then
    raise exception 'slot_taken';
  end;

  insert into public.application_notes (application_id, type, text, author_email, created_at)
  values (
    p_app, 'auto',
    case
      when p_slot is null then 'Interview cancelled (was ' || public._fmt_interview(o.starts_at) || ')'
      when o.id is null then 'Interview booked: ' || public._fmt_interview(n.starts_at) || coalesce(' · ' || nullif(n.location, ''), '')
      else 'Interview moved to ' || public._fmt_interview(n.starts_at) || coalesce(' · ' || nullif(n.location, ''), '')
    end,
    coalesce(p_actor, ''), t
  );
  if new_status <> a.status then
    insert into public.application_notes (application_id, type, text, author_email, created_at)
    values (p_app, 'auto',
      'Moved to ' || case new_status when 'booked' then 'Interview booked' else 'Interview invited' end,
      coalesce(p_actor, ''), t + interval '1 millisecond');
  end if;

  -- The team this interview is for: their first choice, unless the session is only for their
  -- second choice.
  team := a.role;
  if n.session_id is not null then
    select ss.teams into sess_teams from public.interview_sessions ss where ss.id = n.session_id;
    if coalesce(array_length(sess_teams, 1), 0) > 0 and not (a.role = any(sess_teams))
       and a.role_secondary <> '' and a.role_secondary = any(sess_teams) then
      team := a.role_secondary;
    end if;
  end if;

  -- Only the settings the booking emails use.
  select jsonb_build_object(
           'senderName', ps.data -> 'senderName',
           'replyTo', ps.data -> 'replyTo',
           'templates', jsonb_build_object('booked', ps.data -> 'templates' -> 'booked'))
    into s
    from public.portal_settings ps where ps.id = 'main';

  return jsonb_build_object(
    'changed', true,
    'app_id', a.id, 'name', a.name, 'email', a.email, 'role', team, 'token', a.booking_token,
    'old', case when o.id is null then null else jsonb_build_object(
      'id', o.id, 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'location', o.location, 'interviewers', o.interviewers) end,
    'new', case when n.id is null then null else jsonb_build_object(
      'id', n.id, 'starts_at', n.starts_at, 'ends_at', n.ends_at, 'location', n.location, 'interviewers', n.interviewers) end,
    'seq', seq,
    'booking_no', case when p_slot is null then a.interview_booking_no else bno end,
    'old_slot_seq', a.interview_slot_seq,
    'settings', coalesce(s, '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Locks + limits shared by the public functions
-- ---------------------------------------------------------------------------
-- Locks the applicant (and serialises everyone with the same email) for the rest of the
-- transaction, then applies the abuse limits. Returns the locked row.
create or replace function public._lock_candidate(p_token text)
returns public.applications
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.applications%rowtype;
begin
  if p_token is null or char_length(p_token) < 32 then raise exception 'invalid_link'; end if;
  select * into a from public.applications where booking_token = p_token;
  if not found then raise exception 'invalid_link'; end if;
  if a.email <> '' then perform pg_advisory_xact_lock(hashtext('sul-booking:' || lower(a.email))); end if;
  select * into a from public.applications where id = a.id for update;
  if (select count(*) from public.application_notes
       where author_email = 'Candidate' and created_at > now() - interval '1 hour'
         and (text like 'Interview booked%' or text like 'Interview moved%' or text like 'Interview cancelled%')) >= 60 then
    raise exception 'busy';
  end if;
  if public._candidate_changes_today(a.id) >= 8 then raise exception 'too_many'; end if;
  return a;
end;
$$;

create or replace function public.book_interview(p_token text, p_slot uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.applications%rowtype;
  sl public.interview_slots%rowtype;
  cur public.interview_slots%rowtype;
  cutoff interval := public._booking_cutoff();
begin
  a := public._lock_candidate(p_token);
  if a.status not in ('applied', 'review', 'invited', 'booked') then raise exception 'closed'; end if;
  if a.interview_slot_id is not distinct from p_slot then return jsonb_build_object('changed', false); end if;
  select * into sl from public.interview_slots where id = p_slot for update;
  if not found or not public._slot_open_to(sl, a) then raise exception 'slot_missing'; end if;
  if sl.starts_at < now() + cutoff then raise exception 'too_late'; end if;
  if a.interview_slot_id is not null then
    select * into cur from public.interview_slots where id = a.interview_slot_id;
    if found and cur.starts_at < now() + cutoff then raise exception 'locked'; end if;
  end if;
  if a.email <> '' and exists (
    select 1 from public.applications o
      join public.interview_slots s on s.id = o.interview_slot_id
     where o.id <> a.id and lower(o.email) = lower(a.email) and s.ends_at > now()
  ) then
    raise exception 'already_booked';
  end if;
  return public._move_interview(a.id, p_slot, 'Candidate');
end;
$$;

create or replace function public.cancel_interview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.applications%rowtype;
  cur public.interview_slots%rowtype;
begin
  a := public._lock_candidate(p_token);
  if a.interview_slot_id is null then return jsonb_build_object('changed', false); end if;
  if a.status not in ('applied', 'review', 'invited', 'booked') then raise exception 'closed'; end if;
  select * into cur from public.interview_slots where id = a.interview_slot_id;
  if found and cur.starts_at < now() + public._booking_cutoff() then raise exception 'locked'; end if;
  return public._move_interview(a.id, null, 'Candidate');
end;
$$;

-- ---------------------------------------------------------------------------
-- Booking page: also returns the calendar UID of their booking, so "Add to calendar" updates the
-- same event as the emailed invite instead of adding a second one.
-- ---------------------------------------------------------------------------
create or replace function public.booking_info(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.applications%rowtype;
  cur public.interview_slots%rowtype;
  cur_session text;
  cutoff interval := public._booking_cutoff();
  is_open boolean;
begin
  if p_token is null or char_length(p_token) < 32 then return null; end if;
  select * into a from public.applications where booking_token = p_token;
  if not found then return null; end if;
  if a.interview_slot_id is not null then
    select * into cur from public.interview_slots where id = a.interview_slot_id;
    select ss.name into cur_session from public.interview_sessions ss where ss.id = cur.session_id;
  end if;
  is_open := a.status in ('applied', 'review', 'invited', 'booked');
  return jsonb_build_object(
    'first_name', split_part(btrim(a.name), ' ', 1),
    'role', a.role,
    'open', is_open,
    'cutoff_hours', extract(epoch from cutoff) / 3600,
    'current', case when cur.id is null then null else jsonb_build_object(
      'id', cur.id, 'starts_at', cur.starts_at, 'ends_at', cur.ends_at, 'location', cur.location,
      'session', coalesce(cur_session, ''),
      'cal_uid', 'interview-' || a.id || '-' || a.interview_booking_no || '@startuplinkunimelb.net',
      'can_change', cur.starts_at >= now() + cutoff) end,
    'slots', case when not is_open then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'location', s.location,
               'session', coalesce(ss.name, ''), 'note', coalesce(ss.note, ''))
             order by ss.name nulls last, s.starts_at)
        from public.interview_slots s
        left join public.interview_sessions ss on ss.id = s.session_id
       where s.starts_at >= now() + cutoff
         and public._slot_open_to(s, a)
         and not exists (select 1 from public.applications x where x.interview_slot_id = s.id)
    ), '[]'::jsonb) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Committee (portal): book, move or cancel for someone. Booking needs them in the running.
-- ---------------------------------------------------------------------------
create or replace function public.committee_set_interview(p_app uuid, p_slot uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sl public.interview_slots%rowtype;
  st text;
begin
  if not public.is_committee() then raise exception 'not_committee'; end if;
  if p_slot is not null then
    select status into st from public.applications where id = p_app;
    if st is not null and st not in ('applied', 'review', 'invited', 'booked') then raise exception 'closed'; end if;
    select * into sl from public.interview_slots where id = p_slot;
    if not found then raise exception 'slot_missing'; end if;
    if sl.starts_at < now() then raise exception 'too_late'; end if;
  end if;
  return public._move_interview(p_app, p_slot, lower(coalesce(auth.jwt() ->> 'email', '')));
end;
$$;
revoke all on function public.committee_set_interview(uuid, uuid) from public, anon;
grant execute on function public.committee_set_interview(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Editing a booked slot's time keeps the applicant's interview time in step.
-- ---------------------------------------------------------------------------
create or replace function public.interview_slots_sync_time()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.starts_at is distinct from old.starts_at then
    update public.applications set interview_at = new.starts_at where interview_slot_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists interview_slots_sync_time on public.interview_slots;
create trigger interview_slots_sync_time after update of starts_at on public.interview_slots
  for each row execute function public.interview_slots_sync_time();

revoke all on function public._lock_candidate(text) from public, anon, authenticated;
revoke all on function public.interview_slots_sync_time() from public, anon, authenticated;
revoke all on function public._move_interview(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.booking_info(text) from public;
revoke all on function public.book_interview(text, uuid) from public;
revoke all on function public.cancel_interview(text) from public;
grant execute on function public.booking_info(text) to anon, authenticated;
grant execute on function public.book_interview(text, uuid) to anon, authenticated;
grant execute on function public.cancel_interview(text) to anon, authenticated;
