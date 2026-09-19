/** Per-member view of the last N working days: filing timeliness plus variance. Pure. */
import type { Day, WorkCalendar } from "./calendar";
import { trackedHoursByDay, type Interval } from "./intervals";
import { computeVariance, type CellState } from "./variance";
import { filedOnTime } from "../sla/sla";

export type FilingState = "on_time" | "late" | "missing" | "not_expected";

export interface TimelineDay {
  day: Day;
  filing: FilingState;
  filedAt: string | null;
  variance: number | null;
  varianceState: CellState;
  claimed: number | null;
  tracked: number | null;
}

export interface TimelineInput {
  days: readonly Day[];
  reports: readonly { report_date: Day; hours_claimed: number; filed_at: string }[];
  timers: readonly Interval[];
  calendar: WorkCalendar;
  /** Days before this date are "not expected" (not hired yet). */
  hiredOn?: Day | null;
  /** On leave or inactive members are not expected to file on days with no activity. */
  expectReports?: boolean;
}

export function buildMemberTimeline(input: TimelineInput): TimelineDay[] {
  const byDay = new Map(input.reports.map((r) => [r.report_date, r]));
  const tracked = trackedHoursByDay(input.timers);
  const expect = input.expectReports ?? true;

  return input.days.map((day) => {
    const report = byDay.get(day);
    const trackedHours = tracked.get(day) ?? null;
    const v = computeVariance(report ? report.hours_claimed : null, trackedHours);

    let filing: FilingState;
    if (report) {
      filing = filedOnTime(report.filed_at, input.calendar.nextWorkingDay(day)) ? "on_time" : "late";
    } else if ((input.hiredOn && day < input.hiredOn) || (!expect && v.state === "none")) {
      filing = "not_expected";
    } else {
      filing = "missing";
    }
    return {
      day,
      filing,
      filedAt: report?.filed_at ?? null,
      variance: v.variance,
      varianceState: v.state,
      claimed: v.claimed,
      tracked: v.tracked,
    };
  });
}

export interface TimelineSummary {
  expected: number;
  onTime: number;
  late: number;
  missing: number;
  onTimeRate: number | null;
  breaches: number;
}

export function summarizeTimeline(days: readonly TimelineDay[]): TimelineSummary {
  const expected = days.filter((d) => d.filing !== "not_expected").length;
  const onTime = days.filter((d) => d.filing === "on_time").length;
  return {
    expected,
    onTime,
    late: days.filter((d) => d.filing === "late").length,
    missing: days.filter((d) => d.filing === "missing").length,
    onTimeRate: expected ? onTime / expected : null,
    breaches: days.filter((d) => d.varianceState === "breach").length,
  };
}
