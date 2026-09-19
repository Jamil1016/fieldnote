import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NO_REALTIME } from "./no-realtime";

/**
 * Cookie-bound Supabase client. Used for AUTH ONLY (getUser, sign-in,
 * sign-out). It carries the anon key, which has no access to any fn_* schema.
 * All data access goes through lib/supabase/service.ts after a role check.
 */
export async function createAuthClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    realtime: NO_REALTIME,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot set cookies; proxy.ts refreshes the
          // session before render, so this is safe to ignore.
        }
      },
    },
  });
}
