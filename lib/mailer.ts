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

export async function sendClubMail(m: { to: string; subject: string; text: string; fromName?: string; replyTo?: string }) {
  const user = process.env.GMAIL_USER!;
  const pass = process.env.GMAIL_APP_PASSWORD!;
  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  const domain = user.split("@")[1] || "startuplinkunimelb.net";
  await transporter.sendMail({
    from: { name: cleanFromName(m.fromName), address: user },
    replyTo: m.replyTo || user,
    to: m.to,
    subject: m.subject,
    text: m.text,
    // Nodemailer defaults this to the container's hostname, which doesn't match the sending
    // domain and reads as a spam signal.
    messageId: `<${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`,
  });
}
