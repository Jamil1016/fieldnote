import "server-only";
import { msToDay, WorkCalendar } from "../analysis/calendar";
import { assessFreshness, lastSuccessfulRun, type Freshness } from "../analysis/freshness";
import { breachTrend, buildAnalysis, type AnalysisMember, type AnalysisResult, type Trend } from "../analysis/heatmap";
import { getVarianceSource, listHolidays, listRecentPipelineRuns } from "../data/analysis";
import type { Db } from "../data/db";
import { listDirectory } from "../data/directory";
import { POLICY } from "../policy";

export interface LoadedAnalysis {
  current: AnalysisResult;
  prior: AnalysisResult;
  trend: Trend;
  freshness: Freshness;
  teams: { teamId: number; teamName: string }[];
}

/**
 * Fetches the raw rows and hands them to the pure functions in lib/analysis.
 * All database access for the analysis page and its CSV export is here; the
 * maths has none.
 */
export async function loadAnalysis(db: Db, options: { teamScope: number[] | null; now: Date }): Promise<LoadedAnalysis> {
  const window = POLICY.analysisWindowDays;
  const [directory, holidays, runs] = await Promise.all([listDirectory(db), listHolidays(db), listRecentPipelineRuns(db, 12)]);

  const calendar = new WorkCalendar(holidays);
  const days = calendar.lastWorkingDays(msToDay(options.now.getTime()), window * 2);
  const priorDays = days.slice(0, window);
  const currentDays = days.slice(window);

  const members: AnalysisMember[] = directory
    .filter((d) => d.files_reports && (options.teamScope === null || options.teamScope.includes(d.team_id)))
    .map((d) => ({ memberId: d.member_id, name: d.full_name, teamId: d.team_id, teamName: d.team_name }));

  const source = await getVarianceSource(db, days[0], days[days.length - 1]);
  const current = buildAnalysis({ members, reports: source.reports, timers: source.timers, days: currentDays });
  const prior = buildAnalysis({ members, reports: source.reports, timers: source.timers, days: priorDays });

  return {
    current,
    prior,
    trend: breachTrend(current.summary.breachRate, prior.summary.breachRate),
    freshness: assessFreshness(lastSuccessfulRun(runs), options.now),
    teams: current.groups.map((g) => ({ teamId: g.teamId, teamName: g.teamName })),
  };
}

export function parseTeamParam(value: string | string[] | undefined | null): number | null {
  if (typeof value !== "string") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
