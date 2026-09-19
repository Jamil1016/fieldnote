import { describe, expect, it } from "vitest";
import { WorkCalendar } from "./calendar";
import { buildMemberTimeline, summarizeTimeline } from "./member-timeline";

const cal = new WorkCalendar([]);
const days = ["2025-03-03", "2025-03-04", "2025-03-05", "2025-03-06", "2025-03-07"];
const timer = (day: string, hours: number) => ({
  start: Date.parse(`${day}T08:00:00Z`),
  end: Date.parse(`${day}T08:00:00Z`) + hours * 3_600_000,
});

const timeline = buildMemberTimeline({
  days,
  calendar: cal,
  reports: [
    { report_date: "2025-03-03", hours_claimed: 8, filed_at: "2025-03-03T18:00:00Z" },
    { report_date: "2025-03-04", hours_claimed: 8, filed_at: "2025-03-05T11:30:00Z" },
    { report_date: "2025-03-07", hours_claimed: 10, filed_at: "2025-03-09T20:00:00Z" },
  ],
  timers: [timer("2025-03-03", 8), timer("2025-03-04", 8), timer("2025-03-05", 8), timer("2025-03-07", 8)],
  hiredOn: null,
});

describe("buildMemberTimeline", () => {
  it("marks a same-evening report as on time", () => {
    expect(timeline[0].filing).toBe("on_time");
  });

  it("marks a report filed after 10:00 the next working day as late", () => {
    expect(timeline[1].filing).toBe("late");
  });

  it("marks a day with no report as missing", () => {
    expect(timeline[2].filing).toBe("missing");
    expect(timeline[2].varianceState).toBe("missing_report");
  });

  it("a Friday report filed on Sunday is on time (due Monday 10:00)", () => {
    expect(timeline[4].filing).toBe("on_time");
  });

  it("carries the variance for each day", () => {
    expect(timeline[0].variance).toBe(0);
    expect(timeline[4].variance).toBeCloseTo(0.25);
    expect(timeline[4].varianceState).toBe("breach");
  });

  it("does not expect reports before the hire date", () => {
    const t = buildMemberTimeline({ days, calendar: cal, reports: [], timers: [], hiredOn: "2025-03-05" });
    expect(t.map((d) => d.filing)).toEqual(["not_expected", "not_expected", "missing", "missing", "missing"]);
  });

  it("does not expect reports from someone on leave with no activity", () => {
    const t = buildMemberTimeline({ days, calendar: cal, reports: [], timers: [timer("2025-03-03", 4)], expectReports: false });
    expect(t[0].filing).toBe("missing");
    expect(t[1].filing).toBe("not_expected");
  });

  it("summarises the window", () => {
    expect(summarizeTimeline(timeline)).toEqual({ expected: 5, onTime: 2, late: 1, missing: 2, onTimeRate: 0.4, breaches: 1 });
  });

  it("has no rate when nothing was expected", () => {
    expect(summarizeTimeline([]).onTimeRate).toBeNull();
  });
});
