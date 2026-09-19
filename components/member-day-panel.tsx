"use client";

import { useEffect, useState } from "react";
import { mergeIntervals, splitAtMidnight, totalMs } from "@/lib/analysis/intervals";
import { computeVariance } from "@/lib/analysis/variance";
import type { MemberDayDetail } from "@/lib/data/approvals";
import { fmtDateTime, fmtHours, fmtPct, fmtTime } from "@/lib/format";
import { POLICY } from "@/lib/policy";
import { Badge, Notice } from "./ui";

type LoadState = { key: string; status: "ready"; detail: MemberDayDetail } | { key: string; status: "error"; message: string };

/** Loads and shows one member-day: the report's task lines beside the timer timeline. */
export function MemberDayPanel({ memberId, day }: { memberId: number; day: string }) {
  const key = `${memberId}|${day}`;
  const [state, setState] = useState<LoadState | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/member-day?member=${memberId}&date=${day}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "Could not load this day.");
        setState({ key, status: "ready", detail: body as MemberDayDetail });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ key, status: "error", message: error instanceof Error ? error.message : "Could not load this day." });
      });
    return () => controller.abort();
  }, [memberId, day, key]);

  if (!state || state.key !== key) {
    return (
      <div aria-busy="true" className="space-y-3">
        <span className="sr-only">Loading</span>
        <div className="skeleton h-16" />
        <div className="skeleton h-28" />
        <div className="skeleton h-40" />
      </div>
    );
  }
  if (state.status === "error") return <Notice tone="bad">{state.message}</Notice>;
  return <MemberDayView detail={state.detail} day={day} />;
}

const DAY_MS = 86_400_000;

function MemberDayView({ detail, day }: { detail: MemberDayDetail; day: string }) {
  const dayStart = Date.parse(`${day}T00:00:00Z`);
  const dayEnd = dayStart + DAY_MS;

  const raw = detail.timer_entries.map((e) => ({ start: Date.parse(e.started_at), end: Date.parse(e.ended_at) }));
  // Same rule as the heatmap: merge overlaps, split at midnight, keep this day's part.
  const mergedToday = mergeIntervals(raw)
    .flatMap(splitAtMidnight)
    .filter((i) => i.start >= dayStart && i.end <= dayEnd);
  const trackedHours = totalMs(mergedToday) / 3_600_000;
  const naiveHours = raw.reduce((sum, i) => sum + (i.end - i.start), 0) / 3_600_000;
  const overlapHours = Math.max(0, naiveHours - totalMs(mergeIntervals(raw)) / 3_600_000);

  const result = computeVariance(detail.report ? detail.report.hours_claimed : null, trackedHours);
  const tone = result.state === "breach" ? "bad" : result.state === "watch" ? "warn" : result.state === "ok" ? "ok" : "neutral";

  // Timeline axis: from the earliest activity (at most 05:00) to the latest (at least 20:00).
  const firstMs = raw.length ? Math.min(...raw.map((i) => Math.max(i.start, dayStart))) : dayStart + 6 * 3_600_000;
  const lastMs = raw.length ? Math.max(...raw.map((i) => Math.min(i.end, dayEnd))) : dayStart + 20 * 3_600_000;
  const axisStart = Math.min(dayStart + 5 * 3_600_000, Math.floor(firstMs / 3_600_000) * 3_600_000);
  const axisEnd = Math.max(dayStart + 20 * 3_600_000, Math.ceil(lastMs / 3_600_000) * 3_600_000);
  const span = axisEnd - axisStart;
  const pos = (ms: number) => `${((Math.min(Math.max(ms, axisStart), axisEnd) - axisStart) / span) * 100}%`;
  const ticks: number[] = [];
  for (let t = axisStart; t <= axisEnd; t += 3 * 3_600_000) ticks.push(t);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-line bg-line">
        <Figure label="Claimed" value={detail.report ? `${fmtHours(detail.report.hours_claimed)} h` : "No report"} />
        <Figure label="Tracked" value={trackedHours > 0 ? `${fmtHours(trackedHours)} h` : "No timer"} />
        <Figure
          label="Variance"
          value={result.variance === null ? "-" : fmtPct(result.variance, 1, true)}
          badge={
            <Badge tone={tone}>
              {result.state === "breach"
                ? `Breach (${POLICY.varianceBreach * 100}% line)`
                : result.state === "watch"
                  ? "Watch"
                  : result.state === "ok"
                    ? "Within line"
                    : result.state === "missing_report"
                      ? "Missing report"
                      : result.state === "missing_timer"
                        ? "Missing timer"
                        : "Nothing recorded"}
            </Badge>
          }
        />
      </div>

      <section>
        <h3 className="eyebrow mb-2">Daily report</h3>
        {detail.report ? (
          <>
            <p className="mb-2 text-sm text-ink-2">
              Filed {fmtDateTime(detail.report.filed_at)} UTC.{" "}
              {detail.report.status === "approved"
                ? `Approved ${detail.report.approved_at ? fmtDateTime(detail.report.approved_at) : ""}.`
                : "Awaiting approval."}
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Client</th>
                  <th className="r">Hours</th>
                </tr>
              </thead>
              <tbody>
                {detail.task_lines.map((line) => (
                  <tr key={line.line_no}>
                    <td>{line.task_name}</td>
                    <td className="text-ink-2">{line.client_label}</td>
                    <td className="r num">{fmtHours(line.hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <Notice tone="warn">No daily report was filed for this day.</Notice>
        )}
      </section>

      <section>
        <h3 className="eyebrow mb-2">Timer entries</h3>
        {detail.timer_entries.length === 0 ? (
          <Notice tone="warn">No timer entries touch this day.</Notice>
        ) : (
          <>
            <div className="rounded-sm border border-line bg-sunken px-3 pb-2 pt-3">
              <div className="relative h-9" role="img" aria-label={`Timeline of ${detail.timer_entries.length} timer entries`}>
                {ticks.map((t) => (
                  <span key={t} aria-hidden className="absolute inset-y-0 w-px bg-line-strong/60" style={{ left: pos(t) }} />
                ))}
                {/* merged coverage underneath, raw entries on top so overlaps show as darker bands */}
                {mergedToday.map((i) => (
                  <span
                    key={`m${i.start}`}
                    aria-hidden
                    className="absolute top-1 h-7 rounded-[2px] bg-accent/25"
                    style={{ left: pos(i.start), width: `calc(${pos(i.end)} - ${pos(i.start)})` }}
                  />
                ))}
                {raw.map((i, idx) => (
                  <span
                    key={`r${idx}`}
                    aria-hidden
                    className="absolute top-2.5 h-4 rounded-[2px] bg-accent/60 mix-blend-multiply"
                    style={{ left: pos(i.start), width: `calc(${pos(i.end)} - ${pos(i.start)})` }}
                  />
                ))}
              </div>
              <div className="relative mt-1 h-4">
                {ticks.map((t) => (
                  <span key={t} className="num absolute -translate-x-1/2 text-[0.68rem] text-ink-3" style={{ left: pos(t) }}>
                    {fmtTime(t)}
                  </span>
                ))}
              </div>
            </div>
            {overlapHours > 0.01 ? (
              <p className="mt-2 text-xs text-ink-2">
                Two timers overlapped for {fmtHours(overlapHours)} h. Overlapping time is counted once, so tracked hours are
                lower than the {fmtHours(naiveHours)} h a plain sum would give.
              </p>
            ) : null}
            <table className="table mt-3">
              <thead>
                <tr>
                  <th>Start</th>
                  <th>End</th>
                  <th>Task</th>
                  <th className="r">Hours</th>
                </tr>
              </thead>
              <tbody>
                {detail.timer_entries.map((e) => {
                  const start = Date.parse(e.started_at);
                  const end = Date.parse(e.ended_at);
                  const crosses = start < dayStart || end > dayEnd;
                  return (
                    <tr key={e.id}>
                      <td className="num">{fmtTime(e.started_at)}</td>
                      <td className="num">
                        {fmtTime(e.ended_at)} {crosses ? <Badge tone="info">crosses midnight</Badge> : null}
                      </td>
                      <td>{e.task_name}</td>
                      <td className="r num">{fmtHours((end - start) / 3_600_000)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}

function Figure({ label, value, badge }: { label: string; value: string; badge?: React.ReactNode }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <p className="eyebrow">{label}</p>
      <p className="num mt-0.5 text-lg font-semibold">{value}</p>
      {badge ? <div className="mt-1">{badge}</div> : null}
    </div>
  );
}
