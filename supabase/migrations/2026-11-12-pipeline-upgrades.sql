-- 2026-11-12: waitlist stage, 2nd-choice flag, screening votes.
-- Run once in Supabase -> SQL Editor. Safe to re-run.

-- 1. Waitlist stage
alter table public.applications drop constraint if exists applications_status_chk;
alter table public.applications add constraint applications_status_chk
  check (status in ('applied','review','invited','booked','interviewed','waitlist','offer','rejected'));

-- 2. "Worth considering for 2nd choice" flag (applicants can't set it themselves)
alter table public.applications add column if not exists second_choice_flag boolean not null default false;
drop policy if exists "public can apply" on public.applications;
create policy "public can apply" on public.applications
  for insert to anon
  with check (
    status = 'applied' and rating = '' and assignee = '' and booking = ''
    and booking_slot_id is null and interview_at is null and resume_url = ''
    and second_choice_flag = false
    and consent = true
    and char_length(name) > 0 and char_length(email) > 0
  );

-- 3. Screening votes
create table if not exists public.application_votes (
  application_id uuid not null references public.applications(id) on delete cascade,
  reviewer_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  vote           text not null,
  updated_at     timestamptz not null default now(),
  primary key (application_id, reviewer_email),
  constraint application_votes_vote_chk check (vote in ('yes','maybe','no'))
);
drop trigger if exists application_votes_touch on public.application_votes;
create trigger application_votes_touch before update on public.application_votes
  for each row execute function public.touch_updated_at();

alter table public.application_votes enable row level security;
-- Every reviewer can see all votes, but can only cast, change or remove their own.
drop policy if exists "committee reads votes"  on public.application_votes;
drop policy if exists "reviewer casts vote"    on public.application_votes;
drop policy if exists "reviewer changes vote"  on public.application_votes;
drop policy if exists "reviewer removes vote"  on public.application_votes;
create policy "committee reads votes" on public.application_votes
  for select to authenticated using (public.is_committee());
create policy "reviewer casts vote" on public.application_votes
  for insert to authenticated
  with check (public.is_committee() and reviewer_email = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "reviewer changes vote" on public.application_votes
  for update to authenticated
  using (public.is_committee() and reviewer_email = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (public.is_committee() and reviewer_email = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "reviewer removes vote" on public.application_votes
  for delete to authenticated
  using (public.is_committee() and reviewer_email = lower(coalesce(auth.jwt() ->> 'email', '')));

-- 4. Live updates for votes
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.application_votes; exception when duplicate_object then null; end;
  end if;
end $$;
