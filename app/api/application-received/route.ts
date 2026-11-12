// Emails an applicant a "we've received your application" confirmation, straight after the
// public form saves their application.
//
// The browser only sends the new application's id. The database function
// claim_application_confirmation() (supabase/schema.sql) decides whether an email is due and
// hands back the applicant's name/email/team plus the committee's saved template. It only says
// yes once per application, only within 15 minutes of applying, at most once a day per email
// address, and for at most 250 confirmations a day in total. So this route can't be used to
// email arbitrary addresses or to resend, and the address always comes from the database.
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase-config";
import { cleanFromName, cleanReplyTo, missingMailEnv, sendClubMail } from "@/lib/mailer";
import { fillTemplate, mergeSettings } from "@/lib/settings";

type Claim = { name: string; email: string; role: string; settings: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!UUID.test(id)) return Response.json({ ok: false, error: "Bad id" }, { status: 400 });
  if (missingMailEnv().length) return Response.json({ ok: false, error: "Email isn't configured" }, { status: 500 });

  const url = (process.env.SUPABASE_URL || SUPABASE_URL).replace(/\/+$/, "");
  const anon = process.env.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY;
  let claim: Claim | undefined;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/claim_application_confirmation`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: id }),
      cache: "no-store",
    });
    if (!r.ok) return Response.json({ ok: false, error: `Database answered ${r.status}` }, { status: 502 });
    claim = ((await r.json()) as Claim[])[0];
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error)?.message || "network error" }, { status: 502 });
  }
  // Nothing due (already sent, too old, turned off in Settings, or a daily limit reached).
  if (!claim?.email) return Response.json({ ok: true, sent: false });

  const settings = mergeSettings(claim.settings);
  const who = { name: claim.name, role: claim.role };
  try {
    await sendClubMail({
      to: claim.email,
      subject: fillTemplate(settings.templates.received.subject, who),
      text: fillTemplate(settings.templates.received.body, who),
      fromName: cleanFromName(settings.senderName),
      replyTo: cleanReplyTo(settings.replyTo) || "",
    });
    return Response.json({ ok: true, sent: true });
  } catch (err) {
    console.error("application-received: send failed", (err as Error)?.message);
    return Response.json({ ok: false, error: "Send failed" }, { status: 500 });
  }
}
