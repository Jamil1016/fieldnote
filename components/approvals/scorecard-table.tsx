"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ScorecardRow } from "@/lib/data/approvals";
import { POLICY } from "@/lib/policy";

type SortKey = "approver_name" | "approved_count" | "median_hours_to_approve" | "pct_within_sla" | "backlog";

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "approver_name", label: "Approver", numeric: false },
  { key: "approved_count", label: "Approved", numeric: true },
  { key: "median_hours_to_approve", label: "Median time to approve", numeric: true },
  { key: "pct_within_sla", label: "Within SLA", numeric: true },
  { key: "backlog", label: "Backlog now", numeric: true },
];

function Bar({ fraction, className, marker }: { fraction: number; className: string; marker?: number }) {
  const width = `${Math.min(100, Math.max(0, fraction * 100))}%`;
  return (
    <span aria-hidden className="relative block h-2 w-full min-w-24 rounded-[1px] bg-sunken ring-1 ring-inset ring-line">
      <span className={`absolute inset-y-0 left-0 rounded-[1px] ${className}`} style={{ width }} />
      {marker !== undefined ? <span className="absolute -inset-y-0.5 w-px bg-ink" style={{ left: `${marker * 100}%` }} /> : null}
    </span>
  );
}

export function ScorecardTable({ rows }: { rows: ScorecardRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "pct_within_sla", dir: 1 });

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === null && bv === null) return 0;
      if (av === null) return 1; // unknowns last, whichever direction
      if (bv === null) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
      return cmp * sort.dir;
    });
    return out;
  }, [rows, sort]);

  const maxApproved = Math.max(1, ...rows.map((r) => r.approved_count));
  const maxBacklog = Math.max(1, ...rows.map((r) => r.backlog));
  const maxMedian = Math.max(POLICY.approvalSlaHours * 1.25, ...rows.map((r) => r.median_hours_to_approve ?? 0));

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            {COLUMNS.map((col) => {
              const active = sort.key === col.key;
              return (
                <th key={col.key} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    onClick={() => setSort((s) => ({ key: col.key, dir: s.key === col.key ? (s.dir === 1 ? -1 : 1) : col.numeric ? -1 : 1 }))}
                    className="inline-flex items-center gap-1 font-semibold uppercase tracking-[0.07em] hover:text-ink"
                  >
                    {col.label}
                    {active ? sort.dir === 1 ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden /> : null}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const pct = r.pct_within_sla;
            const pctClass = pct === null ? "bg-line-strong" : pct >= 80 ? "bg-ok" : pct >= 60 ? "bg-[#c98a00]" : "bg-bad";
            const med = r.median_hours_to_approve;
            return (
              <tr key={r.approver_member_id}>
                <td>
                  <div className="font-medium">{r.approver_name}</div>
                  <div className="text-xs text-ink-3">{r.teams}</div>
                </td>
                <td>
                  <div className="flex items-center gap-3">
                    <span className="num w-10 text-right">{r.approved_count}</span>
                    <Bar fraction={r.approved_count / maxApproved} className="bg-accent" />
                  </div>
                </td>
                <td>
                  <div className="flex items-center gap-3">
                    <span className="num w-14 text-right">{med === null ? "-" : `${med.toFixed(1)} h`}</span>
                    <Bar
                      fraction={(med ?? 0) / maxMedian}
                      className={med !== null && med > POLICY.approvalSlaHours ? "bg-bad" : "bg-ink-3"}
                      marker={POLICY.approvalSlaHours / maxMedian}
                    />
                  </div>
                </td>
                <td>
                  <div className="flex items-center gap-3">
                    <span className="num w-14 text-right">{pct === null ? "-" : `${pct.toFixed(1)}%`}</span>
                    <Bar fraction={(pct ?? 0) / 100} className={pctClass} />
                  </div>
                </td>
                <td>
                  <div className="flex items-center gap-3">
                    <span className="num w-10 text-right">{r.backlog}</span>
                    <span aria-hidden className="relative block h-2 w-full min-w-24 rounded-[1px] bg-sunken ring-1 ring-inset ring-line">
                      <span className="absolute inset-y-0 left-0 bg-line-strong" style={{ width: `${(r.backlog / maxBacklog) * 100}%` }} />
                      <span className="absolute inset-y-0 left-0 bg-bad" style={{ width: `${(r.overdue_backlog / maxBacklog) * 100}%` }} />
                    </span>
                    <span className="num w-20 whitespace-nowrap text-xs text-bad">{r.overdue_backlog} overdue</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
