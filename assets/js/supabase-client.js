// Creates the shared Supabase client (window.SUL_DB) used by the public application form
// and the committee portal. Load order on a page:
//   config.js -> supabase-js (CDN) -> supabase-client.js -> page script
// window.SUL_DB stays null if config.js hasn't been filled in, so pages can show a friendly
// "not configured yet" message instead of throwing.
(function () {
  "use strict";
  var cfg = window.SUL_CONFIG || {};
  window.SUL_DB = null;
  window.SUL_DB_ERROR = "";

  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    window.SUL_DB_ERROR = "The recruitment backend isn't connected yet (assets/js/config.js is empty).";
    return;
  }
  if (!window.supabase || !window.supabase.createClient) {
    window.SUL_DB_ERROR = "Couldn't load the database library. Check your connection and refresh.";
    return;
  }
  window.SUL_DB = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    // The public application page sets SUL_ANON_ONLY so it never picks up a reviewer's saved
    // sign-in: applicants must always be anonymous, because the upload/insert rules are anon-only.
    auth: { persistSession: !window.SUL_ANON_ONLY, autoRefreshToken: !window.SUL_ANON_ONLY, detectSessionInUrl: false },
  });
})();
