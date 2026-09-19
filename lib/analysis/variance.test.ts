import { describe, expect, it } from "vitest";
import { boxStats, mean, median, percentile } from "./stats";
import { computeVariance, isComparable } from "./variance";

describe("computeVariance", () => {
  it("is ok when claimed equals tracked", () => {
    const r = computeVariance(8, 8);
    expect(r.state).toBe("ok");
    expect(r.variance).toBe(0);
  });

  it("is positive when more is claimed than tracked", () => {
    expect(computeVariance(9, 8).variance).toBeCloseTo(0.125);
  });

  it("is negative when less is claimed than tracked", () => {
    expect(computeVariance(7, 8).variance).toBeCloseTo(-0.125);
  });

  it.each([
    [8.4, 8, "ok"],
    [8.64, 8, "watch"],
    [9.19, 8, "watch"],
    [9.2, 8, "breach"],
    [10, 8, "breach"],
    [6.8, 8, "breach"],
    [6.81, 8, "watch"],
  ])("claimed %s vs tracked %s is %s", (claimed, tracked, state) => {
    expect(computeVariance(claimed, tracked).state).toBe(state);
  });

  it("treats exactly 15% as a breach despite float noise", () => {
    expect(computeVariance(1.15, 1).state).toBe("breach");
    expect(computeVariance(0.85, 1).state).toBe("breach");
  });

  it("breaches symmetrically for under-claiming", () => {
    expect(computeVariance(6, 8).state).toBe("breach");
  });

  it("no report and no timer is 'none'", () => {
    expect(computeVariance(null, null).state).toBe("none");
  });

  it("undefined inputs behave like null", () => {
    expect(computeVariance(undefined, undefined).state).toBe("none");
  });

  it("timer but no report is 'missing_report'", () => {
    const r = computeVariance(null, 7.5);
    expect(r.state).toBe("missing_report");
    expect(r.variance).toBeNull();
    expect(r.tracked).toBe(7.5);
  });

  it("report but no timer is 'missing_timer', never a division by zero", () => {
    const r = computeVariance(8, 0);
    expect(r.state).toBe("missing_timer");
    expect(r.variance).toBeNull();
  });

  it("report with NULL tracked is 'missing_timer'", () => {
    expect(computeVariance(8, null).state).toBe("missing_timer");
  });

  it("a few seconds of tracked time is treated as no timer", () => {
    expect(computeVariance(8, 0.01).state).toBe("missing_timer");
  });

  it("zero claimed against zero tracked is ok with variance 0", () => {
    const r = computeVariance(0, 0);
    expect(r.state).toBe("ok");
    expect(r.variance).toBe(0);
  });

  it("zero claimed against real tracked time is a -100% breach", () => {
    const r = computeVariance(0, 8);
    expect(r.variance).toBe(-1);
    expect(r.state).toBe("breach");
  });

  it("NaN and negative inputs are treated as absent", () => {
    expect(computeVariance(Number.NaN, 8).state).toBe("missing_report");
    expect(computeVariance(-3, 8).state).toBe("missing_report");
    expect(computeVariance(8, Number.POSITIVE_INFINITY).state).toBe("missing_timer");
  });

  it("honours custom thresholds", () => {
    expect(computeVariance(8.5, 8, { breach: 0.05, watch: 0.02 }).state).toBe("breach");
  });

  it("isComparable is true only when a variance exists", () => {
    expect(isComparable(computeVariance(8, 8))).toBe(true);
    expect(isComparable(computeVariance(8, null))).toBe(false);
  });
});

describe("stats", () => {
  it("percentile interpolates linearly", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 0.25)).toBe(1.75);
  });

  it("percentile of one value is that value", () => {
    expect(percentile([7], 0.9)).toBe(7);
  });

  it("percentile clamps p to [0, 1]", () => {
    expect(percentile([1, 2, 3], -1)).toBe(1);
    expect(percentile([1, 2, 3], 2)).toBe(3);
  });

  it("percentile of nothing is null", () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it("percentile ignores non-finite values and input order", () => {
    expect(percentile([3, Number.NaN, 1, 2], 0.5)).toBe(2);
  });

  it("median of an even count averages the middle pair", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("mean handles empty input", () => {
    expect(mean([])).toBeNull();
    expect(mean([1, 2, 3])).toBe(2);
  });

  it("boxStats computes quartiles", () => {
    const b = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(b).not.toBeNull();
    expect(b?.q1).toBe(3);
    expect(b?.median).toBe(5);
    expect(b?.q3).toBe(7);
    expect(b?.outliers).toEqual([]);
  });

  it("boxStats separates outliers from the whiskers", () => {
    const b = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 100]);
    expect(b?.outliers).toEqual([100]);
    expect(b?.whiskerHigh).toBe(8);
    expect(b?.max).toBe(100);
  });

  it("boxStats of a single value collapses to that value", () => {
    const b = boxStats([0.2]);
    expect(b?.min).toBe(0.2);
    expect(b?.whiskerLow).toBe(0.2);
    expect(b?.whiskerHigh).toBe(0.2);
  });

  it("boxStats of nothing is null", () => {
    expect(boxStats([])).toBeNull();
  });
});
