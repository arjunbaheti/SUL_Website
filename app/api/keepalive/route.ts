// Keeps the free Supabase project awake. Free projects pause after about a week without
// database activity, which would break the application form and the portal until someone
// restores the project by hand. A Vercel cron job (vercel.json -> "crons") calls this once a
// day, and it runs one tiny read-only query: is_committee() as an anonymous caller, which
// always returns false and touches no applicant data.
//
// If CRON_SECRET is set in Vercel (recommended), only Vercel's scheduler can call this:
// Vercel sends "Authorization: Bearer <CRON_SECRET>" with every cron request.
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase-config";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = (process.env.SUPABASE_URL || SUPABASE_URL).replace(/\/+$/, "");
  const anon = process.env.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY;
  const started = Date.now();
  try {
    const r = await fetch(`${url}/rest/v1/rpc/is_committee`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    if (!r.ok) {
      return Response.json({ ok: false, error: `Supabase answered ${r.status}`, ms: Date.now() - started }, { status: 502 });
    }
    return Response.json({ ok: true, ms: Date.now() - started, at: new Date().toISOString() });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error)?.message || "network error" }, { status: 502 });
  }
}
