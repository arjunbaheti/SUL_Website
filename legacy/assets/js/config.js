// Public Supabase settings. These two values are SAFE to commit and ship to the browser:
// the anon key only has the narrow permissions granted by supabase/schema.sql (apply + upload).
// Never put the service_role key here.
//
// Find them in Supabase: Project Settings -> API -> Project URL and the "anon public" key.
window.SUL_CONFIG = {
  supabaseUrl: "https://gbmixzofkpoxkemzlgdj.supabase.co",
  supabaseAnonKey: "sb_publishable_wZrq2AJhwh4ewXXxuki3dQ_lcS-lo3n",
};
