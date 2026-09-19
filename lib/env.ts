/** Environment switches. Pure functions of an env object so they can be tested. */

type Env = Record<string, string | undefined>;

export const DEMO_USER_EMAIL = "demo@example.com";
export const VIEW_AS_COOKIE = "fn_view_as";

/** Demo mode is the only supported mode, but it is still an explicit switch. */
export function isDemoMode(env: Env = process.env): boolean {
  return env.DEMO_MODE === "true";
}

/**
 * DEMO_AUTH_BYPASS_FOR_LOCAL_TESTS lets the app run against a local Postgres +
 * PostgREST stack that has no Auth service, by treating every request as the
 * demo user. It is REFUSED whenever the process looks like a deployment:
 * NODE_ENV=production, or any Vercel marker in the environment.
 */
export function authBypassEnabled(env: Env = process.env): boolean {
  if (env.DEMO_AUTH_BYPASS_FOR_LOCAL_TESTS !== "true") return false;
  if (env.NODE_ENV === "production") return false;
  if (env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL) return false;
  return isDemoMode(env);
}

export function bypassRefusedReason(env: Env = process.env): string | null {
  if (env.DEMO_AUTH_BYPASS_FOR_LOCAL_TESTS !== "true") return null;
  if (authBypassEnabled(env)) return null;
  if (env.NODE_ENV === "production") return "DEMO_AUTH_BYPASS_FOR_LOCAL_TESTS is ignored when NODE_ENV=production.";
  if (env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL) return "DEMO_AUTH_BYPASS_FOR_LOCAL_TESTS is ignored on Vercel.";
  return "DEMO_AUTH_BYPASS_FOR_LOCAL_TESTS only works together with DEMO_MODE=true.";
}
