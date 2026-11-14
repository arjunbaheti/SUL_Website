-- 2026-11-15: committee members' first names, shown in the portal greeting ("Good morning,
-- Arjun") and next to live presence avatars. Run once in Supabase -> SQL Editor. Safe to re-run.
alter table public.committee_members add column if not exists first_name text;

-- Then fill in each member's first name, e.g.:
-- update public.committee_members set first_name = 'Arjun' where email = 'arjun@example.com';
--
-- To see who still needs one:
-- select email, first_name from public.committee_members order by email;
