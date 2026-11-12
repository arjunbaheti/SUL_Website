// Sends an email through the club's Gmail. Credentials come from environment variables set in
// Vercel (Project Settings -> Environment Variables), never from source.
//
// Callers must be signed-in committee members: the portal sends its Supabase access token as
// "Authorization: Bearer <token>", and we ask the database (is_committee(), see
// supabase/schema.sql) whether that token belongs to someone on the allowlist. Without this,
// anyone on the internet could send mail from the club's address.
import { cleanFromName, cleanReplyTo, missingMailEnv, sendClubMail } from "@/lib/mailer";
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

  const body = (await request.json().catch(() => ({}))) as {
    to?: string; subject?: string; text?: string; fromName?: string; replyTo?: string;
  };
  const to = (body.to || "").trim();
  const subject = (body.subject || "").trim();
  const text = (body.text || "").trim();
  if (!to || !subject || !text) {
    return Response.json({ ok: false, error: "Missing to, subject, or text" }, { status: 400 });
  }
  // Display name and reply-to come from portal Settings; the sending account is always GMAIL_USER.
  const replyTo = cleanReplyTo(body.replyTo);
  if (replyTo === null) {
    return Response.json({ ok: false, error: "The reply-to address in Settings isn't a valid email." }, { status: 400 });
  }

  const missing = missingMailEnv();
  if (missing.length) {
    return Response.json(
      {
        ok: false,
        error:
          `Missing env var(s) on the server: ${missing.join(", ")}. In Vercel: Project Settings -> Environment Variables -> ` +
          "make sure both are added with the Production box checked, then redeploy.",
      },
      { status: 500 },
    );
  }

  try {
    await sendClubMail({ to, subject, text, fromName: cleanFromName(body.fromName), replyTo });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error)?.message || "Send failed" }, { status: 500 });
  }
}
