import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The data layer takes the client as an argument so the same functions run in
 * the app (service-role client) and in the integration tests (a client pointed
 * at a local PostgREST). The database is untyped on purpose: every row that
 * crosses this boundary is validated with zod instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, any, any>;

export class DataError extends Error {
  constructor(
    readonly operation: string,
    readonly detail: string,
  ) {
    super(`${operation}: ${detail}`);
    this.name = "DataError";
  }
}

export function unwrap<T>(operation: string, result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new DataError(operation, result.error.message);
  if (result.data === null) throw new DataError(operation, "no data returned");
  return result.data;
}
