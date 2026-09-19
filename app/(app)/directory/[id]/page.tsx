import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Notice, PageHeader, Panel, StatTile, type Tone } from "@/components/ui";
import { msToDay, WorkCalendar } from "@/lib/analysis/calendar";
import { buildMemberTimeline, summarizeTimeline, type TimelineDay } from "@/lib/analysis/member-timeline";
import { requireMinRole } from "@/lib/auth/session";
import { hasMinRole } from "@/lib/auth/roles";
import { getVarianceSource, listHolidays } from "@/lib/data/analysis";
import { getDirectoryMember, listMemberReports } from "@/lib/data/directory";
import { ARRANGEMENT_LABEL, fmtDateTime, fmtDay, fmtHours, fmtPct, SHIFT_LABEL, STATUS_LABEL } from "@/lib/format";
import { POLICY } from "@/lib/policy";
import { serverNow } from "@/lib/server/clock";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "Member" };

const FILING: Record<TimelineDay["filing"], { label: string; cls: string; tone: Tone }> = {
  on_time: { label: "On time", cls: "bg-ok", tone: "ok" },
  late: { label: "Late", cls: "bg-[#c98a00]", tone: "warn" },
  missing: { label: "Missing", cls: "bg-bad", tone: "bad" },
  not_expected: { label: "Not expected", cls: "bg-line", tone: "neutral" },
};

export default async function MemberPage({ params }: PageProps<"/directory/[id]">) {
  const user = await requireMinRole("viewer");
  const { id } = await params;
  const memberId = Number(id);
  if (!Number.isInteger(memberId) || memberId <= 0) notFound();

  const db = createServiceClient();
  const member = await getDirectoryMember(db, memberId);
  if (!member) notFound();

  // Hours and filing history are compliance data: leads and above only, and a
  // lead only for their own teams. A viewer gets the profile card alone.
  const canSeeHistory = hasMinRole(user.role, "lead") && (user.teamScope === null || user.teamScope.includes(member.team_id));

  let timeline: TimelineDay[] = [];
  if (canSeeHistory && member.files_reports) {
    const calendar = new WorkCalendar(await listHolidays(db));
    const days = calendar.lastWorkingDays(msToDay(serverNow().getTime()), 30);
    const [reports, source] = await Promise.all([
      listMemberReports(db, memberId, days[0], days[days.length - 1]),
      getVarianceSource(db, days[0], days[days.length - 1], memberId),
    ]);
    timeline = buildMemberTimeline({
      days,
      calendar,
      reports,
      timers: source.timers.map(([, s, e]) => ({ start: s * 1000, end: e * 1000 })),
      hiredOn: member.hired_on,
      expectReports: member.status === "active",
    });
  }
  const summary = summarizeTimeline(timeline);

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/directory" className="text-accent-strong underline-offset-2 hover:underline">
          Directory
        </Link>
        <span className="text-ink-3"> / {member.full_name}</span>
      </p>
      <PageHeader
        eyebrow={member.team_name}
        title={member.full_name}
        description={`${member.position}, ${member.client_label}`}
        actions={<Badge tone={member.status === "active" ? "ok" : member.status === "on_leave" ? "warn" : "neutral"}>{STATUS_LABEL[member.status]}</Badge>}
      />

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Panel title="Profile">
          <dl className="space-y-2.5 text-sm">
            <Row label="Email" value={member.email} />
            <Row label="Team" value={`${member.team_name} (${member.team_code})`} />
            <Row label="Lead / approver" value={member.lead_member_id === member.member_id ? "Leads this team" : (member.lead_name ?? "-")} />
            <Row label="Shift" value={SHIFT_LABEL[member.shift]} />
            <Row label="Work arrangement" value={ARRANGEMENT_LABEL[member.work_arrangement]} />
            <Row label="Hired" value={fmtDay(member.hired_on)} />
            <Row label="Files daily reports" value={member.files_reports ? "Yes" : "No (approver)"} />
          </dl>
        </Panel>

        <div className="space-y-5">
          {!canSeeHistory ? (
            <Notice tone="info">
              Filing history and hours are visible to leads for their own teams, and to managers and above. The {user.role} tier
              sees the profile only.
            </Notice>
          ) : !member.files_reports ? (
            <Notice tone="info">Approvers do not file daily reports, so there is no filing history to show.</Notice>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile
                  label="Filed on time, 30 working days"
                  value={fmtPct(summary.onTimeRate, 0)}
                  detail={`${summary.onTime} on time, ${summary.late} late, ${summary.missing} missing`}
                  tone={summary.onTimeRate !== null && summary.onTimeRate >= 0.9 ? "ok" : "warn"}
                />
                <StatTile label="Variance breaches" value={summary.breaches} detail={`At or past ${POLICY.varianceBreach * 100}% either way`} tone={summary.breaches > 3 ? "bad" : "neutral"} />
                <StatTile label="Filing cutoff" value="10:00" detail="UTC, next working day" tone="neutral" />
              </div>

              <Panel title="Filing timeliness" aside="One block per working day, oldest first">
                <ol className="flex flex-wrap gap-[3px]" aria-label="Filing timeliness by day">
                  {timeline.map((d) => (
                    <li
                      key={d.day}
                      title={`${fmtDay(d.day)}: ${FILING[d.filing].label}${d.filedAt ? `, filed ${fmtDateTime(d.filedAt)}` : ""}`}
                      className={`h-7 w-5 rounded-[2px] ${FILING[d.filing].cls}`}
                    >
                      <span className="sr-only">
                        {fmtDay(d.day)} {FILING[d.filing].label}
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-2">
                  {(Object.keys(FILING) as TimelineDay["filing"][]).map((k) => (
                    <span key={k} className="flex items-center gap-1.5">
                      <span aria-hidden className={`h-2.5 w-2.5 rounded-[1px] ${FILING[k].cls}`} /> {FILING[k].label}
                    </span>
                  ))}
                </div>
              </Panel>

              <Panel title="Variance, claimed against tracked" aside={`Dashed lines: the ${POLICY.varianceBreach * 100}% breach line`}>
                <Sparkline days={timeline} />
              </Panel>

              <Panel title="Day by day" flush>
                <div className="max-h-96 overflow-auto">
                  <table className="table">
                    <thead className="sticky top-0">
                      <tr>
                        <th>Day</th>
                        <th>Filing</th>
                        <th className="r">Claimed</th>
                        <th className="r">Tracked</th>
                        <th className="r">Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...timeline].reverse().map((d) => (
                        <tr key={d.day}>
                          <td className="num whitespace-nowrap">{fmtDay(d.day)}</td>
                          <td>
                            <Badge tone={FILING[d.filing].tone}>{FILING[d.filing].label}</Badge>
                          </td>
                          <td className="r num">{fmtHours(d.claimed)}</td>
                          <td className="r num">{fmtHours(d.tracked)}</td>
                          <td className={`r num ${d.varianceState === "breach" ? "font-semibold text-bad" : ""}`}>{fmtPct(d.variance, 1, true)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line pb-2 last:border-0 last:pb-0">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function Sparkline({ days }: { days: TimelineDay[] }) {
  const W = 600;
  const H = 90;
  const LIMIT = 0.45;
  const b = POLICY.varianceBreach;
  const x = (i: number) => (days.length <= 1 ? W / 2 : (i / (days.length - 1)) * (W - 12) + 6);
  const y = (v: number) => H / 2 - (Math.max(-LIMIT, Math.min(LIMIT, v)) / LIMIT) * (H / 2 - 6);

  // Break the line wherever a day has no comparable value.
  const segments: string[] = [];
  let current = "";
  days.forEach((d, i) => {
    if (d.variance === null) {
      if (current) segments.push(current);
      current = "";
    } else {
      current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(d.variance).toFixed(1)} `;
    }
  });
  if (current) segments.push(current);

  const comparable = days.filter((d) => d.variance !== null).length;
  if (comparable === 0) return <p className="text-sm text-ink-2">No day in this window has both a report and timer data.</p>;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Variance over ${days.length} working days, ${comparable} comparable`}>
      <rect x={0} y={0} width={W} height={y(b)} className="fill-bad-soft" opacity={0.5} />
      <rect x={0} y={y(-b)} width={W} height={H - y(-b)} className="fill-bad-soft" opacity={0.5} />
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="stroke-line-strong" vectorEffect="non-scaling-stroke" />
      {[b, -b].map((v) => (
        <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} className="stroke-bad" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      ))}
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" className="stroke-accent" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      ))}
      {days.map((d, i) =>
        d.variance === null ? null : (
          <circle key={d.day} cx={x(i)} cy={y(d.variance)} r={d.varianceState === "breach" ? 3.5 : 2} className={d.varianceState === "breach" ? "fill-bad" : "fill-accent"}>
            <title>{`${fmtDay(d.day)}: ${fmtPct(d.variance, 1, true)}`}</title>
          </circle>
        ),
      )}
    </svg>
  );
}
