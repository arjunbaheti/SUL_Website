// Sends an email through the club's Gmail. Credentials come from environment variables set in
// Vercel (Project Settings -> Environment Variables), never from source.
//
// Callers must be signed-in committee members: the portal sends its Supabase access token as
// "Authorization: Bearer <token>", and we ask the database (is_committee(), see
// supabase/schema.sql) whether that token belongs to someone on the allowlist. Without this,
// anyone on the internet could send mail from the club's address.
import nodemailer from "nodemailer";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase-config";

type Check = { ok: true } | { ok: false; status: number; error: string };

async function isCommittee(token: string): Promise<Check> {
  const url = (process.env.SUPABASE_URL || SUPABASE_URL).replace(/\/+$/, "");
  const anon = process.env.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { ok: false, status: 500, error: "Missing env var(s) on the server: SUPABASE_URL and/or SUPABASE_ANON_KEY." };
  }
  if (!token) return { ok: false, status: 401, error: "Sign in to the committee portal first." };
  try {
    const r = await fetch(`${url}/rest/v1/rpc/is_committee`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) return { ok: false, status: 401, error: "Your session has expired. Sign in again." };
    return (await r.json()) === true
      ? { ok: true }
      : { ok: false, status: 403, error: "This account isn't on the committee reviewer list." };
  } catch (e) {
    return { ok: false, status: 502, error: `Couldn't verify your session: ${(e as Error)?.message || "network error"}` };
  }
}

export async function POST(request: Request) {
  const auth = request.headers.get("authorization") || "";
  const check = await isCommittee(auth.startsWith("Bearer ") ? auth.slice(7).trim() : "");
  if (!check.ok) return Response.json({ ok: false, error: check.error }, { status: check.status });

  const body = (await request.json().catch(() => ({}))) as { to?: string; subject?: string; text?: string };
  const to = (body.to || "").trim();
  const subject = (body.subject || "").trim();
  const text = (body.text || "").trim();
  if (!to || !subject || !text) {
    return Response.json({ ok: false, error: "Missing to, subject, or text" }, { status: 400 });
  }

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    const missing = [!user && "GMAIL_USER", !pass && "GMAIL_APP_PASSWORD"].filter(Boolean).join(", ");
    return Response.json(
      {
        ok: false,
        error:
          `Missing env var(s) on the server: ${missing}. In Vercel: Project Settings -> Environment Variables -> ` +
          "make sure both are added with the Production box checked, then redeploy.",
      },
      { status: 500 },
    );
  }

  try {
    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    const domain = user.split("@")[1] || "startuplinkunimelb.net";
    await transporter.sendMail({
      from: `"StartUp Link UniMelb" <${user}>`,
      replyTo: user,
      to,
      subject,
      text,
      // Nodemailer defaults this to the container's hostname, which doesn't match the sending
      // domain and reads as a spam signal.
      messageId: `<${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`,
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error)?.message || "Send failed" }, { status: 500 });
  }
}
