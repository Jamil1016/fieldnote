import { describe, expect, it } from "vitest";
import { approvalDueAt, approvedWithinSla, countBuckets, describeRemaining, filedOnTime, filingDeadline, slaStatus } from "./sla";

const filed = new Date("2025-03-03T18:00:00Z");
const hoursAfter = (h: number) => new Date(filed.getTime() + h * 3_600_000);

describe("slaStatus", () => {
  it("is due 48 hours after filing", () => {
    expect(approvalDueAt(filed).toISOString()).toBe("2025-03-05T18:00:00.000Z");
  });

  it.each([
    [0, "on_time"],
    [35.9, "on_time"],
    [36, "due_soon"],
    [47.9, "due_soon"],
    [48, "due_soon"],
    [48.01, "overdue"],
    [200, "overdue"],
  ])("%s hours after filing is %s", (h, bucket) => {
    expect(slaStatus(filed, hoursAfter(h)).bucket).toBe(bucket);
  });

  it("reports hours remaining, negative once overdue", () => {
    expect(slaStatus(filed, hoursAfter(40)).hoursRemaining).toBeCloseTo(8);
    expect(slaStatus(filed, hoursAfter(50)).hoursRemaining).toBeCloseTo(-2);
  });

  it("accepts an ISO string", () => {
    expect(slaStatus("2025-03-03T18:00:00+00:00", hoursAfter(1)).bucket).toBe("on_time");
  });

  it("throws on an invalid filing time", () => {
    expect(() => slaStatus("nope", new Date())).toThrow();
  });

  it("honours a custom rule", () => {
    expect(slaStatus(filed, hoursAfter(5), { slaHours: 4, dueSoonHours: 1 }).bucket).toBe("overdue");
  });

  it("counts buckets", () => {
    const counts = countBuckets([1, 40, 47, 60, 90].map((h) => slaStatus(filed, hoursAfter(h))));
    expect(counts).toEqual({ on_time: 1, due_soon: 2, overdue: 2 });
  });
});

describe("approvedWithinSla", () => {
  it("is true at the deadline and false after it", () => {
    expect(approvedWithinSla(filed, hoursAfter(48))).toBe(true);
    expect(approvedWithinSla(filed, hoursAfter(48.5))).toBe(false);
  });
});

describe("describeRemaining", () => {
  it.each([
    [30.5, "1d 6h left"],
    [5.2, "5h left"],
    [0.5, "30m left"],
    [-3, "overdue 3h"],
    [-51, "overdue 2d 3h"],
  ])("%s hours reads %s", (h, text) => {
    expect(describeRemaining(h)).toBe(text);
  });
});

describe("filing timeliness", () => {
  it("the deadline is 10:00 UTC on the next working day", () => {
    expect(filingDeadline("2025-03-04").toISOString()).toBe("2025-03-04T10:00:00.000Z");
  });

  it("filed the same evening is on time", () => {
    expect(filedOnTime("2025-03-03T18:20:00Z", "2025-03-04")).toBe(true);
  });

  it("filed at the cutoff is on time, a minute later is late", () => {
    expect(filedOnTime("2025-03-04T10:00:00Z", "2025-03-04")).toBe(true);
    expect(filedOnTime("2025-03-04T10:01:00Z", "2025-03-04")).toBe(false);
  });

  it("a Friday report filed on Sunday is on time when Monday is the next working day", () => {
    expect(filedOnTime("2025-03-09T21:00:00Z", "2025-03-10")).toBe(true);
  });
});
