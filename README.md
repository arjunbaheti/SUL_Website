# StartUp Link UniMelb website

Next.js (App Router) with the original hand-written CSS, plus Supabase for recruitment (applications, resume uploads, committee login) and one route handler that sends email through Gmail. Deploys to Vercel from `main`.

## Run it

```bash
npm install
cp .env.example .env.local   # fill in GMAIL_APP_PASSWORD (and optionally the Supabase values)
npm run dev                  # http://localhost:3000
npm run build                # production build + type check
```

## Pages

| Route | What it is |
|---|---|
| `/` | Home: hero, word ribbon, past-partner logo strip |
| `/about` | What the club does, plus headline stats |
| `/events` | Instagram embed (`@startuplinkunimelb`) |
| `/partners` | "Partner with us" pitch |
| `/committee` | Committee by term, link to the portal |
| `/join` | Legacy membership form (opens a pre-filled email) |
| `/recruitment` | "Opens late February 2027" page. A faint **Preview application form** button sits at the very bottom |
| `/recruitment-demo` | The working application form, unlisted (`noindex`) for demos |
| `/portal` | Committee sign-in, then the recruitment board |
| `/api/send-email` | Sends invite/offer/rejection emails (committee sessions only) |

Old `*.html` addresses redirect to the new routes (see `next.config.ts`).

## Editing content

- Committee, partners, team blurbs, stats and nav live in `lib/content.ts`.
- Partner logos and the committee photo are in `public/img/`.

## Recruitment backend

```
applicant ──► /recruitment-demo ──► Supabase  ◄── /portal ◄── committee reviewer
              components/apply      Postgres + private file bucket + Auth   components/portal
```

- The browser only holds the public anon key (`lib/supabase-config.ts`). Row Level Security lets an anonymous visitor insert a new application and upload a file, and nothing else. Only signed-in users listed in `committee_members` can read or change applications and open resumes (via 2-minute signed links).
- `supabase/schema.sql` defines the tables, storage bucket and policies. Run it once in the Supabase SQL editor (the header comments list `alter table` lines for databases created earlier).
- Answers to the two main questions are capped at 200 words (+5 slack) in the form.
- The form logs anonymous progress events (field names only, never answers) to `form_events` for the portal's **Health** tab: how many people start, where they drop off, what blocks submit. Setup: run `supabase/migrations/2026-11-14-form-health.sql` once. Clear test data from the Health tab's `⋯` menu.

## Environment variables (Vercel)

`GMAIL_USER`, `GMAIL_APP_PASSWORD`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`. The Supabase pair falls back to the public project values if unset.

## Before recruitment opens (late Feb 2027)

Make the form the main page: move `components/apply/apply-form.tsx` usage from `app/recruitment-demo/page.tsx` into `app/recruitment/page.tsx` and delete the preview link in `components/site/footer.tsx`.

## `legacy/`

The previous plain HTML/CSS/JS site, kept for reference while the rebuild is reviewed. Not part of the build; safe to delete once you're happy.
