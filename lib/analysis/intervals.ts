/**
 * Timer-interval maths. Intervals are half-open [start, end) in epoch
 * milliseconds. Pure functions only.
 */
import { msToDay, type Day } from "./calendar";

export interface Interval {
  start: number;
  end: number;
}

const DAY_MS = 86_400_000;

/** Drops empty, inverted and non-finite intervals. */
export function sanitize(intervals: readonly Interval[]): Interval[] {
  return intervals.filter(
    (i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start,
  );
}

/**
 * Merge overlapping or touching intervals so time covered by two timers at
 * once is counted once. Returns a new, sorted list; inputs are not mutated.
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = sanitize(intervals).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      if (cur.end > last.end) last.end = cur.end;
    } else {
      out.push({ start: cur.start, end: cur.end });
    }
  }
  return out;
}

/** Split one interval at every UTC midnight it crosses. */
export function splitAtMidnight(interval: Interval): Interval[] {
  if (!(interval.end > interval.start)) return [];
  const out: Interval[] = [];
  let start = interval.start;
  while (start < interval.end) {
    const nextMidnight = (Math.floor(start / DAY_MS) + 1) * DAY_MS;
    const end = Math.min(interval.end, nextMidnight);
    out.push({ start, end });
    start = end;
  }
  return out;
}

export function totalMs(intervals: readonly Interval[]): number {
  return intervals.reduce((sum, i) => sum + (i.end - i.start), 0);
}

/**
 * Tracked hours per UTC day: merge first (so overlaps are not double counted),
 * then split at midnight, then sum per day.
 */
export function trackedHoursByDay(intervals: readonly Interval[]): Map<Day, number> {
  const byDay = new Map<Day, number>();
  for (const merged of mergeIntervals(intervals)) {
    for (const part of splitAtMidnight(merged)) {
      const day = msToDay(part.start);
      byDay.set(day, (byDay.get(day) ?? 0) + (part.end - part.start) / 3_600_000);
    }
  }
  return byDay;
}
