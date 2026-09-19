import { describe, expect, it } from "vitest";
import { mergeIntervals, sanitize, splitAtMidnight, totalMs, trackedHoursByDay } from "./intervals";

const H = 3_600_000;
const at = (iso: string) => Date.parse(iso);

describe("sanitize", () => {
  it("drops empty, inverted and non-finite intervals", () => {
    expect(
      sanitize([
        { start: 0, end: 0 },
        { start: 5, end: 1 },
        { start: Number.NaN, end: 4 },
        { start: 1, end: 2 },
      ]),
    ).toEqual([{ start: 1, end: 2 }]);
  });
});

describe("mergeIntervals", () => {
  it("returns an empty list for no input", () => {
    expect(mergeIntervals([])).toEqual([]);
  });

  it("leaves disjoint intervals alone and sorts them", () => {
    expect(mergeIntervals([{ start: 10, end: 12 }, { start: 1, end: 3 }])).toEqual([
      { start: 1, end: 3 },
      { start: 10, end: 12 },
    ]);
  });

  it("merges a partial overlap", () => {
    expect(mergeIntervals([{ start: 0, end: 10 }, { start: 5, end: 15 }])).toEqual([{ start: 0, end: 15 }]);
  });

  it("merges an interval fully contained in another", () => {
    expect(mergeIntervals([{ start: 0, end: 10 }, { start: 2, end: 4 }])).toEqual([{ start: 0, end: 10 }]);
  });

  it("merges touching intervals", () => {
    expect(mergeIntervals([{ start: 0, end: 5 }, { start: 5, end: 9 }])).toEqual([{ start: 0, end: 9 }]);
  });

  it("merges a chain of overlaps into one", () => {
    expect(
      mergeIntervals([
        { start: 0, end: 4 },
        { start: 3, end: 8 },
        { start: 7, end: 12 },
      ]),
    ).toEqual([{ start: 0, end: 12 }]);
  });

  it("handles exact duplicates", () => {
    expect(mergeIntervals([{ start: 1, end: 2 }, { start: 1, end: 2 }])).toEqual([{ start: 1, end: 2 }]);
  });

  it("does not mutate its input", () => {
    const input = [{ start: 0, end: 10 }, { start: 5, end: 15 }];
    mergeIntervals(input);
    expect(input).toEqual([{ start: 0, end: 10 }, { start: 5, end: 15 }]);
  });

  it("merged total is never more than the naive total", () => {
    const input = [{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 20, end: 30 }];
    expect(totalMs(mergeIntervals(input))).toBe(25);
    expect(totalMs(input)).toBe(30);
  });
});

describe("splitAtMidnight", () => {
  it("returns the interval unchanged when it stays within one day", () => {
    const i = { start: at("2025-03-03T09:00:00Z"), end: at("2025-03-03T11:00:00Z") };
    expect(splitAtMidnight(i)).toEqual([i]);
  });

  it("splits an interval that crosses midnight", () => {
    const parts = splitAtMidnight({ start: at("2025-03-03T22:30:00Z"), end: at("2025-03-04T00:45:00Z") });
    expect(parts).toEqual([
      { start: at("2025-03-03T22:30:00Z"), end: at("2025-03-04T00:00:00Z") },
      { start: at("2025-03-04T00:00:00Z"), end: at("2025-03-04T00:45:00Z") },
    ]);
  });

  it("splits an interval spanning two midnights into three parts", () => {
    const parts = splitAtMidnight({ start: at("2025-03-03T23:00:00Z"), end: at("2025-03-05T01:00:00Z") });
    expect(parts).toHaveLength(3);
    expect(totalMs(parts)).toBe(26 * H);
  });

  it("does not create an empty part when the interval ends exactly at midnight", () => {
    const parts = splitAtMidnight({ start: at("2025-03-03T22:00:00Z"), end: at("2025-03-04T00:00:00Z") });
    expect(parts).toHaveLength(1);
  });

  it("starts exactly at midnight without a leading empty part", () => {
    const parts = splitAtMidnight({ start: at("2025-03-04T00:00:00Z"), end: at("2025-03-04T01:00:00Z") });
    expect(parts).toHaveLength(1);
  });

  it("returns nothing for an empty interval", () => {
    expect(splitAtMidnight({ start: 5, end: 5 })).toEqual([]);
  });
});

describe("trackedHoursByDay", () => {
  it("sums separate entries on one day", () => {
    const hours = trackedHoursByDay([
      { start: at("2025-03-03T08:00:00Z"), end: at("2025-03-03T10:00:00Z") },
      { start: at("2025-03-03T11:00:00Z"), end: at("2025-03-03T12:30:00Z") },
    ]);
    expect(hours.get("2025-03-03")).toBeCloseTo(3.5);
  });

  it("counts overlapping timers once", () => {
    const hours = trackedHoursByDay([
      { start: at("2025-03-03T08:00:00Z"), end: at("2025-03-03T10:00:00Z") },
      { start: at("2025-03-03T09:00:00Z"), end: at("2025-03-03T10:30:00Z") },
    ]);
    expect(hours.get("2025-03-03")).toBeCloseTo(2.5);
  });

  it("assigns each side of midnight to its own day", () => {
    const hours = trackedHoursByDay([{ start: at("2025-03-03T22:30:00Z"), end: at("2025-03-04T00:45:00Z") }]);
    expect(hours.get("2025-03-03")).toBeCloseTo(1.5);
    expect(hours.get("2025-03-04")).toBeCloseTo(0.75);
  });

  it("merges before splitting so an overlap across midnight is not double counted", () => {
    const hours = trackedHoursByDay([
      { start: at("2025-03-03T23:00:00Z"), end: at("2025-03-04T01:00:00Z") },
      { start: at("2025-03-03T23:30:00Z"), end: at("2025-03-04T00:30:00Z") },
    ]);
    expect(hours.get("2025-03-03")).toBeCloseTo(1);
    expect(hours.get("2025-03-04")).toBeCloseTo(1);
  });

  it("returns an empty map for no entries", () => {
    expect(trackedHoursByDay([]).size).toBe(0);
  });

  it("ignores inverted entries", () => {
    const hours = trackedHoursByDay([{ start: at("2025-03-03T10:00:00Z"), end: at("2025-03-03T09:00:00Z") }]);
    expect(hours.size).toBe(0);
  });
});
