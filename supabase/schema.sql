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
--   form_events         anonymous application-form progress (no answers), for the Health tab
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
--   alter table public.applications drop constraint if exists applications_status_chk;
--   alter table public.applications add constraint applications_status_chk check (status in ('applied','review','invited','booked','interviewed','waitlist','offer','rejected'));
--   alter table public.applications add column if not exists second_choice_flag boolean not null default false;
--   (then re-run the "public can apply" policy below, and the "Screening votes" section)
--   alter table public.applications add constraint applications_answer_words check (coalesce(array_length(regexp_split_to_array(btrim(statement), '\s+'), 1), 0) <= 205 and coalesce(array_length(regexp_split_to_array(btrim(experience), '\s+'), 1), 0) <= 205) not valid;
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
  second_choice_flag boolean not null default false, -- worth considering for their 2nd-choice team
  confirmation_sent_at timestamptz,                   -- when the "application received" email went out

  constraint applications_status_chk   check (status in ('applied','review','invited','booked','interviewed','waitlist','offer','rejected')),
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
    and second_choice_flag = false and confirmation_sent_at is null
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
  -- manual = application note, interview = interview note (unlocked at the interview stage), auto = activity log
  constraint application_notes_type_chk check (type in ('manual','interview','auto')),
  constraint application_notes_len      check (char_length(text) between 1 and 5000)
);
-- EXISTING DATABASE? Run this once to allow interview notes:
--   alter table public.application_notes drop constraint if exists application_notes_type_chk;
--   alter table public.application_notes add constraint application_notes_type_chk check (type in ('manual','interview','auto'));
create index if not exists application_notes_app_idx on public.application_notes (application_id, created_at desc);

alter table public.application_notes enable row level security;
drop policy if exists "committee manages notes" on public.application_notes;
create policy "committee manages notes" on public.application_notes
  for all to authenticated using (public.is_committee()) with check (public.is_committee());

-- ---------------------------------------------------------------------------
-- Screening votes: one Yes/Maybe/No per reviewer per applicant (decides who gets an interview).
-- 'conflict' means the reviewer knows the applicant: it replaces their vote and isn't counted.
-- ---------------------------------------------------------------------------
create table if not exists public.application_votes (
  application_id uuid not null references public.applications(id) on delete cascade,
  reviewer_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  vote           text not null,
  updated_at     timestamptz not null default now(),
  primary key (application_id, reviewer_email),
  constraint application_votes_vote_chk check (vote in ('yes','maybe','no','conflict'))
);
-- Existing databases: widen the check to allow 'conflict'.
alter table public.application_votes drop constraint if exists application_votes_vote_chk;
alter table public.application_votes add constraint application_votes_vote_chk check (vote in ('yes','maybe','no','conflict'));
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
-- Portal settings (email templates, sender name, board behaviour) — one shared row, id 'main'
-- EXISTING DATABASE? Run from here down to "Live updates" once to add it.
-- ---------------------------------------------------------------------------
create table if not exists public.portal_settings (
  id          text primary key default 'main',
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default coalesce(auth.jwt() ->> 'email', ''),
  constraint portal_settings_single check (id = 'main'),
  constraint portal_settings_shape  check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 65536)
);

create or replace function public.touch_portal_settings()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  new.updated_by = coalesce(auth.jwt() ->> 'email', '');
  return new;
end;
$$;
drop trigger if exists portal_settings_touch on public.portal_settings;
create trigger portal_settings_touch before insert or update on public.portal_settings
  for each row execute function public.touch_portal_settings();

alter table public.portal_settings enable row level security;
drop policy if exists "committee manages settings" on public.portal_settings;
create policy "committee manages settings" on public.portal_settings
  for all to authenticated using (public.is_committee()) with check (public.is_committee());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.portal_settings; exception when duplicate_object then null; end;
  end if;
end $$;

-- "Application received" email (app/api/application-received). Called anonymously by the
-- server straight after someone applies. Marks the application as confirmed and returns who
-- to email plus the saved settings, but only when an email is genuinely due:
--   * this application hasn't been confirmed yet and was created in the last 15 minutes
--   * the same email address hasn't had a confirmation in the last day
--   * fewer than 250 confirmations have gone out in the last day (protects the Gmail quota)
--   * confirmations aren't switched off in portal Settings
-- Returns no rows otherwise. Exposes nothing else to the public.
create or replace function public.claim_application_confirmation(app_id uuid)
returns table (name text, email text, role text, settings jsonb)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  s jsonb;
  r record;
begin
  select coalesce(ps.data, '{}'::jsonb) into s from public.portal_settings ps where ps.id = 'main';
  s := coalesce(s, '{}'::jsonb);
  if jsonb_typeof(s -> 'confirmationEnabled') = 'boolean' and (s ->> 'confirmationEnabled')::boolean = false then
    return;
  end if;
  if (select count(*) from public.applications x where x.confirmation_sent_at > now() - interval '1 day') >= 250 then
    return;
  end if;

  update public.applications ap
     set confirmation_sent_at = now()
   where ap.id = app_id
     and ap.confirmation_sent_at is null
     and ap.created_at > now() - interval '15 minutes'
     and ap.email <> ''
     and not exists (
       select 1 from public.applications o
        where lower(o.email) = lower(ap.email) and o.id <> ap.id
          and o.confirmation_sent_at > now() - interval '1 day')
  returning ap.name, ap.email, ap.role into r;

  if not found then return; end if;
  name := r.name; email := r.email; role := r.role; settings := s;
  return next;
end;
$$;
revoke all on function public.claim_application_confirmation(uuid) from public;
grant execute on function public.claim_application_confirmation(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Application health (anonymous form progress events; see the portal's Health tab)
-- ---------------------------------------------------------------------------
--
-- Privacy: no answers, names or emails are stored. Each row is just "session X did <event> on
-- <field name> at <time>", where session X is a random id kept in the visitor's browser tab.
create table if not exists public.form_events (
  id         bigint generated always as identity primary key,
  session_id uuid not null,
  event      text not null,
  field      text,
  device     text,
  created_at timestamptz not null default now(),
  constraint form_events_event_chk  check (event in ('view','start','field','invalid','submit','error','submitted')),
  constraint form_events_field_chk  check (field is null or field ~ '^[a-z0-9_]{1,32}$'),
  constraint form_events_device_chk check (device is null or device in ('mobile','desktop'))
);
create index if not exists form_events_created_idx on public.form_events (created_at);
create index if not exists form_events_session_idx on public.form_events (session_id);

alter table public.form_events enable row level security;

-- Visitors can only add events (stamped with the server's time); they can never read them.
drop policy if exists "public logs form events" on public.form_events;
create policy "public logs form events" on public.form_events
  for insert to anon, authenticated
  with check (created_at > now() - interval '1 minute' and created_at < now() + interval '1 minute');

drop policy if exists "committee reads form events"   on public.form_events;
drop policy if exists "committee clears form events"  on public.form_events;
create policy "committee reads form events"  on public.form_events for select to authenticated using (public.is_committee());
create policy "committee clears form events" on public.form_events for delete to authenticated using (public.is_committee());

grant insert on public.form_events to anon, authenticated;
grant select, delete on public.form_events to authenticated;

-- ---------------------------------------------------------------------------
-- Live updates for the board (new applications appear without a refresh)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.applications;      exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.application_notes; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.booking_slots;     exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.application_votes; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- AFTER RUNNING: add yourself (and each reviewer) to the allowlist, e.g.
--   insert into public.committee_members (email) values ('you@startuplinkunimelb.net');
-- then create the matching user in Authentication -> Users (see README, "Backend setup").
-- ---------------------------------------------------------------------------
