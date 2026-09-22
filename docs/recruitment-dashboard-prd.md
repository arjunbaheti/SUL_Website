# Recruitment Dashboard — Product Spec

**Committee Portal · StartUp Link UniMelb**

A kanban-style hiring pipeline and CRM for the committee, replacing spreadsheet-based applicant tracking from first application through to offer or rejection.

| | |
|---|---|
| **Status** | Live — v1.0 |
| **Storage** | Browser-local (no shared backend) |
| **Auth** | Placeholder, not secure |
| **Owner** | Committee / Exec |
| **Last updated** | 23 Sep 2026 |

## Contents

1. [Overview](#1-overview)
2. [Problem & goals](#2-problem--goals)
3. [Users & access](#3-users--access)
4. [Pipeline & data model](#4-pipeline--data-model)
5. [Feature spec](#5-feature-spec)
6. [Email sending](#6-email-sending)
7. [Non-functional requirements](#7-non-functional-requirements)
8. [Known limitations](#8-known-limitations)
9. [Roadmap](#9-roadmap)
10. [Appendix](#10-appendix)

---

## 1. Overview

The Recruitment Dashboard is the applicant-tracking half of the Committee Portal (`portal.html`), sitting behind a login gate alongside the rest of the club's internal tooling. It gives directors a single board to see every applicant, who owns them, what stage they're at, and what's been said in interview — replacing the spreadsheet that was previously the source of truth.

It ships as part of the same dependency-free static site as the public pages, with one exception: sending email requires a small serverless function, covered in [Section 6](#6-email-sending).

## 2. Problem & goals

### 2.1 Problem

Recruitment ran on spreadsheets. As application volume grew, three specific pain points motivated this build:

- **No individual tracking** — a row in a sheet doesn't hold interview notes, a resume link, and a live status in a way that's fast to scan per applicant.
- **No status visibility** — nothing showed, at a glance, where every applicant currently sat in the process, or who was meant to be acting on them next.
- **Manual, repetitive admin** — interview invites, offers, and rejections were composed and sent by hand each time, with no record that it had actually happened.

### 2.2 Goals

- One board, one source of truth, for every applicant from **Applied** to **Offer/Rejected**.
- Make status and ownership visible at a glance — by stage, by assigned director, by rating.
- Cut the manual work out of interview invites, offers, and rejections without leaving the board.
- Keep committee interview notes attached to the applicant permanently, separate from the system's own activity trail.
- Be usable with zero training — a director should be able to pick this up without a walkthrough.

### 2.3 Non-goals

- Not a general club membership CRM — scope is limited to the recruitment/hiring pipeline.
- Not a replacement for UMSU's membership system.
- Not (yet) a public-facing application form — see [Section 8](#8-known-limitations) and [Section 9](#9-roadmap).
- Not building payment, alumni, or sponsor tracking into this surface.

## 3. Users & access

Every signed-in committee member currently sees and can edit the entire board. The **Assigned to** field is a routing and filtering label, not an access boundary — anyone can still open and edit any applicant regardless of who they're assigned to. That distinction matters for [Section 9](#9-roadmap).

| Assignable role | id | Notes |
|---|---|---|
| Marketing Director (1) / (2) | `md1` / `md2` | Two directors share this title; listed separately so each owns their own queue. |
| External Relations Director | `erd` | — |
| Internal Projects Director | `ipd` | — |
| Projects Director (1) / (2) | `pd1` / `pd2` | Two directors share this title. |
| People & Culture Director | `pcd` | — |
| Events Director | `ed` | — |
| President / Secretary / Treasurer | `pres` / `sec` / `treas` | Included for the rare case, not typically assigned day-to-day applications. |

The role list is fixed rather than name-based, since names change every committee handover — see `ASSIGNEES` near the top of `assets/js/recruitment.js` to edit it.

## 4. Pipeline & data model

### 4.1 Stages

| Stage | id | Entry criteria |
|---|---|---|
| 🔘 Applied | `applied` | Default stage for every new record. |
| 🟡 Under review | `review` | Committee is assessing the application. Gets the **Send invite** quick action. |
| 🟣 Interview invited | `invited` | Set automatically once an invite email sends. |
| 🔵 Interview booked | `booked` | Applicant has picked a time via the booking link. |
| 🔷 Interviewed | `interviewed` | Interview has happened; rating and notes recorded. |
| 🟢 Offer | `offer` | Gets the **Send offer** quick action. |
| 🔴 Rejected | `rejected` | Gets the **Send rejection** quick action. |

Stage changes happen by dragging a card between columns, or from the stage dropdown in an applicant's profile. Every move is logged automatically to that applicant's activity feed ([4.3](#43-storage), [5.3](#53-applicant-profile-shipped)).

### 4.2 Applicant record

| Field | Type | Notes |
|---|---|---|
| `id` | string | Generated client-side, timestamp + random suffix. |
| `name`, `email`, `phone` | string | `email` is required for the Send actions to be usable. |
| `role` | string | Free text — role applied for. Drives the role filter. |
| `assignee` | enum id \| "" | One of the fixed roles in Section 3, or unassigned. |
| `resume` | url | Link only — no file upload yet (Section 8). |
| `booking`, `bookingSlotId` | url, id | Resolved interview link; see 5.4. |
| `interviewAt` | ISO datetime | Manually set or autofilled from a booking slot. |
| `status` | enum | One of the seven stage ids above. |
| `rating` | `yes` \| `maybe` \| `no` \| "" | Set from the applicant's profile after interview. |
| `notes` | array | `{ts, text, type: "manual" | "auto"}` — see 5.3. |
| `createdAt`, `updatedAt` | ISO datetime | Set on creation / every save. |

### 4.3 Storage

> ⚠️ **Everything lives in `localStorage`, in the browser that entered it.** There is no shared backend — a director's applicants are not visible on another director's laptop unless data is manually exported and imported.
>
> Storage key: `sul-recruitment-v1`. Shape: `{ applicants: [...], settings: { bookingSlots: [...] } }`. Export (JSON/CSV) is the only current way to back up or hand off a snapshot.

## 5. Feature spec

### 5.1 Board — Shipped

Seven columns, one per stage, each showing a live count. Cards are draggable between columns. Stat tiles across the top show Total, In pipeline, Interviewed, Offers, and Rejected. A toolbar filters by name/email/role search, role, assignee, and rating simultaneously.

### 5.2 Intake — deliberately not manual — Shipped

There is no "add applicant" form. This is intentional: the intended source of truth is applicants arriving automatically once a public application form is connected (not yet built — Section 9). Until then, data enters the board two ways:

- **Import from CSV** — migrates an existing spreadsheet in. Common column names (`name`, `full name`, `role`, `position`, `assigned to`, etc.) are matched automatically.
- **Load sample data** — seven placeholder applicants, for demoing or testing the board.

### 5.3 Applicant profile — Shipped

Clicking a card opens a full editor: contact details, assignee, resume link, interview slot, interview time, stage, rating, and two distinct note surfaces:

- **Interview notes** — typed manually by committee members, newest first. This is where interview impressions live.
- **Activity** — a read-only, auto-generated log (stage changes, "Invite emailed", etc.), separated below notes so manual commentary is never buried under system noise.

### 5.4 Booking links — Shipped

Recruitment often uses different interview links for different days (zcal). **Manage booking links** (⋯ menu) stores a list of `{label, day, start, end, url}` slots. On an applicant's profile, picking a slot:

- fills the booking link automatically, and
- suggests the next matching interview date/time (next occurrence of that weekday at that start time), if no time is already set.

A "Custom link" option remains for one-off exceptions. If only one slot exists at all, it's used as the fallback even when nothing's explicitly chosen.

### 5.5 Send invite / offer / rejection — Shipped

Cards in **Under review**, **Offer**, and **Rejected** carry a matching quick-action button. It opens a compose window — locked *To*, editable subject and body, pre-filled from a template — with **Send email** and a no-network **Copy instead** fallback. On send:

- the message is emailed from `info@startuplinkunimelb.net` (Section 6);
- it's logged to the applicant's activity feed ("Invite emailed" / "Offer emailed" / "Rejection emailed");
- sending an invite additionally moves the applicant from Under review to Interview invited.

### 5.6 Import / export — Shipped

**JSON** export/import is a full, faithful backup and restore of the board. **CSV** export/import round-trips the same fields (assignee exported and re-matched by its label, not its internal id) for spreadsheet-native workflows.

## 6. Email sending

The one part of the product that isn't purely static. Sending mail from a browser isn't possible directly (no raw SMTP over HTTP), so a single serverless function bridges the gap.

| | |
|---|---|
| **Client** | `assets/js/recruitment.js` |
| **Server** | `api/send-email.js` |
| **Transport** | Gmail SMTP via nodemailer |
| **Hosting** | Vercel serverless function |

### 6.1 API contract

`POST /api/send-email`

```
// Request
{ "to": "applicant@example.com", "subject": "…", "text": "…" }

// Success — 200
{ "ok": true }

// Failure — 400 / 405 / 500
{ "ok": false, "error": "human-readable reason" }
```

Missing-credential errors name the exact environment variable that's unset, rather than a generic failure, so a misconfigured deploy is fast to diagnose.

### 6.2 Credentials

The Gmail account and app password are read from `process.env.GMAIL_USER` / `process.env.GMAIL_APP_PASSWORD` — set in Vercel's dashboard, never committed to source. `.env.local` (for local `vercel dev` testing only) is gitignored.

### 6.3 Deliverability

| Check | Status | Detail |
|---|---|---|
| SPF | ✅ Pass | `v=spf1 include:_spf.google.com ~all` |
| DKIM | ✅ Pass | `google._domainkey` published and signing. |
| DMARC | ❌ Missing | No record at `_dmarc.startuplinkunimelb.net` — flagged in Section 8. |

## 7. Non-functional requirements

- **Browsers** — any evergreen desktop browser. Drag-and-drop uses the HTML5 pointer-based API; no touch or keyboard equivalent exists yet.
- **Performance** — the whole board re-renders client-side on every change; fine at current applicant volumes, will need pagination or virtualization if a term's applicant count grows an order of magnitude.
- **Accessibility** — modals close on Escape, the login error is an `aria-live` region; drag-and-drop stage changes have no keyboard-accessible alternative (the profile's stage dropdown is the workaround today).
- **Privacy** — applicant PII (name, email, phone, resume link, interview notes) sits unencrypted in browser `localStorage`. No retention or deletion policy is defined beyond manual "Clear all data".

## 8. Known limitations

- **No shared backend.** Data doesn't sync across people or devices — see [4.3](#43-storage).
- **Auth is a placeholder.** `portal.html` checks a hardcoded username/password in client-side JavaScript, visible in page source. It keeps out casual visitors, not a determined one.
- **No per-role permissions.** Assignee is a label, not an access boundary — see Section 3.
- **No public intake form.** Applicants still enter via CSV import, not automatically.
- **No resume upload.** Just a link field.
- **DMARC record missing** for the sending domain — see [6.3](#63-deliverability).
- **No workload or SLA visibility.** Nothing flags an applicant who's been sitting untouched for a week.

## 9. Roadmap

Ordered roughly by how directly each item removes a limitation from Section 8.

1. **Backend migration (Supabase suggested)** — shared, multi-user data; real per-person login; the applicant record shape in `recruitment.js` was designed to migrate onto this without a rewrite.
2. **Public application intake form** — wired directly into the same store, writing straight into the Applied column — removes the CSV bridge as the normal path, not just the fallback.
3. **Per-role permissions** — once real login exists: a director sees their own queue by default; President/Secretary/Treasurer see everything.
4. **Resume file upload** — replaces the link-only field once there's a backend to store files against.
5. **DMARC record + transactional email provider** — add the missing DMARC record now (Section 6.3); consider migrating off personal Gmail SMTP to a dedicated sender (e.g. Resend/Postmark) if volume grows.
6. **Stale-applicant flag** — surface anyone with no activity in N days directly on the board, so nobody quietly falls through.

## 10. Appendix

### 10.1 File map

| File | Purpose |
|---|---|
| `portal.html` | Login gate + mount point for the CRM. |
| `assets/js/recruitment.js` | All board logic, rendering, and state. |
| `assets/css/portal.css` | Styles, scoped under `.crm-*`. |
| `api/send-email.js` | Serverless function — Gmail SMTP send. |
| `package.json` | Declares `nodemailer` for the function above. |

### 10.2 Default email copy

Editable per-send in the compose window; these are the starting templates.

**Invite**
```
Subject: Interview invite — StartUp Link UniMelb

Hi {first name},

Thanks for applying to StartUp Link UniMelb — we'd love to meet you.
Please book an interview time that suits you here:
{resolved booking link}

Looking forward to chatting,
StartUp Link UniMelb
```

**Offer**
```
Subject: Offer — StartUp Link UniMelb Committee

Hi {first name},

Congratulations! We'd love to offer you a position on the StartUp Link
UniMelb committee{ as role, if set}. We were really impressed with you
throughout the process and think you'll be a great addition to the team.

We'll be in touch shortly with next steps. Welcome aboard!

StartUp Link UniMelb
```

**Rejection**
```
Subject: Your application — StartUp Link UniMelb

Hi {first name},

Thank you for taking the time to apply{ for role, if set} and for
chatting with us during the interview process. After a lot of
consideration, we won't be moving forward with your application on
this occasion.

This was a genuinely competitive round and we'd encourage you to apply
again in future. Thanks again for your interest in StartUp Link
UniMelb, and we wish you all the best.

StartUp Link UniMelb
```

---

*Recruitment Dashboard · Product Spec v1.0 · StartUp Link UniMelb Committee Portal*
