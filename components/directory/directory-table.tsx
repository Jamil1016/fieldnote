"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { DirectoryRow } from "@/lib/data/directory";
import { ARRANGEMENT_LABEL, SHIFT_LABEL, STATUS_LABEL } from "@/lib/format";
import { Badge, EmptyState, inputClass, type Tone } from "../ui";

const STATUS_TONE: Record<string, Tone> = { active: "ok", on_leave: "warn", inactive: "neutral" };

export function DirectoryTable({ rows }: { rows: DirectoryRow[] }) {
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState("all");
  const [status, setStatus] = useState("all");
  const [arrangement, setArrangement] = useState("all");

  const teams = useMemo(() => [...new Set(rows.map((r) => r.team_name))].sort(), [rows]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (team === "all" || r.team_name === team) &&
        (status === "all" || r.status === status) &&
        (arrangement === "all" || r.work_arrangement === arrangement) &&
        (q === "" ||
          r.full_name.toLowerCase().includes(q) ||
          r.position.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q) ||
          (r.lead_name ?? "").toLowerCase().includes(q)),
    );
  }, [rows, query, team, status, arrangement]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <div className="relative">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-3" />
          <label htmlFor="dir-search" className="sr-only">
            Search name, position, email or lead
          </label>
          <input
            id="dir-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, position, email or lead"
            className={`${inputClass} w-72 pl-7`}
          />
        </div>
        <label htmlFor="dir-team" className="sr-only">
          Team
        </label>
        <select id="dir-team" value={team} onChange={(e) => setTeam(e.target.value)} className={inputClass}>
          <option value="all">All teams</option>
          {teams.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <label htmlFor="dir-status" className="sr-only">
          Status
        </label>
        <select id="dir-status" value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
          <option value="all">Any status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label htmlFor="dir-arr" className="sr-only">
          Work arrangement
        </label>
        <select id="dir-arr" value={arrangement} onChange={(e) => setArrangement(e.target.value)} className={inputClass}>
          <option value="all">Any arrangement</option>
          {Object.entries(ARRANGEMENT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <p className="ml-auto text-xs text-ink-3" aria-live="polite">
          {visible.length} of {rows.length} people
        </p>
      </div>
      {visible.length === 0 ? (
        <EmptyState title="Nobody matches these filters">Clear the search or pick a different team.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Team</th>
                <th>Position</th>
                <th>Lead / approver</th>
                <th>Shift</th>
                <th>Arrangement</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.member_id}>
                  <td>
                    <Link href={`/directory/${r.member_id}`} className="font-medium text-accent-strong underline-offset-2 hover:underline">
                      {r.full_name}
                    </Link>
                    {r.is_approver ? (
                      <>
                        {" "}
                        <Badge tone="accent">approver</Badge>
                      </>
                    ) : null}
                    <div className="text-xs text-ink-3">{r.email}</div>
                  </td>
                  <td>
                    {r.team_name}
                    <div className="text-xs text-ink-3">{r.client_label}</div>
                  </td>
                  <td>{r.position}</td>
                  <td className="text-ink-2">{r.lead_member_id === r.member_id ? "-" : (r.lead_name ?? "-")}</td>
                  <td className="text-ink-2">{SHIFT_LABEL[r.shift]}</td>
                  <td className="text-ink-2">{ARRANGEMENT_LABEL[r.work_arrangement]}</td>
                  <td>
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
