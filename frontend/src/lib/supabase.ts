import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

// Singleton Supabase browser client.
// Reads NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY from env automatically.
// Stores the session in cookies so it survives page refreshes.
export const supabase = createClientComponentClient();
