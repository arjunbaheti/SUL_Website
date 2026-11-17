// Server-only: sends mail through the club's Gmail (GMAIL_USER + GMAIL_APP_PASSWORD, set in
// Vercel). Used by /api/send-email (committee emails) and /api/application-received.
import nodemailer from "nodemailer";

export const DEFAULT_FROM_NAME = "StartUp Link UniMelb";

/** Display name safe to put in the From header. */
export const cleanFromName = (v: unknown) =>
  (typeof v === "string" ? v : "").replace(/["<>\\\r\n]/g, "").trim().slice(0, 80) || DEFAULT_FROM_NAME;

/** A single plain email address, or "" if blank. Returns null if it isn't valid. */
export function cleanReplyTo(v: unknown): string | null {
  const s = (typeof v === "string" ? v : "").trim();
  if (!s) return "";
  return /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(s) ? s : null;
}

export function missingMailEnv() {
  return [!process.env.GMAIL_USER && "GMAIL_USER", !process.env.GMAIL_APP_PASSWORD && "GMAIL_APP_PASSWORD"].filter(Boolean) as string[];
}

// One pooled Gmail connection per server instance (at most 2 sockets): a booking can send a dozen
// emails at once, and opening a connection for each trips Gmail's limit on simultaneous logins.
let pooled: ReturnType<typeof nodemailer.createTransport> | null = null;
function transport() {
  if (!pooled) {
    pooled = nodemailer.createTransport({
      service: "gmail", pool: true, maxConnections: 2,
      auth: { user: process.env.GMAIL_USER!, pass: process.env.GMAIL_APP_PASSWORD! },
    });
  }
  return pooled;
}

/** The address mail is sent from (also the organiser on calendar invites). */
export const clubAddress = () => process.env.GMAIL_USER || "";

export async function sendClubMail(m: {
  to: string; subject: string; text: string; fromName?: string; replyTo?: string;
  /** A calendar invite (.ics). Mail apps show it as an event with Add / Yes / No buttons. */
  ics?: { method: "REQUEST" | "CANCEL" | "PUBLISH"; content: string };
}) {
  const user = process.env.GMAIL_USER!;
  const transporter = transport();
  const domain = user.split("@")[1] || "startuplinkunimelb.net";
  await transporter.sendMail({
    from: { name: cleanFromName(m.fromName), address: user },
    replyTo: m.replyTo || user,
    to: m.to,
    subject: m.subject,
    text: m.text,
    ...(m.ics ? { icalEvent: { method: m.ics.method, filename: "interview.ics", content: m.ics.content } } : {}),
    // Nodemailer defaults this to the container's hostname, which doesn't match the sending
    // domain and reads as a spam signal.
    messageId: `<${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`,
  });
}
