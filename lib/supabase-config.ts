// Public by design: the anon key only has the narrow permissions granted by supabase/schema.sql.
// Override with NEXT_PUBLIC_* env vars if the project ever moves.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://gbmixzofkpoxkemzlgdj.supabase.co";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "sb_publishable_wZrq2AJhwh4ewXXxuki3dQ_lcS-lo3n";
