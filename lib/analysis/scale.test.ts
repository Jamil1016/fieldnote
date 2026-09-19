import { describe, expect, it } from "vitest";
import { computeVariance } from "./variance";
import { legendBins, varianceBin } from "./scale";

describe("varianceBin", () => {
  it.each([
    [-0.5, "under-3"],
    [-0.3, "under-3"],
    [-0.29, "under-2"],
    [-0.15, "under-2"],
    [-0.149, "under-1"],
    [-0.08, "under-1"],
    [-0.079, "zero"],
    [0, "zero"],
    [0.079, "zero"],
    [0.08, "over-1"],
    [0.149, "over-1"],
    [0.15, "over-2"],
    [0.299, "over-2"],
    [0.3, "over-3"],
    [2, "over-3"],
  ])("%s falls in %s", (v, bin) => {
    expect(varianceBin(v)).toBe(bin);
  });

  it("agrees with computeVariance about where a breach starts", () => {
    for (const claimed of [6.7, 6.8, 6.9, 7.3, 7.4, 8, 8.6, 8.7, 9.1, 9.2, 9.3]) {
      const r = computeVariance(claimed, 8);
      const bin = varianceBin(r.variance as number);
      const binIsBreach = bin === "under-3" || bin === "under-2" || bin === "over-2" || bin === "over-3";
      expect(binIsBreach).toBe(r.state === "breach");
      expect(bin === "zero").toBe(r.state === "ok");
    }
  });

  it("legend labels come from the policy numbers", () => {
    expect(legendBins().map((b) => b.label)).toEqual(["<= -30%", "<= -15%", "<= -8%", "within 8%", ">= +8%", ">= +15%", ">= +30%"]);
  });
});
