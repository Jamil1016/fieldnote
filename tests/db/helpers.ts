import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import type { Db } from "@/lib/data/db";
import { NO_REALTIME } from "@/lib/supabase/no-realtime";
import { mintJwt } from "../../scripts/local/jwt.mjs";

export const GATEWAY_URL = "http://127.0.0.1:54331";
export const DATABASE_URL = process.env.LOCAL_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54329/postgres";

/** Built exactly like lib/supabase/service.ts, pointed at the local stack. */
export function clientFor(role: "service_role" | "anon" | "authenticated"): Db {
  return createClient(GATEWAY_URL, mintJwt(role) as string, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "fn_app" },
    realtime: NO_REALTIME,
  });
}

export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<T>(text, params)).rows;
  } finally {
    await client.end();
  }
}

export const noSleep = async () => undefined;
