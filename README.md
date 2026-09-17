# StartUp Link UniMelb — website

A dependency-free static site (plain HTML/CSS/JS, no build step, no Node/npm required) for the University of Melbourne chapter of StartUp Link Australia. Recruitment-first: the job is connecting students to the startup ecosystem.

## Pages

- `index.html` — homepage: hero, moving blue background, and a "Past Partners" logo strip
- `about.html` — what the club does (bridge to opportunities, entrepreneurial skills, the Melbourne network) plus headline stats
- `events.html` — full-page Instagram embed (`@startuplinkunimelb`); events and deadlines are posted there
- `partners.html` — "Partner with us": a prospective-partner pitch (hire entrepreneurial talent, meet members, build a pipeline) with a "Get in touch" CTA
- `committee.html` — the committee: group-photo banner, roster by two-year term, and a Committee Portal button
- `join.html` — legacy membership signup form; no longer linked in nav ("Join now" goes to UMSU)

## Running it

No install needed. Either:

- Open `index.html` directly in a browser, or
- From this folder, run `python3 -m http.server 8000` and visit `http://localhost:8000`

## Editing content

- **Past partner logos** live in `content/partners.js` (name, `logo` path, `url`, and optional `mono: true` for solid-black wordmarks so they stay white on the dark background). Logo files sit in `assets/img/` and should be trimmed, transparent-background PNGs/SVGs.
- **Committee** data lives in `content/committee.js` as plain JS arrays. Copy an existing entry, change the values, give it a unique `id`, save, refresh.

These files load via `<script>` tags (not `.json`) so the site works even when opened as a local file. Editing is copy-paste-and-fill-in-blanks but still requires respecting JS syntax (commas, quotes).

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

- **E-LEAD partner URL** is a placeholder (`#`) in `content/partners.js` — add the real link. (Archa → archa.com.au and Zeller → myzeller.com were best-guess URLs; double-check.)
- **Stats** on `about.html` and `partners.html` (700+ members in 2025, 45+ committee, 10+ events a year, 4 branches) — confirm the figures.
- **Committee Portal** button on `committee.html` links to `#` — point it at the real portal.
- **Instagram link** in the homepage footer is `#` — add the real profile URL.
- **`join.html`** still exists but is unlinked; keep or delete it depending on whether UMSU fully covers signup.

## Verified

- All pages served correctly via local HTTP server (200 OK), including CSS/JS and image assets.
- Not yet checked in an actual browser here (no browser automation in this environment) — recommend opening `index.html` locally and clicking through, especially the mobile layout at 375px width and the hover/motion effects.
