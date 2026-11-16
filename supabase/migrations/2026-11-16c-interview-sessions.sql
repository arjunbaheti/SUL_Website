-- 2026-11-16 (c): named interview sessions ("Project interviews", "Events interviews", ...).
-- Run once after 2026-11-16-interview-booking.sql and 2026-11-16b-booking-edge-cases.sql.
-- Safe to re-run.
--
-- A session groups interview slots and decides who can book them: the teams it's for (empty =
-- every team), default interviewers and location, and an optional note shown to candidates.
-- Applicants see a session's slots if it's for their first-choice team, or for their second-choice
-- team when the committee has flagged them for it. Slots without a session keep working as before.

create table if not exists public.interview_sessions (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  name         text not null,
  teams        text[] not null default '{}',
  interviewers text[] not null default '{}',
  location     text not null default '',
  note         text not null default '',
  created_by   text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  constraint interview_sessions_name_len     check (char_length(btrim(name)) between 1 and 80),
  constraint interview_sessions_location_len check (char_length(location) <= 300),
  constraint interview_sessions_note_len     check (char_length(note) <= 500),
  constraint interview_sessions_teams_chk    check (coalesce(array_length(teams, 1), 0) <= 12),
  constraint interview_sessions_people_chk   check (coalesce(array_length(interviewers, 1), 0) <= 20)
);

alter table public.interview_sessions enable row level security;
drop policy if exists "committee manages interview sessions" on public.interview_sessions;
create policy "committee manages interview sessions" on public.interview_sessions
  for all to authenticated using (public.is_committee()) with check (public.is_committee());
revoke all on public.interview_sessions from anon;

-- Deleting a session that still has slots is refused (delete its open slots first; booked ones
-- can't be deleted at all).
alter table public.interview_slots add column if not exists session_id uuid
  references public.interview_sessions(id) on delete restrict;
create index if not exists interview_slots_session_idx on public.interview_slots (session_id);

-- ---------------------------------------------------------------------------
-- Who may book a slot
-- ---------------------------------------------------------------------------
create or replace function public._slot_open_to(p_slot public.interview_slots, p_app public.applications)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_slot.session_id is null then p_slot.team = '' or p_slot.team = p_app.role
    else coalesce((
      select coalesce(array_length(ss.teams, 1), 0) = 0
          or p_app.role = any(ss.teams)
          or (p_app.second_choice_flag and p_app.role_secondary <> '' and p_app.role_secondary = any(ss.teams))
        from public.interview_sessions ss
       where ss.id = p_slot.session_id), false)
  end;
$$;

-- ---------------------------------------------------------------------------
-- Booking page: slots now carry their session's name and note
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
  if a.status not in ('applied', 'review', 'invited', 'booked') then raise exception 'closed'; end if;
  if a.interview_slot_id is not distinct from p_slot then return jsonb_build_object('changed', false); end if;
  select * into sl from public.interview_slots where id = p_slot;
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
  if public._candidate_changes_today(a.id) >= 8 then raise exception 'too_many'; end if;
  return public._move_interview(a.id, p_slot, 'Candidate');
end;
$$;

revoke all on function public._slot_open_to(public.interview_slots, public.applications) from public, anon, authenticated;
revoke all on function public.booking_info(text) from public;
revoke all on function public.book_interview(text, uuid) from public;
grant execute on function public.booking_info(text) to anon, authenticated;
grant execute on function public.book_interview(text, uuid) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.interview_sessions; exception when duplicate_object then null; end;
  end if;
end $$;
