// Shared types, constants and helpers for the committee portal (recruitment board).

export type StageId = "applied" | "review" | "invited" | "booked" | "interviewed" | "offer" | "rejected";
export type RatingId = "" | "yes" | "maybe" | "no";

export const STAGES: { id: StageId; label: string; color: string }[] = [
  { id: "applied", label: "Applied", color: "#6b7a99" },
  { id: "review", label: "Under review", color: "#d9a441" },
  { id: "invited", label: "Interview invited", color: "#9b7bd4" },
  { id: "booked", label: "Interview booked", color: "#3fb6c9" },
  { id: "interviewed", label: "Interviewed", color: "#5b8def" },
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

export type Applicant = {
  id: string;
  name: string; email: string; phone: string; degree: string; yearLevel: string;
  role: string; roleSecondary: string;
  statement: string; experience: string; linkedin: string; questions: string; extraNote: string;
  files: AppFile[];
  booking: string; // the zcal link pasted in for this applicant
  status: StageId; rating: RatingId;
  notes: Note[];
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
    status: STAGE_BY_ID[r.status as StageId] ? r.status : "applied",
    rating: r.rating || "",
    notes: (r.application_notes || []).map(noteFromRow).sort((x: Note, y: Note) => y.ts.localeCompare(x.ts)),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export const hasResume = (a: Applicant) => a.files.length > 0;

/** Interview notes and the interview rating open up once an applicant reaches the interview stage. */
export const INTERVIEW_STAGES: StageId[] = ["booked", "interviewed", "offer"];
export const interviewUnlocked = (status: StageId, notes: Note[] = []) =>
  INTERVIEW_STAGES.includes(status) || notes.some((n) => n.type === "interview");
export const firstName = (name: string) => (name || "").trim().split(/\s+/)[0] || "there";
export const withScheme = (u: string) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : "https://" + u);

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
export type SendKind = "invite" | "offer" | "reject";
export const SEND_META: Record<SendKind, { title: string; logged: string; button: string }> = {
  invite: { title: "Send interview invite", logged: "Invite emailed", button: "Send invite" },
  offer: { title: "Send offer", logged: "Offer emailed", button: "Send offer" },
  reject: { title: "Send rejection", logged: "Rejection emailed", button: "Send rejection" },
};

export function emailSubject(kind: SendKind, role = "") {
  if (kind === "invite") return "StartUp Link UniMelb Interview" + (role ? " - " + role : "");
  if (kind === "offer") return "Offer — StartUp Link UniMelb Committee";
  return "Your application — StartUp Link UniMelb";
}
export function inviteMessage(a: Pick<Applicant, "name">, link: string) {
  return [
    `Hi ${firstName(a.name)},`,
    "Congratulations and thank you again for applying to join the StartUp Link UniMelb team! We were really impressed by the strength of applications this year, and we're excited to invite you to the interview stage!",
    "Interviews will be in person and scheduled as a 30-minute slot, with the conversation itself lasting approximately 20 minutes. The dress code is casual, so just come as you are.",
    "This is a great chance for you to learn more about StartUp Link, for us to get to know you better, and for you to ask any questions about the club, roles, or what the year ahead looks like. Please book a time that suits you using the link below:",
    link,
    "If you're unable to attend one of the current slots, please reply to this email to arrange an alternative time.",
    "If you have any questions or run into any issues or are unable to make any of the above times for a valid reason, feel free to reply to this email and we'll be happy to help. We're really looking forward to meeting you soon and learning more about you.",
    "Best,\nPeople & Culture Team",
  ].join("\n\n");
}
export function offerMessage(a: Pick<Applicant, "name" | "role">) {
  return `Hi ${firstName(a.name)},\n\nCongratulations! We'd love to offer you a position on the StartUp Link UniMelb committee${a.role ? ` in the ${a.role} team` : ""}. We were really impressed with you throughout the process and think you'll be a great addition to the team.\n\nWe'll be in touch shortly with next steps. Welcome aboard!\n\nStartUp Link UniMelb`;
}
export function rejectionMessage(a: Pick<Applicant, "name" | "role">) {
  return `Hi ${firstName(a.name)},\n\nThank you for taking the time to apply${a.role ? ` to the ${a.role} team` : ""} and for chatting with us during the interview process. After a lot of consideration, we won't be moving forward with your application on this occasion.\n\nThis was a genuinely competitive round and we'd encourage you to apply again in future. Thanks again for your interest in StartUp Link UniMelb, and we wish you all the best.\n\nStartUp Link UniMelb`;
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
