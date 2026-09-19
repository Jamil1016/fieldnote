import "server-only";
import { createClient } from "@supabase/supabase-js";
import { NO_REALTIME } from "./no-realtime";

/**
 * Service-role client. BYPASSES RLS. Server-only.
 *
 * Every table read and write in the app goes through this client, and only
 * after requireMinRole() / checkAccess() has approved the caller. The browser
 * never queries a table. The database is locked down to match: RLS is enabled
 * on every table with no policies and nothing is granted to anon or
 * authenticated, so a leaked anon key reads nothing.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example).");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "fn_app" },
    realtime: NO_REALTIME,
  });
}

export type Db = ReturnType<typeof createServiceClient>;
