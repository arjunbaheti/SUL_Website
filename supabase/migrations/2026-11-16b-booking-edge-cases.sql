-- 2026-11-16 (b): interview booking edge cases. Run once after 2026-11-16-interview-booking.sql.
-- Safe to re-run.
--
--   * Applicants still in "Applied" (invited straight from there) can use their booking link.
--   * Someone with two applications under the same email can't hold two upcoming interviews.
--   * A candidate can change their booking at most 8 times a day (stops a link being used to
--     flood interviewers with calendar emails).
--   * Moving a booked applicant back to Applied / Under review / Invited / Rejected frees their
--     upcoming slot, so it can't stay blocked. (The portal also cancels it first and emails the
--     interviewers; this is the safety net for every other path.)

-- ---------------------------------------------------------------------------
-- Booking page
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
  cutoff interval := public._booking_cutoff();
  is_open boolean;
begin
  if p_token is null or char_length(p_token) < 32 then return null; end if;
  select * into a from public.applications where booking_token = p_token;
  if not found then return null; end if;
  if a.interview_slot_id is not null then
    select * into cur from public.interview_slots where id = a.interview_slot_id;
  end if;
  is_open := a.status in ('applied', 'review', 'invited', 'booked');
  return jsonb_build_object(
    'first_name', split_part(btrim(a.name), ' ', 1),
    'role', a.role,
    'open', is_open,
    'cutoff_hours', extract(epoch from cutoff) / 3600,
    'current', case when cur.id is null then null else jsonb_build_object(
      'id', cur.id, 'starts_at', cur.starts_at, 'ends_at', cur.ends_at, 'location', cur.location,
      'can_change', cur.starts_at >= now() + cutoff) end,
    'slots', case when not is_open then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'location', s.location)
             order by s.starts_at)
        from public.interview_slots s
       where s.starts_at >= now() + cutoff
         and (s.team = '' or s.team = a.role)
         and not exists (select 1 from public.applications x where x.interview_slot_id = s.id)
    ), '[]'::jsonb) end
  );
end;
$$;

-- How many times this candidate has booked/moved/cancelled in the last day.
create or replace function public._candidate_changes_today(p_app uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.application_notes
   where application_id = p_app and author_email = 'Candidate'
     and created_at > now() - interval '1 day'
     and (text like 'Interview booked%' or text like 'Interview moved%' or text like 'Interview cancelled%');
$$;

-- Errors: invalid_link, closed, slot_missing, slot_taken, too_late, locked, already_booked, too_many.
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
  if not found or (sl.team <> '' and sl.team <> a.role) then raise exception 'slot_missing'; end if;
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
  if public._candidate_changes_today(a.id) >= 8 then raise exception 'too_many'; end if;
  return public._move_interview(a.id, null, 'Candidate');
end;
$$;

-- ---------------------------------------------------------------------------
-- Safety net: a booked applicant moved back (or rejected) gives up their upcoming slot.
-- ---------------------------------------------------------------------------
create or replace function public.applications_release_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  st timestamptz;
begin
  if old.interview_slot_id is null
     or new.interview_slot_id is distinct from old.interview_slot_id
     or new.status = old.status
     or new.status not in ('applied', 'review', 'invited', 'rejected') then
    return new;
  end if;
  select starts_at into st from public.interview_slots where id = old.interview_slot_id;
  if st is null or st <= now() then return new; end if;
  new.interview_slot_id := null;
  new.interview_at := null;
  insert into public.application_notes (application_id, type, text, author_email)
  values (new.id, 'auto',
    'Interview cancelled (was ' || public._fmt_interview(st) || ') when they left Interview booked',
    lower(coalesce(auth.jwt() ->> 'email', '')));
  return new;
end;
$$;
drop trigger if exists applications_release_slot on public.applications;
create trigger applications_release_slot before update of status on public.applications
  for each row execute function public.applications_release_slot();

revoke all on function public._candidate_changes_today(uuid) from public, anon, authenticated;
revoke all on function public.applications_release_slot() from public, anon, authenticated;
revoke all on function public.booking_info(text) from public;
revoke all on function public.book_interview(text, uuid) from public;
revoke all on function public.cancel_interview(text) from public;
grant execute on function public.booking_info(text) to anon, authenticated;
grant execute on function public.book_interview(text, uuid) to anon, authenticated;
grant execute on function public.cancel_interview(text) to anon, authenticated;
