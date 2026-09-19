"use client";

import { Fragment, useState } from "react";
import type { Cell, TeamGroup } from "@/lib/analysis/heatmap";
import { fmtDay, fmtDayShort, fmtHours, fmtPct } from "@/lib/format";
import { legendBins, varianceBin, type VarianceBin } from "@/lib/analysis/scale";
import { Drawer } from "../drawer";
import { MemberDayPanel } from "../member-day-panel";

const BIN_CLASS: Record<VarianceBin, string> = {
  "under-3": "bg-hm-under-3",
  "under-2": "bg-hm-under-2",
  "under-1": "bg-hm-under-1",
  zero: "bg-hm-zero",
  "over-1": "bg-hm-over-1",
  "over-2": "bg-hm-over-2",
  "over-3": "bg-hm-over-3",
};

function cellClass(cell: Cell): string {
  if (cell.variance !== null) return BIN_CLASS[varianceBin(cell.variance)];
  if (cell.state === "missing_report") return "hatch ring-1 ring-inset ring-ink-2";
  if (cell.state === "missing_timer") return "bg-surface border border-dashed border-ink-2";
  return "bg-transparent";
}

function cellLabel(name: string, cell: Cell): string {
  const day = fmtDay(cell.day);
  switch (cell.state) {
    case "missing_report":
      return `${name}, ${day}: no report filed, ${fmtHours(cell.tracked)} hours tracked`;
    case "missing_timer":
      return `${name}, ${day}: ${fmtHours(cell.claimed)} hours claimed, no timer data`;
    case "none":
      return `${name}, ${day}: nothing recorded`;
    default:
      return `${name}, ${day}: claimed ${fmtHours(cell.claimed)}, tracked ${fmtHours(cell.tracked)}, variance ${fmtPct(cell.variance, 1, true)}${cell.state === "breach" ? ", breach" : ""}`;
  }
}

function isoWeekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

export function Heatmap({ groups, days }: { groups: TeamGroup[]; days: string[] }) {
  const [open, setOpen] = useState<{ memberId: number; name: string; team: string; day: string } | null>(null);
  const [hoverDay, setHoverDay] = useState<string | null>(null);

  const weekStart = days.map((d, i) => i === 0 || isoWeekKey(d) !== isoWeekKey(days[i - 1]));

  return (
    <>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0 text-xs" aria-label="Hours variance by member and working day">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 min-w-[168px] bg-surface" />
              {days.map((d, i) => (
                <th key={d} scope="col" className={`h-9 p-0 align-bottom font-normal ${weekStart[i] ? "pl-2" : "pl-[2px]"}`}>
                  <div className="relative flex h-9 w-[22px] flex-col items-center justify-end">
                    {weekStart[i] ? (
                      <span className="absolute left-0 top-0 whitespace-nowrap text-[0.66rem] font-semibold uppercase tracking-wider text-ink-3">
                        {fmtDayShort(d)}
                      </span>
                    ) : null}
                    <span className={`num text-[0.68rem] ${hoverDay === d ? "font-semibold text-ink" : "text-ink-3"}`}>{d.slice(8)}</span>
                  </div>
                </th>
              ))}
              <th scope="col" className="pl-3 text-right align-bottom text-[0.66rem] font-semibold uppercase tracking-wider text-ink-3">
                Breaches
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const comparable = group.rows.reduce((n, r) => n + r.comparableCount, 0);
              const breaches = group.rows.reduce((n, r) => n + r.breachCount, 0);
              const rate = comparable ? breaches / comparable : null;
              return (
                <Fragment key={group.teamId}>
                  <tr>
                    <th scope="colgroup" colSpan={days.length + 2} className="sticky left-0 bg-surface pb-1 pt-4 text-left">
                      <span className="text-[0.82rem] font-semibold tracking-tight text-ink">{group.teamName}</span>
                      <span className="ml-2 font-normal text-ink-3">
                        {group.rows.length} people, breach rate{" "}
                        <span className={`num font-semibold ${rate !== null && rate >= 0.25 ? "text-bad" : "text-ink-2"}`}>{fmtPct(rate)}</span>
                      </span>
                    </th>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.member.memberId} className="group">
                      <th
                        scope="row"
                        className="sticky left-0 z-10 max-w-[168px] truncate bg-surface py-[1px] pr-3 text-left text-[0.82rem] font-normal text-ink-2 group-hover:text-ink"
                      >
                        {row.member.name}
                      </th>
                      {row.cells.map((cell, i) => (
                        <td key={cell.day} className={`p-0 py-[1px] ${weekStart[i] ? "pl-2" : "pl-[2px]"}`}>
                          <button
                            type="button"
                            aria-label={cellLabel(row.member.name, cell)}
                            title={cellLabel(row.member.name, cell)}
                            onMouseEnter={() => setHoverDay(cell.day)}
                            onMouseLeave={() => setHoverDay(null)}
                            onClick={() => setOpen({ memberId: row.member.memberId, name: row.member.name, team: group.teamName, day: cell.day })}
                            className={`relative block h-[22px] w-[22px] rounded-[2px] transition-transform hover:z-10 hover:scale-125 hover:ring-2 hover:ring-ink focus-visible:z-10 ${cellClass(cell)}`}
                          >
                            {cell.state === "none" ? (
                              <span aria-hidden className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-line-strong" />
                            ) : null}
                          </button>
                        </td>
                      ))}
                      <td className={`num pl-3 text-right ${row.breachCount >= 10 ? "font-semibold text-bad" : row.breachCount > 0 ? "text-ink" : "text-ink-3"}`}>
                        {row.breachCount}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <Drawer
        open={open !== null}
        title={open?.name ?? ""}
        subtitle={open ? `${open.team} · ${fmtDay(open.day)}` : null}
        onClose={() => setOpen(null)}
      >
        {open ? <MemberDayPanel memberId={open.memberId} day={open.day} /> : null}
      </Drawer>
    </>
  );
}

export function HeatmapLegend() {
  const bins = legendBins();
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-ink-2">
      <div className="flex items-center gap-2">
        <span>Claimed under tracked</span>
        <div className="flex">
          {bins.map(({ bin, label }) => (
            <span key={bin} className="flex flex-col items-center">
              <span className={`h-3.5 w-14 ${BIN_CLASS[bin]}`} />
              <span className="num mt-0.5 whitespace-nowrap text-[0.62rem] text-ink-3">{label}</span>
            </span>
          ))}
        </div>
        <span>Claimed over tracked</span>
      </div>
      <span className="flex items-center gap-1.5">
        <span className="hatch h-3.5 w-3.5 rounded-[2px] ring-1 ring-inset ring-ink-2" /> Report missing
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3.5 w-3.5 rounded-[2px] border border-dashed border-ink-2 bg-surface" /> Timer missing
      </span>
      <span className="flex items-center gap-1.5">
        <span className="relative h-3.5 w-3.5">
          <span className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-line-strong" />
        </span>
        Nothing recorded
      </span>
    </div>
  );
}
