-- 2026-11-12 (b): "application received" confirmation emails.
-- Run once in Supabase -> SQL Editor. Safe to re-run.

alter table public.applications add column if not exists confirmation_sent_at timestamptz;

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
