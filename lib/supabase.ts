import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_ANON_KEY as KEY, SUPABASE_URL as URL } from "./supabase-config";

let portal: SupabaseClient | null = null;
let apply: SupabaseClient | null = null;

/** Signed-in client for the committee portal (keeps the session in the browser). */
export function portalClient(): SupabaseClient {
  if (!portal) portal = createClient(URL, KEY, { auth: { storageKey: "sul-portal" } });
  return portal;
}

/** Anonymous client for the public form: never reads or stores a session. */
export function applyClient(): SupabaseClient {
  if (!apply) {
    apply = createClient(URL, KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: "sul-apply" },
    });
  }
  return apply;
}
