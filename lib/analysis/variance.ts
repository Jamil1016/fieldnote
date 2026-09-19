/**
 * Variance between hours CLAIMED on a daily report and hours TRACKED by the
 * timer. variance = (claimed - tracked) / tracked. Positive = over-claimed.
 */
import { POLICY } from "../policy";

export type CellState =
  | "ok" // both present, under the watch line
  | "watch" // both present, over the watch line, under the breach line
  | "breach" // both present, at or over the breach line
  | "missing_report" // timer ran, no report filed
  | "missing_timer" // report filed, no tracked time
  | "none"; // nothing expected or recorded (leave, not yet hired, no activity)

export interface VarianceResult {
  state: CellState;
  /** Signed ratio, or null when it cannot be computed. */
  variance: number | null;
  claimed: number | null;
  tracked: number | null;
}

export interface Thresholds {
  breach: number;
  watch: number;
}

const DEFAULT_THRESHOLDS: Thresholds = { breach: POLICY.varianceBreach, watch: POLICY.varianceWatch };

/** Below this many tracked hours the timer is treated as absent (noise). */
export const MIN_TRACKED_HOURS = 0.05;

function clean(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Classify one member-day.
 *   claimed null/undefined/NaN/negative -> treated as "no report"
 *   tracked null or under MIN_TRACKED_HOURS -> treated as "no timer data"
 * A report claiming 0 hours against no tracked time is "ok" with variance 0,
 * so a zero never causes a division by zero.
 */
export function computeVariance(
  claimedInput: number | null | undefined,
  trackedInput: number | null | undefined,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): VarianceResult {
  const claimed = clean(claimedInput);
  const trackedRaw = clean(trackedInput);
  const tracked = trackedRaw !== null && trackedRaw >= MIN_TRACKED_HOURS ? trackedRaw : null;

  if (claimed === null && tracked === null) {
    return { state: "none", variance: null, claimed: null, tracked: null };
  }
  if (claimed === null) {
    return { state: "missing_report", variance: null, claimed: null, tracked };
  }
  if (tracked === null) {
    if (claimed === 0) return { state: "ok", variance: 0, claimed: 0, tracked: 0 };
    return { state: "missing_timer", variance: null, claimed, tracked: null };
  }
  const variance = (claimed - tracked) / tracked;
  const magnitude = Math.abs(variance);
  // A tiny epsilon keeps a value that is 15% up to float noise on the breach
  // side of the line, consistently.
  const state: CellState =
    magnitude >= thresholds.breach - 1e-9 ? "breach" : magnitude >= thresholds.watch - 1e-9 ? "watch" : "ok";
  return { state, variance, claimed, tracked };
}

export function isComparable(result: VarianceResult): boolean {
  return result.variance !== null;
}
