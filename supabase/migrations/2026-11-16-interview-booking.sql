-- 2026-11-16: built-in interview booking (replaces zcal). See docs/interview-booking-prd.md.
-- Run once in Supabase -> SQL Editor. Safe to re-run.
--
-- What this adds
--   interview_slots              times the committee is free to interview (committee-only table)
--   applications.booking_token   private, unguessable token behind each applicant's /book/<token> link
--   applications.interview_slot_id  the slot they've booked (one applicant per slot, enforced here)
--   booking_info / book_interview / cancel_interview   what the public booking page may do, by token
--   committee_set_interview      book, move or cancel on someone's behalf from the portal
--
-- Security model: candidates never touch tables directly. The public functions only act on the one
-- application whose token was supplied, only reveal that applicant's first name and team, and
-- never reveal other candidates or interviewers. All changes go through _move_interview(), which
-- locks the rows involved so two people can't take the same slot.

-- ---------------------------------------------------------------------------
-- Slots
-- ---------------------------------------------------------------------------
create table if not exists public.interview_slots (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  location     text not null default '',
  interviewers text[] not null default '{}',   -- committee member emails; they get the calendar invite
  team         text not null default '',       -- '' = any team; otherwise only that team's applicants see it
  created_by   text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  constraint interview_slots_time_chk      check (ends_at > starts_at and ends_at - starts_at <= interval '4 hours'),
  constraint interview_slots_location_len  check (char_length(location) <= 300),
  constraint interview_slots_team_len      check (char_length(team) <= 120),
  constraint interview_slots_people_chk    check (coalesce(array_length(interviewers, 1), 0) <= 10)
);
create index if not exists interview_slots_start_idx on public.interview_slots (starts_at);

alter table public.interview_slots enable row level security;
drop policy if exists "committee manages interview slots" on public.interview_slots;
create policy "committee manages interview slots" on public.interview_slots
  for all to authenticated using (public.is_committee()) with check (public.is_committee());
revoke all on public.interview_slots from anon;

-- ---------------------------------------------------------------------------
-- Booking token + booked slot on each application
-- ---------------------------------------------------------------------------
-- 64 hex characters from two random UUIDs (~244 random bits): can't be guessed or enumerated.
create or replace function public.new_booking_token()
returns text language sql volatile set search_path = public as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

alter table public.applications add column if not exists booking_token text;
update public.applications set booking_token = public.new_booking_token() where booking_token is null;
alter table public.applications alter column booking_token set default public.new_booking_token();
alter table public.applications alter column booking_token set not null;
create unique index if not exists applications_booking_token_idx on public.applications (booking_token);

alter table public.applications add column if not exists interview_slot_id uuid
  references public.interview_slots(id) on delete restrict;
create unique index if not exists applications_interview_slot_idx on public.applications (interview_slot_id);

-- Every new application gets a fresh token from the server, whatever the client sent.
create or replace function public.applications_new_token()
returns trigger language plpgsql set search_path = public as $$
begin
  new.booking_token := public.new_booking_token();
  return new;
end;
$$;
drop trigger if exists applications_new_token on public.applications;
create trigger applications_new_token before insert on public.applications
  for each row execute function public.applications_new_token();

-- Columns from earlier updates that the policy below refers to (no-ops if they already exist).
alter table public.applications add column if not exists second_choice_flag boolean not null default false;
alter table public.applications add column if not exists confirmation_sent_at timestamptz;

-- The public form can't arrive pre-booked.
drop policy if exists "public can apply" on public.applications;
create policy "public can apply" on public.applications
  for insert to anon
  with check (
    status = 'applied' and rating = '' and assignee = '' and booking = ''
    and booking_slot_id is null and interview_slot_id is null and interview_at is null and resume_url = ''
    and second_choice_flag = false and confirmation_sent_at is null
    and consent = true
    and char_length(name) > 0 and char_length(email) > 0
  );

-- ---------------------------------------------------------------------------
-- Helpers (internal: not callable from the website)
-- ---------------------------------------------------------------------------
-- How close to an interview candidates can still book/change it. Portal Settings ->
-- bookingCutoffHours (0-168), default 12.
create or replace function public._booking_cutoff()
returns interval language sql stable security definer set search_path = public as $$
  select make_interval(hours => coalesce((
    select case when jsonb_typeof(ps.data -> 'bookingCutoffHours') = 'number'
                then greatest(0, least(168, round((ps.data ->> 'bookingCutoffHours')::numeric)))::int end
      from public.portal_settings ps where ps.id = 'main'), 12));
$$;

-- "Tue 24 Nov, 10:30am" in Melbourne time, for the activity log.
create or replace function public._fmt_interview(ts timestamptz)
returns text language sql stable set search_path = public as $$
  select to_char(ts at time zone 'Australia/Melbourne', 'Dy FMDD Mon, FMHH12:MIam');
$$;

-- The one place a booking changes. Locks the applicant and the target slot, refuses a slot that's
-- taken, keeps interview_at and the stage in step, and writes the activity log. Returns what the
-- server needs to send emails (or {"changed": false} if nothing changed).
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

  begin
    update public.applications
       set interview_slot_id = p_slot,
           interview_at = n.starts_at,
           status = new_status
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

  select ps.data into s from public.portal_settings ps where ps.id = 'main';
  return jsonb_build_object(
    'changed', true,
    'app_id', a.id, 'name', a.name, 'email', a.email, 'role', a.role, 'token', a.booking_token,
    'old', case when o.id is null then null else to_jsonb(o) end,
    'new', case when n.id is null then null else to_jsonb(n) end,
    'settings', coalesce(s, '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Public (booking page, by token)
-- ---------------------------------------------------------------------------
-- What the booking page shows: first name, team, their current booking and the open slots.
-- Returns null for an unknown token.
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
  cutoff interval := public._booking_cutoff();
  is_open boolean;
begin
  if p_token is null or char_length(p_token) < 32 then return null; end if;
  select * into a from public.applications where booking_token = p_token;
  if not found then return null; end if;
  if a.interview_slot_id is not null then
    select * into cur from public.interview_slots where id = a.interview_slot_id;
  end if;
  is_open := a.status in ('review', 'invited', 'booked');
  return jsonb_build_object(
    'first_name', split_part(btrim(a.name), ' ', 1),
    'role', a.role,
    'open', is_open,
    'cutoff_hours', extract(epoch from cutoff) / 3600,
    'current', case when cur.id is null then null else jsonb_build_object(
      'id', cur.id, 'starts_at', cur.starts_at, 'ends_at', cur.ends_at, 'location', cur.location,
      'can_change', cur.starts_at >= now() + cutoff) end,
    'slots', case when not is_open then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'location', s.location) order by s.starts_at)
        from public.interview_slots s
       where s.starts_at >= now() + cutoff
         and (s.team = '' or s.team = a.role)
         and not exists (select 1 from public.applications x where x.interview_slot_id = s.id)
    ), '[]'::jsonb) end
  );
end;
$$;

-- Book (or move to) a slot. Errors: invalid_link, closed, slot_missing, slot_taken, too_late, locked.
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
  if p_token is null or char_length(p_token) < 32 then raise exception 'invalid_link'; end if;
  select * into a from public.applications where booking_token = p_token;
  if not found then raise exception 'invalid_link'; end if;
  if a.status not in ('review', 'invited', 'booked') then raise exception 'closed'; end if;
  select * into sl from public.interview_slots where id = p_slot;
  if not found or (sl.team <> '' and sl.team <> a.role) then raise exception 'slot_missing'; end if;
  if sl.starts_at < now() + cutoff then raise exception 'too_late'; end if;
  if a.interview_slot_id is not null and a.interview_slot_id <> p_slot then
    select * into cur from public.interview_slots where id = a.interview_slot_id;
    if found and cur.starts_at < now() + cutoff then raise exception 'locked'; end if;
  end if;
  return public._move_interview(a.id, p_slot, 'Candidate');
end;
$$;

-- Cancel their booking (back to "Interview invited"). Errors: invalid_link, locked.
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
  if p_token is null or char_length(p_token) < 32 then raise exception 'invalid_link'; end if;
  select * into a from public.applications where booking_token = p_token;
  if not found then raise exception 'invalid_link'; end if;
  if a.interview_slot_id is null then return jsonb_build_object('changed', false); end if;
  select * into cur from public.interview_slots where id = a.interview_slot_id;
  if found and cur.starts_at < now() + public._booking_cutoff() then raise exception 'locked'; end if;
  return public._move_interview(a.id, null, 'Candidate');
end;
$$;

-- The server logs it here if the confirmation emails didn't go out (so the committee sees it).
create or replace function public.log_booking_email_failure(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  app uuid;
begin
  if p_token is null or char_length(p_token) < 32 then return; end if;
  select id into app from public.applications where booking_token = p_token;
  if app is null then return; end if;
  if (select count(*) from public.application_notes
       where application_id = app and text like 'Booking email%' and created_at > now() - interval '1 hour') >= 3 then
    return;
  end if;
  insert into public.application_notes (application_id, type, text, author_email)
  values (app, 'auto', 'Booking emails couldn''t be sent. Check they have the details.', 'System');
end;
$$;

-- ---------------------------------------------------------------------------
-- Committee (portal): book, move or cancel for someone. p_slot null = cancel.
-- ---------------------------------------------------------------------------
create or replace function public.committee_set_interview(p_app uuid, p_slot uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sl public.interview_slots%rowtype;
begin
  if not public.is_committee() then raise exception 'not_committee'; end if;
  if p_slot is not null then
    select * into sl from public.interview_slots where id = p_slot;
    if not found then raise exception 'slot_missing'; end if;
    if sl.starts_at < now() then raise exception 'too_late'; end if;
  end if;
  return public._move_interview(p_app, p_slot, lower(coalesce(auth.jwt() ->> 'email', '')));
end;
$$;

-- ---------------------------------------------------------------------------
-- Who can call what. (Supabase grants new functions to anon/authenticated by default, so the
-- internal ones are explicitly revoked.)
-- ---------------------------------------------------------------------------
-- new_booking_token() runs as whoever inserts (it's the column default), so the public form needs it.
-- It only returns a random string.
grant execute on function public.new_booking_token() to anon, authenticated;
revoke all on function public.applications_new_token() from public, anon, authenticated;
revoke all on function public._booking_cutoff() from public, anon, authenticated;
revoke all on function public._fmt_interview(timestamptz) from public, anon, authenticated;
revoke all on function public._move_interview(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.booking_info(text) from public;
revoke all on function public.book_interview(text, uuid) from public;
revoke all on function public.cancel_interview(text) from public;
revoke all on function public.log_booking_email_failure(text) from public;
revoke all on function public.committee_set_interview(uuid, uuid) from public, anon;
grant execute on function public.booking_info(text) to anon, authenticated;
grant execute on function public.book_interview(text, uuid) to anon, authenticated;
grant execute on function public.cancel_interview(text) to anon, authenticated;
grant execute on function public.log_booking_email_failure(text) to anon, authenticated;
grant execute on function public.committee_set_interview(uuid, uuid) to authenticated;

-- Live updates: the portal's Interviews tab refreshes when slots change.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.interview_slots; exception when duplicate_object then null; end;
  end if;
end $$;
