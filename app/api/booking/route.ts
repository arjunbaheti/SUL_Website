// Books, moves or cancels an interview, then emails everyone involved with a calendar invite.
//
// Two callers:
//   * The public booking page: { token, slotId } to book or move, { token, cancel: true } to cancel.
//     The token is the applicant's private link; the database functions book_interview() and
//     cancel_interview() decide what's allowed (see supabase/migrations/2026-11-16-interview-booking.sql).
//   * The committee portal: "Authorization: Bearer <session>" plus { applicationId, slotId | null,
//     notify }. committee_set_interview() checks the session belongs to a committee member.
//
// Email addresses always come from the database, never from the request.
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase-config";
import { missingMailEnv } from "@/lib/mailer";
import { sendBookingEmails, type BookingChange } from "@/lib/booking-mail";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{32,128}$/i;

const MESSAGES: Record<string, [number, string]> = {
  invalid_link: [404, "This booking link isn't valid. Check you've used the full link from your email."],
  closed: [409, "Interview booking is closed for this application. Reply to your invite email if you think that's a mistake."],
  slot_missing: [409, "That time isn't available any more. Please pick another."],
  slot_taken: [409, "Someone just booked that time. Please pick another."],
  too_late: [409, "That time is too soon to book. Please pick a later one."],
  locked: [409, "Your interview is too soon to change online. Please reply to your invite email and we'll sort it out."],
  already_booked: [409, "You already have an interview booked from another application. Use the link in that email to change it, or reply to us."],
  too_many: [429, "You've changed your booking several times today. Please reply to your invite email and we'll sort it out."],
  not_committee: [403, "This account isn't on the committee reviewer list."],
};

async function rpc(fn: string, args: Record<string, unknown>, bearer?: string) {
  const url = (process.env.SUPABASE_URL || SUPABASE_URL).replace(/\/+$/, "");
  const anon = process.env.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY;
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${bearer || anon}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const code = (body as { message?: string } | null)?.message || "";
    if (MESSAGES[code]) return { error: code };
    if (r.status === 401) return { error: "session", detail: "Your session has expired. Sign in again." };
    if (/function .* does not exist|schema cache/i.test(code)) return { error: "setup", detail: "Interview booking needs the latest database update (supabase/migrations/2026-11-16-interview-booking.sql)." };
    return { error: "db", detail: code || `Database answered ${r.status}` };
  }
  return { data: body as BookingChange };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: unknown; slotId?: unknown; cancel?: unknown; applicationId?: unknown; notify?: unknown;
  };
  const auth = request.headers.get("authorization") || "";
  const session = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const slotId = typeof body.slotId === "string" && UUID.test(body.slotId) ? body.slotId : null;
  const origin = new URL(request.url).origin;

  let res: Awaited<ReturnType<typeof rpc>>;
  let emailCandidate = true;
  let token = "";
  if (session && typeof body.applicationId === "string") {
    if (!UUID.test(body.applicationId)) return Response.json({ ok: false, error: "Bad applicant id" }, { status: 400 });
    emailCandidate = body.notify !== false;
    res = await rpc("committee_set_interview", { p_app: body.applicationId, p_slot: slotId }, session);
  } else {
    token = typeof body.token === "string" ? body.token.trim() : "";
    if (!TOKEN.test(token)) return Response.json({ ok: false, error: MESSAGES.invalid_link[1] }, { status: 404 });
    if (body.cancel === true) res = await rpc("cancel_interview", { p_token: token });
    else if (slotId) res = await rpc("book_interview", { p_token: token, p_slot: slotId });
    else return Response.json({ ok: false, error: "Pick a time first." }, { status: 400 });
  }

  if ("error" in res) {
    const [status, message] = MESSAGES[res.error as string] ?? [res.error === "session" ? 401 : 500, res.detail || "Something went wrong."];
    return Response.json({ ok: false, code: res.error, error: message }, { status });
  }
  const change = res.data;
  if (!change?.changed) return Response.json({ ok: true, changed: false });

  // The booking is saved. Emails are best effort: a failure never undoes it.
  if (missingMailEnv().length) {
    console.error("booking: email isn't configured (GMAIL_USER / GMAIL_APP_PASSWORD)");
    if (token) await rpc("log_booking_email_failure", { p_token: token }).catch(() => {});
    return Response.json({ ok: true, changed: true, emailed: false, emailError: "Email isn't configured on the server." });
  }
  try {
    await sendBookingEmails(change, origin, { emailCandidate });
    return Response.json({ ok: true, changed: true, emailed: true });
  } catch (err) {
    console.error("booking: send failed", (err as Error)?.message);
    if (token || change.token) await rpc("log_booking_email_failure", { p_token: token || change.token }).catch(() => {});
    return Response.json({ ok: true, changed: true, emailed: false, emailError: (err as Error)?.message || "Send failed" });
  }
}
