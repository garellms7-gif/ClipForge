import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

// Singleton Supabase browser client.
// Reads NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY from env.
// Falls back to placeholder strings during build-time static generation so
// the module can be imported without throwing; the real values are required
// at runtime (set them in Vercel environment variables).
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key";

export const supabase = createClientComponentClient({
  supabaseUrl,
  supabaseKey: supabaseAnonKey,
});
