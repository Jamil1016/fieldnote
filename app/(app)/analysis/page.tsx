import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { Heatmap, HeatmapLegend } from "@/components/analysis/heatmap";
import { TeamBoxplot } from "@/components/analysis/team-boxplot";
import { Badge, buttonClass, EmptyState, Notice, PageHeader, Panel, StatTile } from "@/components/ui";
import { filterGroups, summarize } from "@/lib/analysis/heatmap";
import { requireMinRole } from "@/lib/auth/session";
import { fmtAge, fmtDateTime, fmtDay, fmtPct } from "@/lib/format";
import { POLICY } from "@/lib/policy";
import { loadAnalysis, parseTeamParam } from "@/lib/server/analysis-loader";
import { serverNow } from "@/lib/server/clock";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "Hours variance" };

export default async function AnalysisPage({ searchParams }: PageProps<"/analysis">) {
  const user = await requireMinRole("lead");
  const params = await searchParams;
  const teamId = parseTeamParam(params.team);

  const analysis = await loadAnalysis(createServiceClient(), { teamScope: user.teamScope, now: serverNow() });
  const groups = filterGroups(analysis.current.groups, teamId);
  const summary = teamId === null ? analysis.current.summary : summarize(groups);
  const { freshness, trend } = analysis;
  const days = analysis.current.days;

  const trendText =
    trend.deltaPoints === null
      ? "No prior data to compare"
      : `${trend.deltaPoints > 0 ? "+" : ""}${trend.deltaPoints.toFixed(1)} pts vs the prior 6 weeks (${fmtPct(trend.prior)})`;

  return (
    <>
      <PageHeader
        eyebrow="Analysis"
        title="Hours variance"
        description={
          <>
            Hours claimed on the daily report against hours tracked by the timer, per person and working day, for the last
            six weeks. A difference of {POLICY.varianceBreach * 100}% or more either way is a breach. Overlapping timers are
            counted once and entries that cross midnight are split by day.
          </>
        }
        actions={
          <>
            {freshness.state === "live" ? (
              <Badge tone="ok">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
                Live, timer data loaded {fmtAge(freshness.ageHours ?? 0)} ago
              </Badge>
            ) : (
              <Badge tone="bad">Not live</Badge>
            )}
            <a href={`/api/analysis/export${teamId ? `?team=${teamId}` : ""}`} className={buttonClass.secondary}>
              <Download size={14} aria-hidden /> Export CSV
            </a>
          </>
        }
      />

      {freshness.state !== "live" ? (
        <div className="mb-5">
          <Notice tone="bad">
            <strong>Stale data.</strong>{" "}
            {freshness.state === "stale" && freshness.lastSuccessAt
              ? `The last successful timer load finished ${fmtDateTime(freshness.lastSuccessAt)} UTC, ${fmtAge(freshness.ageHours ?? 0)} ago. `
              : "No successful timer load is on record. "}
            This page only calls itself live when the last load is under {freshness.maxAgeHours} hours old, so treat the
            numbers below as a snapshot.
          </Notice>
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Breach rate"
          value={fmtPct(summary.breachRate)}
          detail={`${summary.breaches} of ${summary.comparable} comparable member-days`}
          tone={summary.breachRate !== null && summary.breachRate >= 0.15 ? "bad" : "ok"}
        />
        <StatTile
          label="Worst team"
          value={summary.worstTeam ? fmtPct(summary.worstTeam.breachRate) : "-"}
          detail={summary.worstTeam ? `${summary.worstTeam.teamName}, mean variance ${fmtPct(summary.worstTeam.meanVariance, 1, true)}` : "No comparable days"}
          tone="bad"
        />
        <StatTile
          label="Trend"
          value={trend.direction === "up" ? "Rising" : trend.direction === "down" ? "Falling" : trend.direction === "flat" ? "Flat" : "-"}
          detail={teamId === null ? trendText : `All teams: ${trendText}`}
          tone={trend.direction === "up" ? "warn" : trend.direction === "down" ? "ok" : "neutral"}
        />
        <StatTile
          label="Gaps"
          value={summary.missingReports + summary.missingTimers}
          detail={`${summary.missingReports} missing reports, ${summary.missingTimers} missing timers`}
          tone="info"
        />
      </div>

      <Panel
        title={`Member by working day, ${fmtDay(days[0])} to ${fmtDay(days[days.length - 1])}`}
        aside="Click a cell to compare the report with the timer"
        className="mb-5"
      >
        <nav aria-label="Filter by team" className="mb-4 flex flex-wrap gap-1.5">
          <TeamLink href="/analysis" active={teamId === null} label="All teams" />
          {analysis.teams.map((t) => (
            <TeamLink key={t.teamId} href={`/analysis?team=${t.teamId}`} active={teamId === t.teamId} label={t.teamName} />
          ))}
        </nav>
        <HeatmapLegend />
        {groups.length === 0 ? (
          <EmptyState title="No members in this view">
            {user.teamScope !== null ? "This role only sees the teams it approves." : "Pick another team."}
          </EmptyState>
        ) : (
          <div className="mt-2">
            <Heatmap groups={groups} days={days} />
          </div>
        )}
      </Panel>

      <Panel title="Variance distribution by team" aside="Box: middle half. Whiskers: 1.5 IQR. Dashed lines: breach">
        {analysis.current.summary.teams.length === 0 ? (
          <EmptyState title="Nothing to chart" />
        ) : (
          <TeamBoxplot teams={analysis.current.summary.teams} />
        )}
      </Panel>
    </>
  );
}

function TeamLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`rounded-sm border px-2.5 py-1 text-xs font-medium ${
        active ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink-2 hover:bg-sunken"
      }`}
    >
      {label}
    </Link>
  );
}
