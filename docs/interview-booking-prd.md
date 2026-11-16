# Interview Booking — Product Spec

**Committee Portal · StartUp Link UniMelb**

A built-in interview scheduler for the recruitment portal. Candidates pick their own interview time from a private link in the invite email, the booking lands on their applicant profile and in everyone's calendar, and the committee never touches zcal again.

| | |
|---|---|
| **Status** | Built on branch `booking-system`: Phases 1–2 (all P0s). Needs `supabase/migrations/2026-11-16-interview-booking.sql` run once. P1s not started. |
| **Builds on** | [Recruitment Dashboard spec](./recruitment-dashboard-prd.md), §5.4 Booking links and §5.5 Send invite |
| **Storage** | Same Supabase project, free tier (new `interview_slots` table + 2 columns on `applications`) |
| **Email** | Existing club Gmail sender (`lib/mailer.ts`), calendar invites as `.ics` attachments |
| **Owner** | People & Culture / Exec |
| **Last updated** | 16 Nov 2026 |

---

## 1. Problem statement

Inviting a candidate to interview takes four manual steps across two tools: create a zcal link, paste it into the applicant's profile, save, then send the invite from the portal. When the candidate books, zcal knows but the portal doesn't — someone has to move the card to *Interview booked* and type in the time by hand, so the board drifts out of date during the busiest week of the round. With 50–100 applicants a round, that's hundreds of copy-paste steps, and every missed one is a candidate stuck in *Invited* or an interviewer who doesn't know who's coming.

## 2. Goals

1. **One click to invite.** Sending an interview invite needs no external link. Target: 0 zcal links created in the next round.
2. **The board is always right.** Every self-booked interview appears on the applicant's card and moves them to *Interview booked* automatically. Target: 100% of bookings, 0 manual stage moves for booking.
3. **No double-bookings, no lost interviews.** Target: 0 slot conflicts; every booking produces a calendar invite for the candidate and each interviewer.
4. **Candidates book fast.** Target: ≥ 70% of invited candidates book within 48 hours of the invite, without emailing the committee.
5. **Stay free.** Runs on the current Supabase free tier, Vercel Hobby and Gmail, with no new paid services.

## 3. Non-goals

| Not doing (v1) | Why |
|---|---|
| **Reading interviewers' personal calendars** (busy/free sync like zcal) | Needs Google OAuth per interviewer and a Google Cloud app — weeks of work for a problem solved by the committee publishing the times they're free. |
| **Generating unique Zoom/Meet links** | Interviews are in person (per the current invite email). A fixed location or a fixed meeting link per slot covers online exceptions. |
| **SMS reminders** | Paid service; email is enough for a student club. |
| **Group / panel interviews with multiple candidates per slot** | Capacity is always 1 in v1. The schema keeps room to add it (§5.3). |
| **Booking for anything other than recruitment interviews** (events, coffee chats) | Separate need; revisit once this is proven. |

## 4. User stories

### Candidate (applicant invited to interview)
- As a candidate, I want to pick an interview time from a link in my email so that I don't have to email back and forth.
- As a candidate, I want the interview added to my calendar in one click so that I don't forget it.
- As a candidate, I want to change or cancel my time from the same link so that a clash doesn't mean emailing the committee.
- As a candidate, if no time suits me, I want to be told how to ask for another so that I'm not stuck.
- As a candidate who opens an old or invalid link, I want a clear message, not a broken page.

### Committee member (reviewer / interviewer)
- As a committee member, I want to add a whole afternoon of 30-minute slots in one go so that setting up interview week takes minutes.
- As an interviewer, I want each booking to arrive as a calendar invite so that my calendar is the schedule.
- As a committee member, I want to see the interview time on the applicant's card and profile so that I know where everyone is.
- As a committee member, I want an Interviews view listing every slot, who's booked, and who interviews so that I can run the day.
- As a committee member, I want to book, move or cancel a candidate's slot myself so that I can handle phone/email requests.
- As a committee member, I want to know when a candidate cancels so that I can follow up or re-invite.

## 5. Requirements

### 5.1 Must-have (P0)

**P0-1 · Interview slots**
The committee creates, lists and deletes slots in a new **Interviews** tab in the portal (beside Board, Insights, Health).
- A slot has: start time, end time, location (free text, e.g. "Arts West 353" or a meeting URL), interviewers (committee members, from `committee_members`), and an optional team (blank = any team).
- **Bulk create:** date + start time + end time + slot length + break between → generates every slot in that window (e.g. 10:00–13:00, 30 min → 6 slots).
- All times are shown and entered in **Melbourne time** (`Australia/Melbourne`), stored as UTC.
- Acceptance:
  - [ ] Given a 10:00–12:00 window with 30-minute slots, when the committee member saves, then 4 slots appear in the Interviews tab.
  - [ ] A booked slot can't be deleted until its booking is cancelled or moved (the UI explains why).
  - [ ] Past slots are hidden by default and greyed when shown.

**P0-2 · Private booking link per applicant**
Every application gets an unguessable booking token (≥ 128 bits of randomness), created automatically, including for existing applications.
- The invite email's `{link}` placeholder becomes `https://<site>/book/<token>` for anyone without a custom link.
- The zcal field is removed from the profile and the "paste the zcal link first" checks are removed from Send invite, bulk send and the card quick-send.
- Acceptance:
  - [ ] Given an applicant in *Under review*, when a reviewer clicks Send invite, then the email draft already contains their booking link, with no extra steps.
  - [ ] Bulk invite works for any number of applicants without pasting links.
  - [ ] Guessing or altering a token shows "This link isn't valid", never another applicant's data.

**P0-3 · Public booking page `/book/[token]`**
- Shows: club branding, the candidate's first name and team, interview length, and the open slots grouped by day (only future slots, only unbooked slots, and only slots for their first-choice team or "any team").
- The candidate picks a slot and confirms. They see a confirmation screen with the time, location, and an "Add to calendar" download.
- Shows **only** the candidate's own first name and team. Never other candidates, interviewer emails, or notes.
- Not indexed by search engines.
- Acceptance:
  - [ ] Given no open slots, the page says so and tells them to reply to the invite email.
  - [ ] Given the applicant is no longer *Invited* or *Booked* (e.g. rejected), the page says booking is closed, with no slot list.
  - [ ] The page works on a phone at 375 px width.

**P0-4 · Safe booking (no double-booking)**
Booking happens through one database function that checks the token, the applicant's stage and the slot in a single transaction, enforced by a database uniqueness rule on the booked slot.
- Slots can't be booked less than **12 hours** before they start (configurable, see Open Questions).
- Acceptance:
  - [ ] Given two candidates confirm the same slot at the same moment, then exactly one succeeds and the other is told it was just taken and shown the remaining slots.
  - [ ] Booking a slot in the past, or within the cutoff, is refused.

**P0-5 · Board updates automatically**
On booking: the applicant moves to *Interview booked*, `interview_at` is set, and an activity-log entry is added ("Booked interview: Tue 24 Nov, 10:30 · Arts West 353").
- The card and profile show the interview time and location.
- Acceptance:
  - [ ] Given a candidate books while a reviewer has the board open, then the card moves on the next refresh (live update if the board already subscribes to changes).

**P0-6 · Confirmation emails with calendar invites**
On booking, the server emails:
- **The candidate:** a confirmation (new editable template, "Interview booked") with time, location, and their link to reschedule, plus a calendar invite.
- **Each interviewer on the slot:** a short notice with candidate name, team and a portal link, plus a calendar invite.
- Calendar invites are standard `.ics` (`METHOD:REQUEST`) so Gmail, Outlook and Apple Calendar show "Add/Yes" buttons. No Google API.
- Acceptance:
  - [ ] Given a booking, then the candidate and each interviewer receive one email each within a minute.
  - [ ] Opening the invite in Gmail adds the event at the correct Melbourne time.
  - [ ] If email fails, the booking still stands and the failure is noted in the applicant's activity log.

**P0-7 · Reschedule and cancel (candidate)**
The same link lets a booked candidate pick a different slot or cancel, until the cutoff.
- Rescheduling frees the old slot and sends an updated invite. The old event is cancelled with `METHOD:CANCEL` and the same calendar UID, so it disappears from calendars rather than duplicating.
- Cancelling returns the applicant to *Interview invited*, logs it, and emails the interviewers.

**P0-8 · Committee controls**
From the applicant profile, a committee member can: see the booking, copy the booking link, book a slot on the candidate's behalf, move them, or cancel. The same emails go out (with an option to not email the candidate).

### 5.2 Nice-to-have (P1)

- **P1-1 · Reminder email** the day before each interview, to the candidate and interviewers. Runs from the daily Vercel scheduled task (Hobby plan allows one run per day; send at ~9am for the next day's interviews). Needs a server-only way to read tomorrow's bookings; see Open Question 4.
- **P1-2 · Interview-day view:** the Interviews tab has a "Today" mode with a running order, a one-tap "Interviewed" button that moves the card, and a no-show button.
- **P1-3 · Slot fill alerts:** a banner in the Interviews tab when fewer open slots remain than invited-but-unbooked candidates.
- **P1-4 · Board badges:** "Not booked 3d" on invited cards that haven't picked a time, with a one-click resend.
- **P1-5 · Custom-link override:** keep an optional "External link" on the profile for one-off exceptions. It's used instead of the booking page when filled.

### 5.3 Future considerations (P2)

Design for these now so they don't need a rewrite later:
- **Capacity > 1** (group interviews): keep bookings in their own relation, or a nullable capacity column, rather than assuming 1:1 forever.
- **Interviewer busy-time sync** via Google Calendar API: keep interviewers as committee-member references, not free text.
- **Multiple rounds:** a `round` label on slots and applications, so next semester's slots don't mix with this one's.
- **Waitlist for a full day:** "notify me if a slot opens".

## 6. Technical approach (summary)

| Piece | Approach |
|---|---|
| **Data** | New `interview_slots` table (`starts_at`, `ends_at`, `location`, `interviewer_emails[]`, `team`, `created_by`). On `applications`: `booking_token` (unique, random default, filled for existing rows) and `interview_slot_id` (unique, `on delete restrict`). Existing `interview_at` is kept in sync. Migration in `supabase/migrations/`. The unused zcal-era `booking_slots` table and `booking` column are kept read-only for one round, then dropped. |
| **Access** | Committee manages slots under the existing `is_committee()` Row Level Security rules. Candidates never get table access: three narrow `security definer` functions take a token — `booking_info(token)`, `book_interview(token, slot_id)` and `cancel_interview(token)` — the same pattern as `claim_application_confirmation()`. |
| **Server** | `app/api/book/route.ts` calls the database function, then sends emails via `sendClubMail` with an `.ics` attachment (`lib/ics.ts`). The candidate's address always comes from the database, never the request. |
| **Page** | `app/book/[token]/page.tsx`, public styling, `noindex`. |
| **Portal** | New **Interviews** view in `components/portal/`. Profile "Zcal link" block replaced by an "Interview" block. `{link}` filled with the booking URL in `send-modal` / `bulk-send-modal`. New "Interview booked" template in Settings. |
| **Cost** | Free tier: a round adds a few hundred rows (< 1 MB), a few hundred function calls, and ~2–4 emails per booking (well under Gmail's daily cap). |

## 7. Success metrics

| Type | Metric | Target | How measured |
|---|---|---|---|
| Leading | Invited candidates who self-book within 48h | ≥ 70% (stretch 85%) | Activity log: "Invite emailed" → "Booked interview" timestamps |
| Leading | Bookings needing a manual stage move or time entry | 0 | Activity log authors on *Interview booked* moves |
| Leading | Double-bookings / booking errors | 0 | Database function errors, committee reports |
| Leading | Candidates who reschedule themselves instead of emailing | ≥ 80% of reschedules | Log entries vs. reply emails |
| Lagging | Committee time spent scheduling per round | < 1 hour (from ~ a day of link wrangling) | Post-round retro with P&C |
| Lagging | Interview no-shows | ≤ 5% | Interview-day view (P1-2) or notes |

Evaluate after the first full round that uses it.

## 8. Open questions

| # | Question | Who | Blocking? |
|---|---|---|---|
| 1 | **Booking cutoff:** is 12 hours before the slot right, or should same-day booking be allowed? | P&C | No (default 12h) |
| 2 | **Team filtering:** should candidates only see slots for their first-choice team, or all slots? | P&C | Yes, for slot setup |
| 3 | **Which calendar:** should interviewers get invites on personal emails, or should everything also go on one shared club calendar (e.g. `info@`)? | Exec | No |
| 4 | **Reminders (P1-1):** OK to add the Supabase service key as a Vercel secret so the daily task can read tomorrow's bookings? The alternative is a secret-protected database function. | Engineering | No (P1 only) |
| 5 | **In person vs online:** are all interviews in person? This decides whether location is free text or "room / online link". | P&C | No |
| 6 | **Cancelled candidates:** after cancelling, should they stay *Invited* (can rebook), or move back to *Under review*? | P&C | No (default: *Invited*) |
| 7 | **Next round date:** when is the next recruitment round? This sets the ship deadline. | Exec | Yes, for timeline |

## 9. Timeline and phasing

No hard deadline yet. It needs to ship and be tested end to end at least **one week before the next round's invites go out** (Open Question 7). Don't change the demo build, and do this on `booking-system`.

| Phase | Scope | Estimate |
|---|---|---|
| **1 — Core booking** | P0-1 → P0-5: slots, tokens, booking page, safe booking, board auto-update | ~1.5 days |
| **2 — Calendar + changes** | P0-6 → P0-8: emails with `.ics`, reschedule/cancel, committee controls; remove zcal UI | ~1 day |
| **3 — Polish** | P1-1 → P1-4: reminders, interview-day view, fill alerts, unbooked badges | ~1 day |
| **Test round** | Dry run with 3–5 committee members acting as candidates on production | ½ day |

**Dependencies:** a database migration run in the Supabase SQL editor (as for previous migrations), and Gmail credentials already in Vercel. Nothing new to sign up for.
