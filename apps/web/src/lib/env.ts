/**
 * Browser-safe configuration only. The anon key is public by design (RLS and the Edge
 * Functions protect data); no secret may ever be added here — see .env.example.
 */
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '')
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (pnpm stack:env for local development)')
}

export const env = {
  supabaseUrl: url,
  anonKey,
  functionsUrl: `${url}/functions/v1`,
}
