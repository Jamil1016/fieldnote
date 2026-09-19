import { POLICY } from "../policy";

export interface Freshness {
  state: "live" | "stale" | "unknown";
  lastSuccessAt: string | null;
  ageHours: number | null;
  maxAgeHours: number;
}

/**
 * The page may only call its data "live" when the last SUCCESSFUL load is
 * recent enough. No successful load at all, an unparseable timestamp, or a
 * timestamp in the future all fail closed.
 */
export function assessFreshness(
  lastSuccessAt: string | null | undefined,
  now: Date,
  maxAgeHours: number = POLICY.freshnessMaxAgeHours,
): Freshness {
  if (!lastSuccessAt) return { state: "unknown", lastSuccessAt: null, ageHours: null, maxAgeHours };
  const ms = Date.parse(lastSuccessAt);
  if (!Number.isFinite(ms)) return { state: "unknown", lastSuccessAt: null, ageHours: null, maxAgeHours };
  const ageHours = (now.getTime() - ms) / 3_600_000;
  if (ageHours < -0.25) {
    // A load "from the future" means a clock problem; do not trust it.
    return { state: "unknown", lastSuccessAt, ageHours, maxAgeHours };
  }
  return { state: ageHours <= maxAgeHours ? "live" : "stale", lastSuccessAt, ageHours: Math.max(0, ageHours), maxAgeHours };
}

/** Picks the newest successful run from a list of runs. */
export function lastSuccessfulRun(
  runs: readonly { status: string; finished_at: string | null }[],
): string | null {
  let best: string | null = null;
  for (const run of runs) {
    if (run.status !== "succeeded" || !run.finished_at) continue;
    if (best === null || Date.parse(run.finished_at) > Date.parse(best)) best = run.finished_at;
  }
  return best;
}
