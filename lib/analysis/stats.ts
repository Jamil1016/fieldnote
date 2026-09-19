/** Small, dependency-free descriptive statistics. */

function finiteSorted(values: readonly number[]): number[] {
  return values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
}

/** Linear-interpolated percentile (the method SQL percentile_cont uses). p in [0, 1]. */
export function percentile(values: readonly number[], p: number): number | null {
  const xs = finiteSorted(values);
  if (xs.length === 0) return null;
  const clamped = Math.min(1, Math.max(0, p));
  const pos = clamped * (xs.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

export function median(values: readonly number[]): number | null {
  return percentile(values, 0.5);
}

export function mean(values: readonly number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export interface BoxStats {
  count: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** Whisker ends: the most extreme points within 1.5 IQR of the box. */
  whiskerLow: number;
  whiskerHigh: number;
  outliers: number[];
}

export function boxStats(values: readonly number[]): BoxStats | null {
  const xs = finiteSorted(values);
  if (xs.length === 0) return null;
  const q1 = percentile(xs, 0.25) as number;
  const med = percentile(xs, 0.5) as number;
  const q3 = percentile(xs, 0.75) as number;
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;
  const inside = xs.filter((v) => v >= lowFence && v <= highFence);
  return {
    count: xs.length,
    min: xs[0],
    q1,
    median: med,
    q3,
    max: xs[xs.length - 1],
    whiskerLow: inside.length ? inside[0] : q1,
    whiskerHigh: inside.length ? inside[inside.length - 1] : q3,
    outliers: xs.filter((v) => v < lowFence || v > highFence),
  };
}
