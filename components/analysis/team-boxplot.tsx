import type { TeamSummary } from "@/lib/analysis/heatmap";
import { fmtPct } from "@/lib/format";
import { POLICY } from "@/lib/policy";

const DOMAIN = 0.5; // axis runs from -50% to +50%; anything beyond is pinned to the edge
const WIDTH = 600;
const ROW = 30;

function x(v: number): number {
  const clamped = Math.min(DOMAIN, Math.max(-DOMAIN, v));
  return ((clamped + DOMAIN) / (2 * DOMAIN)) * WIDTH;
}

/** One box plot per team on a shared axis, with the breach lines drawn in. Server-rendered SVG. */
export function TeamBoxplot({ teams }: { teams: TeamSummary[] }) {
  const ticks = [-0.45, -0.3, -0.15, 0, 0.15, 0.3, 0.45];
  const b = POLICY.varianceBreach;
  return (
    <div className="grid grid-cols-[minmax(110px,160px)_minmax(0,1fr)_auto] items-center gap-x-4">
      {teams.map((team) => (
        <div key={team.teamId} className="contents">
          <div className="truncate text-[0.88rem] font-medium">{team.teamName}</div>
          <svg
            viewBox={`0 0 ${WIDTH} ${ROW}`}
            preserveAspectRatio="none"
            className="h-[30px] w-full"
            role="img"
            aria-label={
              team.box
                ? `${team.teamName}: median ${fmtPct(team.box.median, 1, true)}, middle half from ${fmtPct(team.box.q1, 1, true)} to ${fmtPct(team.box.q3, 1, true)}`
                : `${team.teamName}: no comparable days`
            }
          >
            <rect x={0} y={0} width={x(-b)} height={ROW} className="fill-bad-soft" opacity={0.55} />
            <rect x={x(b)} y={0} width={WIDTH - x(b)} height={ROW} className="fill-bad-soft" opacity={0.55} />
            <line x1={x(0)} x2={x(0)} y1={0} y2={ROW} className="stroke-line-strong" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {[-b, b].map((v) => (
              <line key={v} x1={x(v)} x2={x(v)} y1={0} y2={ROW} className="stroke-bad" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            ))}
            {team.box ? (
              <>
                <line x1={x(team.box.whiskerLow)} x2={x(team.box.whiskerHigh)} y1={ROW / 2} y2={ROW / 2} className="stroke-ink-2" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
                {[team.box.whiskerLow, team.box.whiskerHigh].map((v, i) => (
                  <line key={i} x1={x(v)} x2={x(v)} y1={ROW / 2 - 5} y2={ROW / 2 + 5} className="stroke-ink-2" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
                ))}
                <rect
                  x={x(team.box.q1)}
                  y={6}
                  width={Math.max(2, x(team.box.q3) - x(team.box.q1))}
                  height={ROW - 12}
                  className="fill-accent-soft stroke-accent"
                  strokeWidth={1.25}
                  vectorEffect="non-scaling-stroke"
                />
                <line x1={x(team.box.median)} x2={x(team.box.median)} y1={4} y2={ROW - 4} className="stroke-accent-strong" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                {team.box.outliers.slice(0, 80).map((v, i) => (
                  <line key={i} x1={x(v)} x2={x(v)} y1={ROW / 2 - 3} y2={ROW / 2 + 3} className="stroke-ink-3" strokeWidth={2} opacity={0.5} vectorEffect="non-scaling-stroke" />
                ))}
              </>
            ) : null}
          </svg>
          <div className="num whitespace-nowrap text-right text-xs text-ink-2">
            median <span className="font-semibold text-ink">{team.box ? fmtPct(team.box.median, 1, true) : "-"}</span>
            <span className="ml-3">
              breach <span className={`font-semibold ${team.breachRate !== null && team.breachRate >= 0.25 ? "text-bad" : "text-ink"}`}>{fmtPct(team.breachRate)}</span>
            </span>
          </div>
        </div>
      ))}
      <div />
      <div className="relative mt-1 h-4">
        {ticks.map((t) => (
          <span key={t} className="num absolute -translate-x-1/2 text-[0.68rem] text-ink-3" style={{ left: `${(x(t) / WIDTH) * 100}%` }}>
            {fmtPct(t, 0, true)}
          </span>
        ))}
      </div>
      <div />
    </div>
  );
}
