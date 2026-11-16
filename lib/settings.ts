// Portal settings shared by the whole committee: email templates, sender details and board
// behaviour. Stored as one row in public.portal_settings (see supabase/schema.sql). Anything
// missing from the saved row falls back to the defaults below, so new settings never break
// an older saved copy.
import { portalClient } from "./supabase";
// (portalClient is only called by loadSettings/saveSettings in the browser; the server route
// that sends "application received" emails only uses mergeSettings and fillTemplate.)
import type { Applicant, SendKind } from "./portal";

export type EmailTemplate = { subject: string; body: string };
/** Every editable email: the four the committee sends, plus the automatic "application received"
 *  and "interview booked" confirmations. */
export type EmailKey = SendKind | "received" | "booked";
export const EMAIL_KEYS: EmailKey[] = ["received", "invite", "booked", "offer", "reject", "rejectScreen"];

export type PortalSettings = {
  senderName: string;
  replyTo: string; // blank = replies go to the sending Gmail address
  templates: Record<EmailKey, EmailTemplate>;
  confirmationEnabled: boolean; // email applicants automatically when they submit the form
  autoInvitedAfterSend: boolean; // sending an invite moves "Under review" -> "Interview invited"
  ratingMovesStage: boolean; // interview rating Yes -> Offer, Maybe -> Waitlist, No -> Rejected
  bookingCutoffHours: number; // candidates can't book or change an interview closer than this (read by the database too)
};

export const PLACEHOLDERS: { key: string; help: string }[] = [
  { key: "{first_name}", help: "Applicant's first name" },
  { key: "{full_name}", help: "Applicant's full name" },
  { key: "{role}", help: "Team they applied for" },
  { key: "{link}", help: "Their personal interview booking link" },
  { key: "{when}", help: "Interview day and time (Interview booked email only)" },
  { key: "{location}", help: "Interview location (Interview booked email only)" },
];

export const DEFAULT_SETTINGS: PortalSettings = {
  senderName: "StartUp Link UniMelb",
  replyTo: "",
  autoInvitedAfterSend: true,
  ratingMovesStage: true,
  confirmationEnabled: true,
  bookingCutoffHours: 12,
  templates: {
    received: {
      subject: "We've received your application — StartUp Link UniMelb",
      body: "Hi {first_name},\n\nThanks for applying to join the {role} team at StartUp Link UniMelb! This email confirms we've received your application.\n\nOur team reviews every application carefully, and we'll be in touch by email about next steps. Keep an eye on your inbox (and your spam folder, just in case).\n\nIf you have any questions in the meantime, just reply to this email.\n\nStartUp Link UniMelb",
    },
    invite: {
      subject: "StartUp Link UniMelb Interview - {role}",
      body: [
        "Hi {first_name},",
        "Congratulations and thank you again for applying to join the StartUp Link UniMelb team! We were really impressed by the strength of applications this year, and we're excited to invite you to the interview stage!",
        "Interviews will be in person and scheduled as a 30-minute slot, with the conversation itself lasting approximately 20 minutes. The dress code is casual, so just come as you are.",
        "This is a great chance for you to learn more about StartUp Link, for us to get to know you better, and for you to ask any questions about the club, roles, or what the year ahead looks like. Please book a time that suits you using the link below:",
        "{link}",
        "You can use the same link to change or cancel your time later. If none of the times work for you, please reply to this email to arrange an alternative.",
        "If you have any questions or run into any issues or are unable to make any of the above times for a valid reason, feel free to reply to this email and we'll be happy to help. We're really looking forward to meeting you soon and learning more about you.",
        "Best,\nPeople & Culture Team",
      ].join("\n\n"),
    },
    booked: {
      subject: "Interview confirmed — StartUp Link UniMelb",
      body: "Hi {first_name},\n\nThanks for booking your interview for the {role} team. Here are the details:\n\nWhen: {when}\nWhere: {location}\n\nWe've attached a calendar invite so it's easy to add to your calendar.\n\nNeed to change or cancel? Use your booking link: {link}\n\nSee you soon!\n\nPeople & Culture Team\nStartUp Link UniMelb",
    },
    offer: {
      subject: "Offer — StartUp Link UniMelb Committee",
      body: "Hi {first_name},\n\nCongratulations! We'd love to offer you a position on the StartUp Link UniMelb committee in the {role} team. We were really impressed with you throughout the process and think you'll be a great addition to the team.\n\nWe'll be in touch shortly with next steps. Welcome aboard!\n\nStartUp Link UniMelb",
    },
    reject: {
      subject: "Your application — StartUp Link UniMelb",
      body: "Hi {first_name},\n\nThank you for taking the time to apply to the {role} team and for chatting with us during the interview process. After a lot of consideration, we won't be moving forward with your application on this occasion.\n\nThis was a genuinely competitive round and we'd encourage you to apply again in future. Thanks again for your interest in StartUp Link UniMelb, and we wish you all the best.\n\nStartUp Link UniMelb",
    },
    rejectScreen: {
      subject: "Your application — StartUp Link UniMelb",
      body: "Hi {first_name},\n\nThank you for applying to join the {role} team at StartUp Link UniMelb. We received a large number of strong applications this year, and after careful review we won't be progressing your application to the interview stage on this occasion.\n\nWe really appreciated the time you put into your application, and we'd encourage you to apply again in future. In the meantime, we'd love to see you at our events throughout the year.\n\nBest of luck with everything,\n\nStartUp Link UniMelb",
    },
  },
};

/** Saved values layered over the defaults, field by field. */
export function mergeSettings(saved: unknown): PortalSettings {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<PortalSettings>;
  const d = DEFAULT_SETTINGS;
  const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const t = (s.templates ?? {}) as Partial<Record<EmailKey, Partial<EmailTemplate>>>;
  const tpl = (k: EmailKey): EmailTemplate => ({
    subject: str(t[k]?.subject, d.templates[k].subject) || d.templates[k].subject,
    body: str(t[k]?.body, d.templates[k].body) || d.templates[k].body,
  });
  return {
    senderName: str(s.senderName, d.senderName).trim() || d.senderName,
    replyTo: str(s.replyTo, d.replyTo).trim(),
    autoInvitedAfterSend: bool(s.autoInvitedAfterSend, d.autoInvitedAfterSend),
    ratingMovesStage: bool(s.ratingMovesStage, d.ratingMovesStage),
    confirmationEnabled: bool(s.confirmationEnabled, d.confirmationEnabled),
    bookingCutoffHours: typeof s.bookingCutoffHours === "number" && isFinite(s.bookingCutoffHours)
      ? Math.max(0, Math.min(168, Math.round(s.bookingCutoffHours))) : d.bookingCutoffHours,
    templates: { received: tpl("received"), invite: tpl("invite"), booked: tpl("booked"), offer: tpl("offer"), reject: tpl("reject"), rejectScreen: tpl("rejectScreen") },
  };
}

export type SettingsMeta = { updatedAt: string; updatedBy: string; missingTable: boolean };

export async function loadSettings(): Promise<{ settings: PortalSettings; meta: SettingsMeta }> {
  const { data, error } = await portalClient().from("portal_settings").select("*").eq("id", "main").maybeSingle();
  const missingTable = !!error && /portal_settings|does not exist|schema cache/i.test(error.message);
  return {
    settings: mergeSettings(data?.data),
    meta: { updatedAt: data?.updated_at ?? "", updatedBy: data?.updated_by ?? "", missingTable },
  };
}

export async function saveSettings(settings: PortalSettings): Promise<string | null> {
  const { error } = await portalClient()
    .from("portal_settings")
    .upsert({ id: "main", data: settings })
    .select("id")
    .single();
  return error ? error.message : null;
}

/** Fills {placeholders} in a template for one applicant. */
export function fillTemplate(text: string, a: Pick<Applicant, "name" | "role">, link = "", extra: { when?: string; location?: string } = {}) {
  const first = (a.name || "").trim().split(/\s+/)[0] || "there";
  const values: Record<string, string> = {
    first_name: first,
    full_name: (a.name || "").trim() || first,
    role: (a.role || "").trim() || "StartUp Link",
    link: link.trim(),
    when: extra.when || "",
    location: extra.location || "To be confirmed",
  };
  return text.replace(/\{(first_name|full_name|role|link|when|location)\}/g, (_, k: string) => values[k]);
}
