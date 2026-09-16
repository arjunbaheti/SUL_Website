# StartUp Link UniMelb — website prototype

Status: **coded prototype**, not the recommended final build. See "Why this isn't the final platform" below before treating this as done.

## What this is

A dependency-free static site (plain HTML/CSS/JS, no build step, no Node/npm required) implementing the P0 flows from the PRD so the club can click through the real UX before committing to a platform:

- `index.html` — homepage (P0.1)
- `events.html` — Instagram section (`@startuplinkunimelb`); events/deadlines are posted there
- `join.html` — membership signup (P0.3), no longer linked in nav ("Join now" goes to UMSU)
- `partners.html` — tiered past partners (P0.4)
- `committee.html` — exec roster by two-year term (P1.2)

## Running it

No install needed. Either:

- Open `index.html` directly in a browser, or
- From this folder, run `python3 -m http.server 8000` and visit `http://localhost:8000`

## Editing content (until a real CMS is chosen)

Partners and committee data live in `content/*.js` as plain JS arrays (not `.json`, so the browser can load them via a `<script>` tag with no server-side fetch/CORS issues when opened as a local file). Each file has a comment explaining its fields. To edit:

1. Open the relevant file in `content/`
2. Copy an existing entry, change the values, give it a unique `id`
3. Save and refresh the page

This is editable by a non-technical person in the sense that it's copy-paste-and-fill-in-blanks, but it still requires opening a code editor and respecting JS syntax (commas, quotes). It does **not** satisfy P0.5 ("no code, no deploy step they must understand") on its own — see below.

## Why this isn't the final platform

The PRD's own recommendation is to build on a no-code platform (Framer, Webflow, or a structured Notion/Super site), not custom code — because the exec turns over every year and P0.5 requires zero-developer-involvement editing. This prototype exists to:

1. Let the club validate the actual flows (signup, partner tiers, Instagram feed) before picking a platform.
2. Serve as a content/IA reference for whoever builds the real version in Framer/Webflow/etc.
3. Be a working fallback if the no-code route stalls and a static site + a git-based CMS (e.g. Decap CMS) ends up being the pragmatic choice for a zero-budget club.

Before this goes live as the actual site, the PRD's blocking open questions still need answers:

- Standalone vs. chapter page under StartUp Link Australia
- Where membership data should really live (this prototype just opens a pre-filled email — see `join.html`)
- Domain control for `startuplinkunimelb.net`
- Platform budget and account ownership across handovers
- Whether any partner agreement requires click-tracking reporting (P1.4 → P0 if so)

## Known gaps vs. the PRD

- **P0.3 (signup)**: submits via a `mailto:` link, not a real datastore. Functional today, but not what should ship.
- **P1.3 (automated reminders)**, **P1.4 (partner click tracking)**: not implemented — need a backend/analytics, out of scope for a static site.
- **Partner/committee photos**: no real images yet — cards fall back to initials badges. When real logos/photos are supplied, add `<img>` tags with real `alt` text (accessibility floor in the PRD).
- **Brand**: colours in `assets/css/style.css` (`:root` variables) are placeholders (white / dark-blue / black theme). Swap the accent tokens once the club's logo/colour assets are supplied.
- **Homepage stats are placeholders**: the count-up numbers (300+ members, 25+ partners, 40+ events, 8 branches) in `index.html` are made up — replace with real figures before launch or they're misleading.
- **"Join now" goes to UMSU**: all Join buttons point to the club's UMSU join page (https://umsu.unimelb.edu.au/buddy-up/clubs/clubs-listing/join/8055/), so UMSU is the membership datastore. The old on-site signup form still exists at `join.html` but is no longer linked in the nav — keep it or delete it.
- **Dynamic features**: custom white-dot cursor, scroll-progress bar, mask-reveal hero headline, scroll-velocity kinetic type ribbons, an interactive index list, cursor spotlights, magnetic buttons, count-up stats, live Melbourne clock, film-grain/grid texture, and the scrolling partner marquee. All are disabled automatically for visitors with "reduce motion" set, and the cursor only activates on fine-pointer (non-touch) devices.

## Verified

- All 5 pages served correctly via local HTTP server (200 OK), including all CSS/JS assets.
- Not yet checked in an actual browser (no browser automation tool available in this environment) — recommend opening `index.html` locally and clicking through before sharing further, especially the RSVP/add-to-calendar/signup interactions and the mobile layout at 375px width.
