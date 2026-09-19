/**
 * Builds the member x working-day variance grid and its summaries.
 * PURE: takes plain data in, returns plain data out. No database, no clock.
 */
import type { Day } from "./calendar";
import { trackedHoursByDay, type Interval } from "./intervals";
import { boxStats, mean, type BoxStats } from "./stats";
import { computeVariance, type CellState, type Thresholds } from "./variance";

export interface AnalysisMember {
  memberId: number;
  name: string;
  teamId: number;
  teamName: string;
}

/** [memberId, day, hoursClaimed, reportId] as returned by the SQL source. */
export type ReportTuple = readonly [number, Day, number | null, number];
/** [memberId, startEpochSeconds, endEpochSeconds] */
export type TimerTuple = readonly [number, number, number];

export interface AnalysisInput {
  members: readonly AnalysisMember[];
  reports: readonly ReportTuple[];
  timers: readonly TimerTuple[];
  /** The working days to show as columns, oldest first. */
  days: readonly Day[];
  thresholds?: Thresholds;
}

export interface Cell {
  memberId: number;
  day: Day;
  state: CellState;
  variance: number | null;
  claimed: number | null;
  tracked: number | null;
  reportId: number | null;
}

export interface MemberRow {
  member: AnalysisMember;
  cells: Cell[];
  breachCount: number;
  comparableCount: number;
}

export interface TeamGroup {
  teamId: number;
  teamName: string;
  rows: MemberRow[];
}

export interface TeamSummary {
  teamId: number;
  teamName: string;
  comparable: number;
  breaches: number;
  breachRate: number | null;
  meanVariance: number | null;
  box: BoxStats | null;
}

export interface AnalysisSummary {
  comparable: number;
  breaches: number;
  breachRate: number | null;
  missingReports: number;
  missingTimers: number;
  worstTeam: TeamSummary | null;
  teams: TeamSummary[];
}

export interface AnalysisResult {
  days: Day[];
  groups: TeamGroup[];
  summary: AnalysisSummary;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildAnalysis(input: AnalysisInput): AnalysisResult {
  const daySet = new Set(input.days);

  const claimedBy = new Map<string, { hours: number | null; reportId: number }>();
  for (const [memberId, day, hours, reportId] of input.reports) {
    if (!daySet.has(day)) continue;
    claimedBy.set(`${memberId}|${day}`, { hours: hours === null ? null : Number(hours), reportId });
  }

  const intervalsBy = new Map<number, Interval[]>();
  for (const [memberId, startSec, endSec] of input.timers) {
    const list = intervalsBy.get(memberId) ?? [];
    list.push({ start: startSec * 1000, end: endSec * 1000 });
    intervalsBy.set(memberId, list);
  }

  const groupsById = new Map<number, TeamGroup>();
  const sortedMembers = [...input.members].sort(
    (a, b) => a.teamName.localeCompare(b.teamName) || a.name.localeCompare(b.name),
  );

  for (const member of sortedMembers) {
    const tracked = trackedHoursByDay(intervalsBy.get(member.memberId) ?? []);
    const cells: Cell[] = input.days.map((day) => {
      const report = claimedBy.get(`${member.memberId}|${day}`);
      // A report row whose hours are NULL still counts as "a report exists"
      // with zero claimed; a missing row is "no report".
      const claimed = report ? (report.hours ?? 0) : null;
      const result = computeVariance(claimed, tracked.get(day) ?? null, input.thresholds);
      return {
        memberId: member.memberId,
        day,
        state: result.state,
        variance: result.variance,
        claimed: result.claimed === null ? null : round2(result.claimed),
        tracked: result.tracked === null ? null : round2(result.tracked),
        reportId: report?.reportId ?? null,
      };
    });
    const row: MemberRow = {
      member,
      cells,
      breachCount: cells.filter((c) => c.state === "breach").length,
      comparableCount: cells.filter((c) => c.variance !== null).length,
    };
    const group = groupsById.get(member.teamId) ?? { teamId: member.teamId, teamName: member.teamName, rows: [] };
    group.rows.push(row);
    groupsById.set(member.teamId, group);
  }

  const groups = [...groupsById.values()].sort((a, b) => a.teamName.localeCompare(b.teamName));
  return { days: [...input.days], groups, summary: summarize(groups) };
}

export function summarizeTeam(group: TeamGroup): TeamSummary {
  const cells = group.rows.flatMap((r) => r.cells);
  const variances = cells.flatMap((c) => (c.variance === null ? [] : [c.variance]));
  const breaches = cells.filter((c) => c.state === "breach").length;
  return {
    teamId: group.teamId,
    teamName: group.teamName,
    comparable: variances.length,
    breaches,
    breachRate: variances.length ? breaches / variances.length : null,
    meanVariance: mean(variances),
    box: boxStats(variances),
  };
}

export function summarize(groups: readonly TeamGroup[]): AnalysisSummary {
  const teams = groups.map(summarizeTeam);
  const cells = groups.flatMap((g) => g.rows.flatMap((r) => r.cells));
  const comparable = teams.reduce((n, t) => n + t.comparable, 0);
  const breaches = teams.reduce((n, t) => n + t.breaches, 0);
  let worstTeam: TeamSummary | null = null;
  for (const t of teams) {
    if (t.breachRate === null) continue;
    if (!worstTeam || t.breachRate > (worstTeam.breachRate ?? -1)) worstTeam = t;
  }
  return {
    comparable,
    breaches,
    breachRate: comparable ? breaches / comparable : null,
    missingReports: cells.filter((c) => c.state === "missing_report").length,
    missingTimers: cells.filter((c) => c.state === "missing_timer").length,
    worstTeam,
    teams,
  };
}

export interface Trend {
  current: number | null;
  prior: number | null;
  /** Change in percentage points (current - prior), null if either is unknown. */
  deltaPoints: number | null;
  direction: "up" | "down" | "flat" | "unknown";
}

export function breachTrend(current: number | null, prior: number | null): Trend {
  if (current === null || prior === null) {
    return { current, prior, deltaPoints: null, direction: "unknown" };
  }
  const deltaPoints = (current - prior) * 100;
  const direction = Math.abs(deltaPoints) < 0.5 ? "flat" : deltaPoints > 0 ? "up" : "down";
  return { current, prior, deltaPoints, direction };
}

/** Filter helper used by the page and the CSV export so both show the same view. */
export function filterGroups(groups: readonly TeamGroup[], teamId: number | null): TeamGroup[] {
  if (teamId === null) return [...groups];
  return groups.filter((g) => g.teamId === teamId);
}
