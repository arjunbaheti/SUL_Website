// Anonymous progress tracking for the public application form (shown in the portal's Health tab).
//
// Only ever records WHAT happened and on WHICH field, never what anyone typed: e.g. "this visit
// filled in `degree`" or "submit was blocked on `resume`". Visits are told apart by a random id
// kept in sessionStorage, so one browser tab = one visit and a refresh continues the same visit.
// Every call is fire-and-forget: tracking can never slow down or break an application.
import { applyClient } from "./supabase";

export type FormEvent = "view" | "start" | "field" | "invalid" | "submit" | "error" | "submitted";

const SESSION_KEY = "sul-apply-session";
const sentOnce = new Set<string>();
let session = "";

function sessionId() {
  if (session) return session;
  try {
    session = sessionStorage.getItem(SESSION_KEY) || "";
    if (!session) {
      session = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, session);
    }
  } catch {
    session = session || crypto.randomUUID();
  }
  return session;
}

/** Field names are checked against the same pattern the database enforces. */
const cleanField = (f?: string) => (f && /^[a-z0-9_]{1,32}$/.test(f) ? f : null);

export function trackForm(event: FormEvent, field?: string) {
  if (typeof window === "undefined") return;
  const f = cleanField(field);
  // view/start/submitted and each completed field are only worth recording once per visit.
  if (event !== "invalid" && event !== "error" && event !== "submit") {
    const key = event + ":" + (f ?? "");
    if (sentOnce.has(key)) return;
    sentOnce.add(key);
  }
  const device = window.matchMedia?.("(max-width: 760px), (pointer: coarse)").matches ? "mobile" : "desktop";
  try {
    applyClient()
      .from("form_events")
      .insert({ session_id: sessionId(), event, field: f, device })
      .then(() => {}, () => {});
  } catch {
    /* tracking is best-effort */
  }
}

/** A new visit after a successful submission (e.g. someone applying for a friend on the same tab). */
export function resetFormSession() {
  sentOnce.clear();
  session = "";
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
