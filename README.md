# StartUp Link UniMelb — website

A static site (plain HTML/CSS/JS, no build step) for the University of Melbourne chapter of StartUp Link Australia, with a small Supabase backend for recruitment (applications, resume uploads, committee login) and one Vercel serverless function for email. Recruitment-first: the job is connecting students to the startup ecosystem.

## Pages

- `index.html` — homepage: hero, moving blue background, and a "Past Partners" logo strip
- `about.html` — what the club does (bridge to opportunities, entrepreneurial skills, the Melbourne network) plus headline stats
- `events.html` — full-page Instagram embed (`@startuplinkunimelb`); events and deadlines are posted there
- `partners.html` — "Partner with us": a prospective-partner pitch (hire entrepreneurial talent, meet members, build a pipeline) with a "Get in touch" CTA
- `committee.html` — the committee: group-photo banner, roster by two-year term, and a Committee Portal button
- `portal.html` — committee-only portal: a login gate that opens the recruitment CRM (see below)
- `recruitment.html` — public **Recruitment** tab: committee application form with resume/attachment upload (see "Recruitment backend" below)
- `join.html` — legacy membership signup form; no longer linked in nav ("Join now" goes to UMSU)

## Running it

The static pages need no install. The recruitment form and portal need the backend configured first (see "Backend setup"); without it they show a friendly "not connected" message instead of breaking. Either:

- Open `index.html` directly in a browser, or
- From this folder, run `python3 -m http.server 8000` and visit `http://localhost:8000`

## Editing content

- **Past partner logos** live in `content/partners.js` (name, `logo` path, `url`, and optional `mono: true` for solid-black wordmarks so they stay white on the dark background). Logo files sit in `assets/img/` and should be trimmed, transparent-background PNGs/SVGs.
- **Committee** data lives in `content/committee.js` as plain JS arrays. Copy an existing entry, change the values, give it a unique `id`, save, refresh.

These files load via `<script>` tags (not `.json`) so the site works even when opened as a local file. Editing is copy-paste-and-fill-in-blanks but still requires respecting JS syntax (commas, quotes).

## Recruitment backend

```
 applicant ──► recruitment.html ──► Supabase  ◄── portal.html ◄── committee reviewer
               (apply.js)           Postgres + private file bucket + Auth   (recruitment.js)
```

- **Public form** (`recruitment.html`, `assets/js/apply.js`): name, contact, degree, expected graduation date, first/second-choice role, "why join", LinkedIn/portfolio link, a required **resume** and an optional extra attachment (PDF/DOC/DOCX, plus PPT/PPTX/PNG/JPG for the extra file; 3 MB each). Files go to a **private** Storage bucket, then one row is written to `applications` and shows up in the **Applied** column of the portal within a second (live updates).
- **Database** (`supabase/schema.sql`): `applications`, `application_notes` (notes + activity, one row each so two reviewers never overwrite each other), `booking_slots` (shared zcal slots), `committee_members` (reviewer allowlist) and the `resumes` bucket.
- **Security**: the browser only holds the public *anon* key. Row Level Security lets an anonymous visitor do exactly two things: insert a fresh application (status/rating/assignee are locked to defaults, consent required) and upload a file. They can never read, list or change anything. Only signed-in users whose email is in `committee_members` can read/update applications, read notes and open resumes (via 2-minute signed links). The portal login is real Supabase Auth, and `api/send-email.js` now refuses callers who aren't on that list.
- Spam protection is deliberately light (hidden honeypot field, 3 MB / file-type limits, field length limits enforced by the database). If you get bot traffic, add Cloudflare Turnstile to the form.

### Backend setup (one-time, ~10 minutes)

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**, paste all of `supabase/schema.sql`, **Run**. (Safe to re-run.)
3. **Authentication → Providers → Email**: keep Email on, and turn **off "Allow new users to sign up"** so only people you create can sign in. **Authentication → Users → Add user** for each reviewer (email + password, tick "Auto confirm").
4. Add each reviewer to the allowlist (SQL editor), using the same emails:
   `insert into public.committee_members (email) values ('someone@startuplinkunimelb.net');`
   (Being a Supabase user alone is not enough; this table is what grants access.)
5. **Project Settings → API**: copy the *Project URL* and *anon public* key into `assets/js/config.js`. Commit it (these two are public by design). **Never** use the `service_role` key anywhere in this repo.
6. In **Vercel → Project Settings → Environment Variables** add `SUPABASE_URL` and `SUPABASE_ANON_KEY` (same two values) next to the existing `GMAIL_*` variables, then redeploy. Without them the Send invite/offer/rejection buttons return a clear error.
7. Test: submit the form on `/recruitment`, then sign in at `/portal` with a reviewer account.

Locally, `python3 -m http.server 8000` is enough to try the form and portal against your Supabase project; only the email sending needs `vercel dev`.

To remove a reviewer: delete the user in Authentication and `delete from public.committee_members where email = '...'`.

## Committee Portal & Recruitment CRM

`portal.html` is the committee-only reviewer view. Sign in with your committee email and password (Supabase Auth). It opens a recruitment CRM for tracking applicants through the hiring
pipeline: **Applied → Under review → Interview invited → Interview booked →
Interviewed → Offer / Rejected**.

Code: `assets/js/recruitment.js` (logic), `assets/css/portal.css` (styles).

Applicants aren't added by hand: they land in **Applied** when they submit the public form. **Import from CSV** (⋯ menu) is still there for migrating an old spreadsheet; it adds rows and never replaces anything.

What it does:
- **Kanban board** with a column per stage; drag a card between columns to move an
  applicant (or change the stage from the applicant's detail panel on mobile).
- **Full application view**: open a card to see everything the applicant submitted (degree, year, second choice, link, statement) and **open their resume / attachments** in one click.
- **Assigned to**: each applicant can be assigned to a committee role (Marketing
  Director, Projects Director, Events Director, etc. — the fixed list is in
  `ASSIGNEES` near the top of `recruitment.js`). Filter the board by assignee so a
  director can see just their own applicants.
- **Applicant records**: name, email, phone, role, assignee, interview
  booking link, interview time, stage, and a Yes/Maybe/No rating.
- **Shared and live**: everyone on the committee sees the same board; new applications and teammates' edits appear without refreshing. Edits send only the fields you changed, so two people editing different things don't overwrite each other.
- **Booking links**: set up multiple recurring interview slots (⋯ menu → Manage
  booking links), each with a day, time window, and its own zcal link. Picking a slot
  on an applicant auto-fills the booking link and suggests the next matching interview
  time. Slots are shared across the committee.
- **Send invite / offer / rejection emails**: cards in the Under review, Offer, and
  Rejected columns get a matching "Send…" button. It opens a small compose window
  (editable subject/body, pre-filled) and sends straight from `info@startuplinkunimelb.net`
  via Gmail — no leaving the browser. Sending an invite also moves the applicant to
  Interview invited automatically; every send is logged in the applicant's activity feed.
  There's a "Copy instead" button in the same window if you'd rather send it yourself.
- **Interview notes vs. activity**: manual notes (typed by committee members, with the author's email) sit in
  their own section, newest first, separate from the auto-generated activity log
  (stage changes, invites sent) below them.
- **Search / filter** by name, role, degree, assignee, or rating; live stat tiles across the top.
- **Export**: JSON (snapshot) and CSV (includes the application answers and attachment file names).
- **Delete** removes the applicant, their notes and their uploaded files.

**Sending real emails:** `api/send-email.js` is a small Vercel serverless function that sends via Gmail SMTP
(using `nodemailer` — see `package.json`). It reads the Gmail address and an
[app password](https://myaccount.google.com/apppasswords) from environment variables,
never from source, and requires a signed-in committee member's session token:

- In Vercel: Project Settings → Environment Variables → add `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `SUPABASE_URL` and `SUPABASE_ANON_KEY`, then redeploy.
- Locally: copy `.env.example` to `.env.local` and fill it in (gitignored) if testing
  with `vercel dev` — the Vercel CLI needs Node/npm installed.

If those variables aren't set, the Send buttons will fail with a clear error instead
of silently doing nothing; "Copy instead" always works regardless.

## Motion / interaction

All motion is disabled automatically for visitors with "reduce motion" set, and pointer-driven effects only run on fine-pointer (non-touch) devices:

- Spring-magnetic primary buttons, hover sheen sweep, and a shimmering hero accent word
- 3D tilt + pointer glare on the committee cards
- Blur-in scroll reveals, count-up stats, custom cursor, scroll-progress bar
- Mask-reveal hero headline, scroll-velocity kinetic ribbons, cursor spotlights, moving background orbs
- Stepped logo carousel on the "Past Partners" strip (rotates when there are more logos than fit)

## Brand

Colour tokens are in `assets/css/style.css` (`:root` variables): ice-blue accent `#C5E4EC`, near-black background stepping to royal blue. Contact email is `info@startuplinkunimelb.net`. All "Join now" buttons point to the club's UMSU join page (https://umsu.unimelb.edu.au/buddy-up/clubs/clubs-listing/join/8055/), so UMSU is the membership datastore.

## To confirm before/after launch

- **Past partner list** in `content/partners.js` (Antler, Blackbird, Startmate, InvestorHub, Archa, Zeller) — confirm every company listed was genuinely a partner, and double-check each `url` resolves.
- **Stats** on `about.html` and `partners.html` (700+ members in 2025, 45+ committee, 10+ events a year, 4 branches) — confirm the figures.
- **Backend setup** (above) must be done before launch, and `assets/js/config.js` filled in. Until then the Recruitment page shows an "applications aren't open" notice.
- **Applicant privacy**: applications hold personal data (contact details, resumes). Decide a retention period and delete old rounds (Delete in the portal also removes the files); consider adding a short privacy notice link to the form's consent line.
- **Supabase free tier** pauses projects after about a week of inactivity and has no automatic backups; use Export in the portal around each recruitment round, or upgrade.
- **Instagram profile embed** on `events.html` uses `instagram.com/<handle>/embed`, which Instagram blocks for full profiles (single posts only), so the styled fallback panel is what visitors will usually see. For a live grid, generate a free widget (behold.so / snapwidget) and paste its `<iframe>` in place.
- **`join.html`** still exists but is unlinked from nav; keep or delete it depending on whether UMSU fully covers signup. (It still carries a visible "prototype" note.)
- **Social links** in the homepage footer point at the real Instagram and LinkedIn company pages.

## Verified

- All pages served correctly via local HTTP server (200 OK), including CSS/JS and image assets.
- `supabase/schema.sql` was run against a local Postgres with Supabase-style roles and tested: anonymous users can apply and upload but cannot read, self-approve or overwrite; non-allowlisted accounts see nothing; allowlisted reviewers can read, move, annotate and delete. The form and board logic were exercised in jsdom against a mocked client. **Not yet run against a real Supabase project.**
- Not yet checked in an actual browser here (no browser automation in this environment) — recommend opening `index.html` locally and clicking through, especially the mobile layout at 375px width and the hover/motion effects.
