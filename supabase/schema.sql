-- StartUp Link UniMelb: recruitment backend (Supabase / Postgres)
--
-- Run this whole file once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- It is safe to re-run (everything is "if not exists" / "or replace" / drop-then-create).
--
-- What it sets up
--   committee_members   allowlist of reviewer emails (who may sign in to the portal)
--   applications        one row per public application (the CRM board reads/writes this)
--   application_notes   interview notes + activity log, one row per entry (safe for many editors)
--   booking_slots       shared zcal interview slots (was per-browser localStorage)
--   storage bucket      "resumes" (PRIVATE): resume + extra attachments
--
-- Security model
--   * The public site uses the "anon" key. Anon can ONLY insert an application (with a locked-down
--     status/rating/assignee) and upload a file into the resumes bucket. It can never read anything.
--   * Reviewers sign in with Supabase Auth. Row Level Security only lets users whose email is in
--     committee_members read/update applications, notes, slots, and download resumes.

-- ---------------------------------------------------------------------------
-- Reviewer allowlist
-- ---------------------------------------------------------------------------
create table if not exists public.committee_members (
  email      text primary key,
  added_at   timestamptz not null default now(),
  constraint committee_email_lower check (email = lower(email))
);
alter table public.committee_members enable row level security;

-- SECURITY DEFINER so policies can consult the allowlist without exposing it.
create or replace function public.is_committee()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.committee_members
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_committee() from public;
grant execute on function public.is_committee() to anon, authenticated;

drop policy if exists "committee reads allowlist" on public.committee_members;
create policy "committee reads allowlist" on public.committee_members
  for select to authenticated using (public.is_committee());
-- No insert/update/delete policies: manage reviewers from the SQL editor / dashboard only.

-- ---------------------------------------------------------------------------
-- Shared interview booking slots
-- ---------------------------------------------------------------------------
create table if not exists public.booking_slots (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  label      text not null default 'Interview slot',
  day        int  not null default 0,        -- 0 = Sunday .. 6 = Saturday
  start_time text not null default '00:00',
  end_time   text not null default '',
  url        text not null,
  constraint booking_slots_day_chk check (day between 0 and 6)
);
alter table public.booking_slots enable row level security;
drop policy if exists "committee manages slots" on public.booking_slots;
create policy "committee manages slots" on public.booking_slots
  for all to authenticated using (public.is_committee()) with check (public.is_committee());

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------
-- If the table already exists, run this once in the SQL editor:
--   alter table public.applications add column if not exists experience text not null default '';
--   alter table public.applications add constraint applications_experience_len check (char_length(experience) <= 3000);
--   alter table public.applications add column if not exists extra_note text not null default '';
--   alter table public.applications add constraint applications_extra_note_len check (char_length(extra_note) <= 200);
--   alter table public.applications add column if not exists questions text not null default '';
--   alter table public.applications add constraint applications_questions_len check (char_length(questions) <= 1000);
create table if not exists public.applications (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Supplied by the applicant (public form)
  name            text not null,
  email           text not null default '',
  phone           text not null default '',
  degree          text not null default '',
  year_level      text not null default '',
  role            text not null default '',            -- first preference
  role_secondary  text not null default '',
  statement       text not null default '',            -- "why do you want to join"
  linkedin        text not null default '',
  experience      text not null default '',            -- skills and experience they'd bring
  extra_note      text not null default '',            -- short note or link to go with the optional attachment
  questions       text not null default '',            -- optional questions from the applicant
  -- [{ path, name, size, mime, kind: 'resume' | 'other' }] -> objects in the "resumes" bucket
  files           jsonb not null default '[]'::jsonb,
  consent         boolean not null default false,

  -- Managed by the committee (CRM board)
  status          text not null default 'applied',
  rating          text not null default '',
  assignee        text not null default '',
  booking         text not null default '',
  booking_slot_id uuid references public.booking_slots(id) on delete set null,
  resume_url      text not null default '',            -- legacy/imported link; new applicants use files
  interview_at    timestamptz,

  constraint applications_status_chk   check (status in ('applied','review','invited','booked','interviewed','offer','rejected')),
  constraint applications_rating_chk   check (rating in ('','yes','maybe','no')),
  constraint applications_name_len     check (char_length(name) between 1 and 120),
  constraint applications_email_len    check (char_length(email) <= 254 and (email = '' or email like '%_@_%')),
  constraint applications_phone_len    check (char_length(phone) <= 40),
  constraint applications_degree_len   check (char_length(degree) <= 120),
  constraint applications_year_len     check (char_length(year_level) <= 40),
  constraint applications_role_len     check (char_length(role) <= 120 and char_length(role_secondary) <= 120),
  constraint applications_statement_len check (char_length(statement) <= 3000),
  constraint applications_linkedin_len check (char_length(linkedin) <= 300),
  constraint applications_experience_len check (char_length(experience) <= 3000),
  constraint applications_extra_note_len check (char_length(extra_note) <= 200),
  constraint applications_questions_len check (char_length(questions) <= 1000),
  constraint applications_resume_url_len check (char_length(resume_url) <= 500),
  constraint applications_files_shape  check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 3)
);
create index if not exists applications_status_idx  on public.applications (status);
create index if not exists applications_created_idx on public.applications (created_at desc);
create index if not exists applications_email_idx   on public.applications (lower(email));

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists applications_touch on public.applications;
create trigger applications_touch before update on public.applications
  for each row execute function public.touch_updated_at();

alter table public.applications enable row level security;

-- Public applicants: insert only, and only into the "fresh application" state.
drop policy if exists "public can apply" on public.applications;
create policy "public can apply" on public.applications
  for insert to anon
  with check (
    status = 'applied' and rating = '' and assignee = '' and booking = ''
    and booking_slot_id is null and interview_at is null and resume_url = ''
    and consent = true
    and char_length(name) > 0 and char_length(email) > 0
  );

drop policy if exists "committee reads applications"   on public.applications;
drop policy if exists "committee inserts applications" on public.applications;
drop policy if exists "committee updates applications" on public.applications;
drop policy if exists "committee deletes applications" on public.applications;
create policy "committee reads applications"   on public.applications for select to authenticated using (public.is_committee());
create policy "committee inserts applications" on public.applications for insert to authenticated with check (public.is_committee());
create policy "committee updates applications" on public.applications for update to authenticated using (public.is_committee()) with check (public.is_committee());
create policy "committee deletes applications" on public.applications for delete to authenticated using (public.is_committee());

-- ---------------------------------------------------------------------------
-- Notes + activity log (one row per entry so two reviewers never overwrite each other)
-- ---------------------------------------------------------------------------
create table if not exists public.application_notes (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  created_at     timestamptz not null default now(),
  type           text not null default 'manual',
  text           text not null,
  author_email   text not null default coalesce(auth.jwt() ->> 'email', ''),
  constraint application_notes_type_chk check (type in ('manual','auto')),
  constraint application_notes_len      check (char_length(text) between 1 and 5000)
);
create index if not exists application_notes_app_idx on public.application_notes (application_id, created_at desc);

alter table public.application_notes enable row level security;
drop policy if exists "committee manages notes" on public.application_notes;
create policy "committee manages notes" on public.application_notes
  for all to authenticated using (public.is_committee()) with check (public.is_committee());

-- ---------------------------------------------------------------------------
-- Resume / attachment storage (PRIVATE bucket, 3 MB per file, documents + images only)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes', 'resumes', false, 3145728,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Applicants can add files (no read, no overwrite, no delete). Path must be "<folder>/<file>".
drop policy if exists "public uploads resumes" on storage.objects;
create policy "public uploads resumes" on storage.objects
  for insert to anon
  with check (bucket_id = 'resumes' and array_length(storage.foldername(name), 1) = 1);

drop policy if exists "committee reads resumes"   on storage.objects;
drop policy if exists "committee deletes resumes" on storage.objects;
create policy "committee reads resumes"   on storage.objects for select to authenticated using (bucket_id = 'resumes' and public.is_committee());
create policy "committee deletes resumes" on storage.objects for delete to authenticated using (bucket_id = 'resumes' and public.is_committee());

-- ---------------------------------------------------------------------------
-- Live updates for the board (new applications appear without a refresh)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.applications;      exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.application_notes; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.booking_slots;     exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- AFTER RUNNING: add yourself (and each reviewer) to the allowlist, e.g.
--   insert into public.committee_members (email) values ('you@startuplinkunimelb.net');
-- then create the matching user in Authentication -> Users (see README, "Backend setup").
-- ---------------------------------------------------------------------------
