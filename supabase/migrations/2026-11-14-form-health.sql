-- 2026-11-14: application health. Anonymous progress events from the public application form,
-- so the committee can see how many people start, where they stop, and what blocks them.
-- Run once in Supabase -> SQL Editor. Safe to re-run.
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
