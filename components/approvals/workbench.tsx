"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { createBatchAction, restoreDemoAction } from "@/app/(app)/approvals/actions";
import type { BatchSummary } from "@/lib/data/approvals";
import { fmtDateTime, fmtDay, fmtHours } from "@/lib/format";
import { POLICY } from "@/lib/policy";
import { describeRemaining, type SlaBucket } from "@/lib/sla/sla";
import { Drawer } from "../drawer";
import { MemberDayPanel } from "../member-day-panel";
import { Badge, buttonClass, EmptyState, inputClass, Notice, Panel, type Tone } from "../ui";
import { BatchPanel } from "./batch-panel";

export interface QueueItem {
  reportId: number;
  memberId: number;
  memberName: string;
  memberPosition: string;
  teamId: number;
  teamName: string;
  reportDate: string;
  hoursClaimed: number;
  summary: string;
  filedAt: string;
  taskCount: number;
  inOpenBatch: boolean;
  bucket: SlaBucket;
  hoursRemaining: number;
}

const BUCKET: Record<SlaBucket, { label: string; tone: Tone }> = {
  on_time: { label: "On time", tone: "ok" },
  due_soon: { label: "Due soon", tone: "warn" },
  overdue: { label: "Overdue", tone: "bad" },
};

type BucketFilter = SlaBucket | "all";

export function ApprovalsWorkbench({
  items,
  recentBatches,
  canMutate,
  canRestore,
  scopeNote,
}: {
  items: QueueItem[];
  recentBatches: BatchSummary[];
  canMutate: boolean;
  canRestore: boolean;
  scopeNote: string | null;
}) {
  const router = useRouter();
  const [team, setTeam] = useState<number | "all">("all");
  const [bucket, setBucket] = useState<BucketFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openItem, setOpenItem] = useState<QueueItem | null>(null);
  const [activeBatch, setActiveBatch] = useState<{ id: string; autoStart: boolean } | null>(null);
  const [simulateOutage, setSimulateOutage] = useState(false);
  const [outageAfter, setOutageAfter] = useState(8);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const teams = useMemo(() => {
    const map = new Map<number, string>();
    for (const i of items) map.set(i.teamId, i.teamName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const counts = useMemo(() => {
    const c = { all: items.length, on_time: 0, due_soon: 0, overdue: 0 };
    for (const i of items) c[i.bucket] += 1;
    return c;
  }, [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        (team === "all" || i.teamId === team) &&
        (bucket === "all" || i.bucket === bucket) &&
        (q === "" || i.memberName.toLowerCase().includes(q) || i.summary.toLowerCase().includes(q) || i.teamName.toLowerCase().includes(q)),
    );
  }, [items, team, bucket, query]);

  const selectable = useMemo(() => visible.filter((i) => !i.inOpenBatch), [visible]);
  const selectedVisible = selectable.filter((i) => selected.has(i.reportId));
  const allSelected = selectable.length > 0 && selectedVisible.length === Math.min(selectable.length, POLICY.batchMaxItems);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < POLICY.batchMaxItems) next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectable.slice(0, POLICY.batchMaxItems).map((i) => i.reportId)));
  }

  const onSettled = useCallback(() => router.refresh(), [router]);

  function approve(ids: number[]) {
    setError(null);
    startTransition(async () => {
      const res = await createBatchAction({ reportIds: ids, outageAfter: simulateOutage ? outageAfter : null });
      if (!res.ok) {
        setError(res.error);
        router.refresh();
        return;
      }
      setSelected(new Set());
      setOpenItem(null);
      setActiveBatch({ id: res.data.batchId, autoStart: true });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function restore() {
    setError(null);
    startTransition(async () => {
      const res = await restoreDemoAction();
      if (!res.ok) setError(res.error);
      else if (!res.data.restored) setError("The queue still has plenty of reports, so the demo was not reset.");
      router.refresh();
    });
  }

  return (
    <>
      {activeBatch ? (
        <BatchPanel
          key={activeBatch.id}
          batchId={activeBatch.id}
          autoStart={activeBatch.autoStart}
          canMutate={canMutate}
          onClose={() => setActiveBatch(null)}
          onSettled={onSettled}
        />
      ) : null}

      {error ? (
        <div className="mb-4">
          <Notice tone="bad">{error}</Notice>
        </div>
      ) : null}

      <Panel flush>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <div role="group" aria-label="Filter by SLA" className="flex overflow-hidden rounded-sm border border-line-strong">
            {(["all", "overdue", "due_soon", "on_time"] as const).map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={bucket === b}
                onClick={() => setBucket(b)}
                className={`border-r border-line-strong px-2.5 py-1 text-xs font-medium last:border-r-0 ${
                  bucket === b ? "bg-ink text-white" : "bg-surface text-ink-2 hover:bg-sunken"
                }`}
              >
                {b === "all" ? "All" : BUCKET[b].label} <span className="num opacity-75">{counts[b]}</span>
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="team-filter">
            Team
          </label>
          <select
            id="team-filter"
            value={team}
            onChange={(e) => setTeam(e.target.value === "all" ? "all" : Number(e.target.value))}
            className={inputClass}
          >
            <option value="all">All teams</option>
            {teams.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-3" />
            <label className="sr-only" htmlFor="queue-search">
              Search member, team or task
            </label>
            <input
              id="queue-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search member, team or task"
              className={`${inputClass} w-64 pl-7`}
            />
          </div>
          <p className="ml-auto text-xs text-ink-3" aria-live="polite">
            {visible.length} of {items.length} reports{scopeNote ? ` · ${scopeNote}` : ""}
          </p>
        </div>

        {/* Selection bar */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-sunken px-3 py-2">
          <p className="text-sm">
            <span className="num font-semibold">{selected.size}</span> selected
            <span className="text-ink-3"> (max {POLICY.batchMaxItems} per batch)</span>
          </p>
          <fieldset className="flex items-center gap-2 rounded-sm border border-dashed border-line-strong bg-surface px-2 py-1">
            <legend className="sr-only">Demo control</legend>
            <input
              id="simulate-outage"
              type="checkbox"
              checked={simulateOutage}
              onChange={(e) => setSimulateOutage(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#0b6b65]"
            />
            <label htmlFor="simulate-outage" className="text-xs font-medium">
              Demo: simulate an API outage after
            </label>
            <input
              type="number"
              aria-label="Items before the simulated outage"
              min={0}
              max={POLICY.batchMaxItems}
              value={outageAfter}
              disabled={!simulateOutage}
              onChange={(e) => setOutageAfter(Math.min(POLICY.batchMaxItems, Math.max(0, Math.round(Number(e.target.value) || 0))))}
              className="num h-6 w-14 rounded-sm border border-line-strong px-1 text-xs disabled:opacity-50"
            />
            <span className="text-xs">items</span>
          </fieldset>
          <button
            type="button"
            disabled={!canMutate || selected.size === 0 || pending}
            onClick={() => approve([...selected])}
            className={`${buttonClass.primary} ml-auto`}
          >
            {pending ? "Creating batch..." : `Approve ${selected.size || ""} selected`.replace("  ", " ")}
          </button>
        </div>
        {!canMutate ? (
          <div className="border-b border-line px-3 py-2">
            <Notice tone="warn">Read-only while you preview another role. Switch back in the header to approve.</Notice>
          </div>
        ) : null}

        {items.length === 0 ? (
          <EmptyState title="Nothing is waiting for approval">
            <p>Either the team is fully caught up or earlier visitors approved everything. The demo data resets nightly.</p>
            {canRestore ? (
              <button type="button" onClick={restore} disabled={pending} className={`${buttonClass.secondary} mt-3`}>
                {pending ? "Restoring..." : "Restore the demo queue now"}
              </button>
            ) : null}
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState title="No reports match these filters">
            <button
              type="button"
              className="font-semibold text-accent underline underline-offset-2"
              onClick={() => {
                setTeam("all");
                setBucket("all");
                setQuery("");
              }}
            >
              Clear filters
            </button>
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-8">
                    <input
                      type="checkbox"
                      aria-label={`Select all ${Math.min(selectable.length, POLICY.batchMaxItems)} listed reports`}
                      checked={allSelected}
                      onChange={toggleAll}
                      className="h-3.5 w-3.5 accent-[#0b6b65]"
                    />
                  </th>
                  <th>Member</th>
                  <th>Report date</th>
                  <th className="r">Hours</th>
                  <th>Tasks</th>
                  <th>Filed (UTC)</th>
                  <th>Approval SLA</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.reportId} className={selected.has(item.reportId) ? "!bg-accent-soft/60" : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.memberName}, ${item.reportDate}`}
                        checked={selected.has(item.reportId)}
                        disabled={item.inOpenBatch}
                        onChange={() => toggle(item.reportId)}
                        className="h-3.5 w-3.5 accent-[#0b6b65]"
                      />
                    </td>
                    <td>
                      <div className="font-medium">{item.memberName}</div>
                      <div className="text-xs text-ink-3">{item.teamName}</div>
                    </td>
                    <td className="num whitespace-nowrap">{fmtDay(item.reportDate)}</td>
                    <td className="r num">{fmtHours(item.hoursClaimed)}</td>
                    <td className="max-w-[340px] truncate text-ink-2" title={item.summary}>
                      {item.summary}
                    </td>
                    <td className="num whitespace-nowrap text-ink-2">{fmtDateTime(item.filedAt)}</td>
                    <td className="whitespace-nowrap">
                      <Badge tone={BUCKET[item.bucket].tone}>{BUCKET[item.bucket].label}</Badge>{" "}
                      <span className="num text-xs text-ink-3">{describeRemaining(item.hoursRemaining)}</span>
                      {item.inOpenBatch ? (
                        <>
                          {" "}
                          <Badge tone="info">in a batch</Badge>
                        </>
                      ) : null}
                    </td>
                    <td className="r">
                      <button type="button" onClick={() => setOpenItem(item)} className={buttonClass.ghost}>
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {recentBatches.length > 0 ? (
        <Panel title="Recent batches" aside="Durable: reopen one to resume it" className="mt-5" flush>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Created (UTC)</th>
                  <th className="r">Items</th>
                  <th className="r">Approved</th>
                  <th className="r">Failed</th>
                  <th className="r">Pending</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentBatches.map((b) => (
                  <tr key={b.batch_id}>
                    <td className="num">{b.batch_id.slice(0, 8)}</td>
                    <td className="num text-ink-2">{fmtDateTime(b.created_at)}</td>
                    <td className="r num">{b.total}</td>
                    <td className="r num">{b.succeeded}</td>
                    <td className={`r num ${b.failed ? "font-semibold text-bad" : ""}`}>{b.failed}</td>
                    <td className={`r num ${b.pending ? "font-semibold text-warn" : ""}`}>{b.pending}</td>
                    <td className="r">
                      <button type="button" className={buttonClass.ghost} onClick={() => setActiveBatch({ id: b.batch_id, autoStart: false })}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <Drawer
        open={openItem !== null}
        title={openItem?.memberName ?? ""}
        subtitle={openItem ? `${openItem.teamName} · ${openItem.memberPosition} · ${fmtDay(openItem.reportDate)}` : null}
        onClose={() => setOpenItem(null)}
      >
        {openItem ? (
          <>
            <MemberDayPanel memberId={openItem.memberId} day={openItem.reportDate} />
            <div className="mt-5 border-t border-line pt-4">
              <button
                type="button"
                disabled={!canMutate || pending || openItem.inOpenBatch}
                onClick={() => approve([openItem.reportId])}
                className={buttonClass.primary}
              >
                Approve this report
              </button>
              <p className="mt-2 text-xs text-ink-3">A single approval is a batch of one, so it gets the same guarantees.</p>
            </div>
          </>
        ) : null}
      </Drawer>
    </>
  );
}
