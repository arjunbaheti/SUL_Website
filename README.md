# StartUp Link UniMelb — website

A dependency-free static site (plain HTML/CSS/JS, no build step, no Node/npm required) for the University of Melbourne chapter of StartUp Link Australia. Recruitment-first: the job is connecting students to the startup ecosystem.

## Pages

- `index.html` — homepage: hero, moving blue background, and a "Past Partners" logo strip
- `about.html` — what the club does (bridge to opportunities, entrepreneurial skills, the Melbourne network) plus headline stats
- `events.html` — full-page Instagram embed (`@startuplinkunimelb`); events and deadlines are posted there
- `partners.html` — "Partner with us": a prospective-partner pitch (hire entrepreneurial talent, meet members, build a pipeline) with a "Get in touch" CTA
- `committee.html` — the committee: group-photo banner, roster by two-year term, and a Committee Portal button
- `portal.html` — committee-only portal: a login gate that opens the recruitment CRM (see below)
- `join.html` — legacy membership signup form; no longer linked in nav ("Join now" goes to UMSU)

## Running it

No install needed. Either:

- Open `index.html` directly in a browser, or
- From this folder, run `python3 -m http.server 8000` and visit `http://localhost:8000`

## Editing content

- **Past partner logos** live in `content/partners.js` (name, `logo` path, `url`, and optional `mono: true` for solid-black wordmarks so they stay white on the dark background). Logo files sit in `assets/img/` and should be trimmed, transparent-background PNGs/SVGs.
- **Committee** data lives in `content/committee.js` as plain JS arrays. Copy an existing entry, change the values, give it a unique `id`, save, refresh.

These files load via `<script>` tags (not `.json`) so the site works even when opened as a local file. Editing is copy-paste-and-fill-in-blanks but still requires respecting JS syntax (commas, quotes).

## Committee Portal & Recruitment CRM

`portal.html` sits behind a login gate (currently `test` / `test`, validated in the
browser only) and opens a recruitment CRM for tracking applicants through the hiring
pipeline: **Applied → Under review → Interview invited → Interview booked →
Interviewed → Offer / Rejected**.

Code: `assets/js/recruitment.js` (logic), `assets/css/portal.css` (styles).

Applicants aren't added by hand — the intent is they land here automatically once the
application form is wired up (not built yet). For now, get data in via **Import from
CSV** (migrate the existing spreadsheet) or **Load sample data** (⋯ menu); the board
works the same either way.

What it does:
- **Kanban board** with a column per stage; drag a card between columns to move an
  applicant (or change the stage from the applicant's detail panel on mobile).
- **Assigned to**: each applicant can be assigned to a committee role (Marketing
  Director, Projects Director, Events Director, etc. — the fixed list is in
  `ASSIGNEES` near the top of `recruitment.js`). Filter the board by assignee so a
  director can see just their own applicants.
- **Applicant records**: name, email, phone, role, assignee, resume link, interview
  booking link, interview time, stage, and a Yes/Maybe/No rating.
- **Booking links**: set up multiple recurring interview slots (⋯ menu → Manage
  booking links), each with a day, time window, and its own zcal link. Picking a slot
  on an applicant auto-fills the booking link and suggests the next matching interview
  time.
- **Send invite / offer / rejection emails**: cards in the Under review, Offer, and
  Rejected columns get a matching "Send…" button. It opens a small compose window
  (editable subject/body, pre-filled) and sends straight from `info@startuplinkunimelb.net`
  via Gmail — no leaving the browser. Sending an invite also moves the applicant to
  Interview invited automatically; every send is logged in the applicant's activity feed.
  There's a "Copy instead" button in the same window if you'd rather send it yourself.
  The applicant's profile also keeps a "Copy invite" button for a clipboard-only invite.
- **Interview notes vs. activity**: manual notes (typed by committee members) sit in
  their own section, newest first, separate from the auto-generated activity log
  (stage changes, invites sent) below them.
- **Search / filter** by name, role, assignee, or rating; live stat tiles across the top.
- **Import / export**: JSON (full backup / snapshot) and CSV (migrate an existing
  spreadsheet in, or export back out). CSV import maps common column names automatically.

**Important — data storage:** everything is saved in the browser via `localStorage`.
It is **not shared** between people or devices, and clearing the browser wipes it.
Treat Export as the backup/sharing mechanism. For a real shared, multi-user CRM with
proper login and resume file uploads, the next step is a backend (e.g. Supabase); the
record shape in `recruitment.js` is designed to migrate cleanly.

**Sending real emails:** this is the one part of the site that isn't purely static.
`api/send-email.js` is a small Vercel serverless function that sends via Gmail SMTP
(using `nodemailer` — see `package.json`). It reads the Gmail address and an
[app password](https://myaccount.google.com/apppasswords) from environment variables,
never from source:

- In Vercel: Project Settings → Environment Variables → add `GMAIL_USER` and
  `GMAIL_APP_PASSWORD`, then redeploy.
- Locally: copy `.env.example` to `.env.local` and fill it in (gitignored) if testing
  with `vercel dev` — the Vercel CLI needs Node/npm installed, which the rest of this
  site doesn't.

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
- **Committee Portal auth** (`portal.html`) is front-end only (`test` / `test`, visible in page source) — it provides NO real security. Move to a backend/auth provider before the portal or CRM holds anything sensitive.
- **CRM data is browser-local** (`localStorage`), not shared across the committee. Back up via Export; plan a backend for shared use.
- **Instagram profile embed** on `events.html` uses `instagram.com/<handle>/embed`, which Instagram blocks for full profiles (single posts only), so the styled fallback panel is what visitors will usually see. For a live grid, generate a free widget (behold.so / snapwidget) and paste its `<iframe>` in place.
- **`join.html`** still exists but is unlinked from nav; keep or delete it depending on whether UMSU fully covers signup. (It still carries a visible "prototype" note.)
- **Social links** in the homepage footer point at the real Instagram and LinkedIn company pages.

## Verified

- All pages served correctly via local HTTP server (200 OK), including CSS/JS and image assets.
- Not yet checked in an actual browser here (no browser automation in this environment) — recommend opening `index.html` locally and clicking through, especially the mobile layout at 375px width and the hover/motion effects.
