// Shared types, constants and helpers for the committee portal (recruitment board).
import { SITE_ORIGIN, bookingUrl } from "./booking";

export type StageId = "applied" | "review" | "invited" | "booked" | "interviewed" | "waitlist" | "offer" | "rejected";
export type RatingId = "" | "yes" | "maybe" | "no";

export const STAGES: { id: StageId; label: string; color: string }[] = [
  { id: "applied", label: "Applied", color: "#6b7a99" },
  { id: "review", label: "Under review", color: "#d9a441" },
  { id: "invited", label: "Interview invited", color: "#9b7bd4" },
  { id: "booked", label: "Interview booked", color: "#3fb6c9" },
  { id: "interviewed", label: "Interviewed", color: "#5b8def" },
  { id: "waitlist", label: "Waitlist", color: "#e08a3c" },
  { id: "offer", label: "Offer", color: "#43c47a" },
  { id: "rejected", label: "Rejected", color: "#e0607a" },
];
export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s])) as Record<StageId, (typeof STAGES)[number]>;

export const RATINGS: { id: Exclude<RatingId, "">; label: string }[] = [
  { id: "yes", label: "Yes" },
  { id: "maybe", label: "Maybe" },
  { id: "no", label: "No" },
];

export type AppFile = { path: string; name?: string; size?: number; mime?: string; kind?: "resume" | "other" };
export type Note = { id?: string; ts: string; text: string; type: "auto" | "manual" | "interview"; author: string };
/** One reviewer's screening vote (before interviews). One per reviewer per applicant. */
export type Vote = { reviewer: string; vote: Exclude<RatingId, "">; updatedAt: string };
/** A reviewer who knows this applicant personally. Stored as a "conflict" row in application_votes,
 *  so it replaces that reviewer's vote and never counts towards the tally. */
export type Conflict = { reviewer: string; updatedAt: string };

export type Applicant = {
  id: string;
  name: string; email: string; phone: string; degree: string; yearLevel: string;
  role: string; roleSecondary: string;
  statement: string; experience: string; linkedin: string; questions: string; extraNote: string;
  files: AppFile[];
  booking: string; // legacy: a zcal link pasted in before built-in booking existed
  bookingToken: string; // private token behind their /book/<token> link
  interviewSlotId: string; // the interview slot they've booked, or ""
  interviewAt: string; // when that interview starts (ISO), or ""
  status: StageId; rating: RatingId;
  secondChoiceFlag: boolean; // flagged as worth considering for their second-choice team
  notes: Note[];
  votes: Vote[];
  conflicts: Conflict[];
  createdAt: string; updatedAt: string;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export function noteFromRow(n: any): Note {
  return { id: n.id, ts: n.created_at, text: n.text, type: n.type === "auto" ? "auto" : n.type === "interview" ? "interview" : "manual", author: n.author_email || "" };
}

export function applicantFromRow(r: any): Applicant {
  return {
    id: r.id,
    name: r.name || "", email: r.email || "", phone: r.phone || "", degree: r.degree || "",
    yearLevel: r.year_level || "", role: r.role || "", roleSecondary: r.role_secondary || "",
    statement: r.statement || "", experience: r.experience || "", linkedin: r.linkedin || "",
    questions: r.questions || "", extraNote: r.extra_note || "",
    files: Array.isArray(r.files) ? r.files : [],
    booking: r.booking || "",
    bookingToken: r.booking_token || "",
    interviewSlotId: r.interview_slot_id || "",
    interviewAt: r.interview_at || "",
    status: STAGE_BY_ID[r.status as StageId] ? r.status : "applied",
    rating: r.rating || "",
    secondChoiceFlag: r.second_choice_flag === true,
    notes: (r.application_notes || []).map(noteFromRow).sort((x: Note, y: Note) => y.ts.localeCompare(x.ts)),
    votes: (r.application_votes || [])
      .filter((v: any) => v.vote === "yes" || v.vote === "maybe" || v.vote === "no")
      .map((v: any) => ({ reviewer: v.reviewer_email || "", vote: v.vote, updatedAt: v.updated_at || "" })),
    conflicts: (r.application_votes || [])
      .filter((v: any) => v.vote === "conflict")
      .map((v: any) => ({ reviewer: v.reviewer_email || "", updatedAt: v.updated_at || "" })),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export const hasResume = (a: Applicant) => a.files.length > 0;

/** The link that goes in an interview invite: their personal booking page on the live site
 *  (never localhost or a preview URL, whichever copy of the portal sent it). Falls back to an old
 *  pasted zcal link if the booking database update hasn't been run yet. */
export function inviteLink(a: Pick<Applicant, "bookingToken" | "booking">) {
  if (a.bookingToken) return bookingUrl(SITE_ORIGIN, a.bookingToken);
  return a.booking.trim();
}

/** Interview notes and the interview rating open up once an applicant reaches the interview stage. */
export const INTERVIEW_STAGES: StageId[] = ["booked", "interviewed", "waitlist", "offer"];
export const interviewUnlocked = (status: StageId, notes: Note[] = []) =>
  INTERVIEW_STAGES.includes(status) || notes.some((n) => n.type === "interview");
export const withScheme = (u: string) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : "https://" + u);
/** An applicant-typed link as a safe http(s) URL, or null. Anything else (javascript:, data:, …)
 *  is shown as plain text instead of becoming a clickable link in the committee's session. */
export function safeLink(u: string): string | null {
  try {
    const url = new URL(withScheme(u.trim()));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function fmtDate(iso: string) {
  const d = new Date(iso);
  return !iso || isNaN(+d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return !iso || isNaN(+d) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
export function fmtSize(bytes?: number) {
  if (!bytes) return "";
  return bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

const pad = (n: number) => String(n).padStart(2, "0");
// reject = after an interview, rejectScreen = not interviewed (screened out). Both log as a rejection.
export type SendKind = "invite" | "offer" | "reject" | "rejectScreen";
export const SEND_META: Record<SendKind, { title: string; logged: string; button: string; label: string }> = {
  invite: { title: "Send interview invite", logged: "Invite emailed", button: "Send invite", label: "Interview invite" },
  offer: { title: "Send offer", logged: "Offer emailed", button: "Send offer", label: "Offer" },
  reject: { title: "Send rejection", logged: "Rejection emailed", button: "Send rejection", label: "Rejection (after interview)" },
  rejectScreen: { title: "Send rejection", logged: "Rejection emailed", button: "Send rejection", label: "Rejection (not interviewed)" },
};
export const SEND_KINDS: SendKind[] = ["invite", "offer", "reject", "rejectScreen"];

/** Did this applicant get as far as an interview? Decides which rejection email fits. */
export function wasInterviewed(a: Pick<Applicant, "status" | "rating" | "notes">) {
  if (["booked", "interviewed", "waitlist", "offer"].includes(a.status)) return true;
  if (a.rating) return true;
  return a.notes.some((n) =>
    n.type === "interview" ||
    (n.type === "auto" && /^Moved to (Interview booked|Interviewed|Waitlist|Offer)$/.test(n.text)));
}
export const rejectionKind = (a: Pick<Applicant, "status" | "rating" | "notes">): SendKind =>
  wasInterviewed(a) ? "reject" : "rejectScreen";

/** Emails already sent to this applicant, newest first per kind, read from the activity log. */
export type SentGroup = "invite" | "offer" | "reject";
export function sentEmails(a: Pick<Applicant, "notes">): Partial<Record<SentGroup, string>> {
  const out: Partial<Record<SentGroup, string>> = {};
  for (const n of a.notes) {
    if (n.type !== "auto") continue;
    const g: SentGroup | null =
      n.text === SEND_META.invite.logged ? "invite" : n.text === SEND_META.offer.logged ? "offer" : n.text === SEND_META.reject.logged ? "reject" : null;
    if (g && (!out[g] || n.ts > out[g]!)) out[g] = n.ts;
  }
  return out;
}
export const sentGroup = (k: SendKind): SentGroup => (k === "rejectScreen" ? "reject" : k);

/** "3d ago" style age for badges. */
export function ago(iso: string) {
  const ms = Date.now() - +new Date(iso);
  if (!iso || isNaN(ms)) return "";
  const m = Math.round(ms / 60000);
  if (m < 60) return Math.max(m, 1) + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}

export function voteTally(votes: Vote[]) {
  const t = { yes: 0, maybe: 0, no: 0 };
  for (const v of votes) t[v.vote]++;
  return t;
}

// ---- CSV -------------------------------------------------------------------------------------
export function csvCell(v: unknown) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // stop spreadsheet formula injection from applicant-typed text
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function download(filename: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const stamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
};
