"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, RotateCcw, X } from "lucide-react";
import { resumeBatchAction, retryFailedAction } from "@/app/(app)/approvals/actions";
import type { BatchRunResponse, BatchStatusResponse } from "@/lib/batch/api-types";
import type { BatchState } from "@/lib/batch/state";
import { fmtDayShort } from "@/lib/format";
import { Badge, buttonClass, Notice, type Tone } from "../ui";

const STATE_COPY: Record<BatchState, { label: string; tone: Tone }> = {
  empty: { label: "Empty", tone: "neutral" },
  running: { label: "Running", tone: "accent" },
  interrupted: { label: "Interrupted", tone: "warn" },
  completed: { label: "Completed", tone: "ok" },
  completed_with_failures: { label: "Completed with failures", tone: "bad" },
};

async function fetchStatus(batchId: string): Promise<BatchStatusResponse | null> {
  try {
    const res = await fetch(`/api/batches/${batchId}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as BatchStatusResponse;
  } catch {
    // A missed poll is harmless; the next one is a second away.
    return null;
  }
}

/**
 * Live view of one durable batch. The batch lives in Postgres; this component
 * only drives it (POST .../run, one chunk per call) and watches it (GET every
 * second). Close the tab mid-run and the rows still say exactly where it
 * stopped; reopen the batch and press Resume.
 */
export function BatchPanel({
  batchId,
  autoStart,
  canMutate,
  onClose,
  onSettled,
}: {
  batchId: string;
  autoStart: boolean;
  canMutate: boolean;
  onClose: () => void;
  onSettled: () => void;
}) {
  const [status, setStatus] = useState<BatchStatusResponse | null>(null);
  const [driving, setDriving] = useState(false);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);
  const [showItems, setShowItems] = useState(false);
  const drivingRef = useRef(false);
  const cancelledRef = useRef(false);
  const startedRef = useRef(false);

  const poll = useCallback(async () => {
    const body = await fetchStatus(batchId);
    if (body && !cancelledRef.current) setStatus(body);
  }, [batchId]);

  const drive = useCallback(async () => {
    if (drivingRef.current) return;
    drivingRef.current = true;
    setDriving(true);
    setMessage(null);
    try {
      for (let guard = 0; guard < 200 && !cancelledRef.current; guard += 1) {
        const res = await fetch(`/api/batches/${batchId}/run`, { method: "POST" });
        const body = await res.json();
        if (!res.ok) {
          setMessage({ tone: "bad", text: body?.error ?? "The runner could not be started." });
          break;
        }
        const run = body as BatchRunResponse;
        setStatus(run.status);
        if (run.result.halted) {
          setMessage({
            tone: "warn",
            text: `Halted: ${run.result.haltReason}. ${run.status.totals.succeeded} approved so far and safe. ${run.result.released} claimed items were released. Resume to continue; approved reports will not be sent again.`,
          });
          break;
        }
        if (run.result.idle) break;
      }
    } catch {
      setMessage({ tone: "bad", text: "Lost contact with the server. The batch is safe; press Resume to continue." });
    } finally {
      drivingRef.current = false;
      setDriving(false);
      await poll();
      onSettled();
    }
  }, [batchId, onSettled, poll]);

  // Initial load, then (for a batch just created here) start the runner once.
  useEffect(() => {
    cancelledRef.current = false;
    const load = async () => {
      const body = await fetchStatus(batchId);
      if (cancelledRef.current) return;
      if (body) setStatus(body);
      if (autoStart && canMutate && !startedRef.current) {
        startedRef.current = true;
        void drive();
      }
    };
    void load();
    return () => {
      cancelledRef.current = true;
    };
  }, [autoStart, batchId, canMutate, drive]);

  // Poll every second while anything is in flight (this tab or another runner).
  const live = driving || status?.state === "running";
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void poll(), 1000);
    return () => clearInterval(timer);
  }, [live, poll]);

  async function resume() {
    const res = await resumeBatchAction(batchId);
    if (!res.ok) return setMessage({ tone: "bad", text: res.error });
    await drive();
  }

  async function retryFailed() {
    const res = await retryFailedAction(batchId);
    if (!res.ok) return setMessage({ tone: "bad", text: res.error });
    await drive();
  }

  const totals = status?.totals;
  // Between two chunks nothing is claimed, which on its own would read as
  // "interrupted". While this tab is driving the batch, it is running.
  const state: BatchState = driving && status?.state === "interrupted" ? "running" : (status?.state ?? "running");
  const copy = STATE_COPY[state];
  const pct = (n: number) => (totals && totals.total > 0 ? (n / totals.total) * 100 : 0);

  return (
    <section aria-label="Batch progress" className="mb-5 overflow-hidden rounded-sm border border-line-strong bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-sunken px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-[0.95rem] font-semibold tracking-tight">Bulk approval</h2>
          <span className="num text-xs text-ink-3">batch {batchId.slice(0, 8)}</span>
          <Badge tone={copy.tone}>
            {state === "running" ? <span aria-hidden className="pulse-soft h-1.5 w-1.5 rounded-full bg-accent" /> : null}
            {copy.label}
          </Badge>
          {status?.summary.outage_after !== null && status?.summary.outage_after !== undefined ? (
            <Badge tone={status.summary.outage_cleared ? "neutral" : "warn"}>
              {status.summary.outage_cleared
                ? "Simulated outage: over"
                : `Simulated outage after ${status.summary.outage_after} items`}
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {canMutate && status?.actions.canResume && !driving ? (
            <button type="button" onClick={() => void resume()} className={buttonClass.primary}>
              <Play size={14} aria-hidden /> Resume
            </button>
          ) : null}
          {canMutate && status?.actions.canRetryFailed && !driving ? (
            <button type="button" onClick={() => void retryFailed()} className={buttonClass.secondary}>
              <RotateCcw size={14} aria-hidden /> Retry failed
            </button>
          ) : null}
          <button type="button" onClick={onClose} aria-label="Close batch panel" className={buttonClass.ghost}>
            <X size={15} aria-hidden />
          </button>
        </div>
      </div>

      <div className="px-4 py-4">
        {!totals ? (
          <div aria-busy="true" className="skeleton h-24" />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
              <p className="num text-4xl font-semibold leading-none tracking-tight">
                {totals.succeeded}
                <span className="text-xl font-medium text-ink-3"> / {totals.total}</span>
              </p>
              <dl className="flex gap-6 text-sm">
                <Count label="Approved" value={totals.succeeded} swatch="bg-accent" />
                <Count label="Failed" value={totals.failed} swatch="bg-bad" />
                <Count label="Pending" value={totals.pending} swatch="bg-line-strong" />
                <Count label="In flight" value={totals.activeClaims} swatch="bg-accent/40" />
              </dl>
            </div>

            <div
              role="progressbar"
              aria-label="Batch progress"
              aria-valuemin={0}
              aria-valuemax={totals.total}
              aria-valuenow={totals.succeeded + totals.failed}
              className="mt-4 flex h-3 overflow-hidden rounded-[2px] bg-sunken ring-1 ring-inset ring-line"
            >
              <span className="bg-accent transition-[width] duration-500" style={{ width: `${pct(totals.succeeded)}%` }} />
              <span className="bg-bad transition-[width] duration-500" style={{ width: `${pct(totals.failed)}%` }} />
              <span className={live ? "stripes flex-1" : "flex-1"} />
            </div>

            {/* One tile per item: the whole batch at a glance. */}
            <ul aria-label="Items" className="mt-4 flex flex-wrap gap-[3px]">
              {status.items.map((item) => {
                const inFlight = item.status === "pending" && item.claimed_at !== null && live;
                const cls =
                  item.status === "succeeded"
                    ? "bg-accent tile-done"
                    : item.status === "failed"
                      ? "bg-bad tile-done"
                      : inFlight
                        ? "bg-accent/40 pulse-soft"
                        : "bg-line";
                return (
                  <li
                    key={item.item_id}
                    title={`${item.member_name}, ${fmtDayShort(item.report_date)}: ${item.status}${item.last_error ? ` (${item.last_error})` : ""}`}
                    className={`h-3.5 w-3.5 rounded-[2px] ${cls}`}
                  >
                    <span className="sr-only">
                      {item.member_name} {item.report_date} {item.status}
                    </span>
                  </li>
                );
              })}
            </ul>

            {message ? (
              <div className="mt-4">
                <Notice tone={message.tone}>{message.text}</Notice>
              </div>
            ) : null}
            {!canMutate && state === "interrupted" ? (
              <div className="mt-4">
                <Notice tone="warn">This batch is waiting for a resume. Switch back to your own role to continue it.</Notice>
              </div>
            ) : null}
            {state === "completed" && !message ? (
              <div className="mt-4">
                <Notice tone="ok">
                  All {totals.total} approvals were written to the PM API, the approval log and the audit log, each exactly once.
                </Notice>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => setShowItems((v) => !v)}
              aria-expanded={showItems}
              className={`${buttonClass.ghost} mt-3 -ml-2`}
            >
              {showItems ? "Hide item detail" : "Show item detail"}
            </button>
            {showItems ? (
              <div className="mt-2 max-h-72 overflow-auto rounded-sm border border-line">
                <table className="table">
                  <thead className="sticky top-0">
                    <tr>
                      <th>Member</th>
                      <th>Report</th>
                      <th>Status</th>
                      <th className="r">Attempts</th>
                      <th>PM reference / error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.items.map((item) => (
                      <tr key={item.item_id}>
                        <td>{item.member_name}</td>
                        <td className="num">{fmtDayShort(item.report_date)}</td>
                        <td>
                          <Badge tone={item.status === "succeeded" ? "ok" : item.status === "failed" ? "bad" : "neutral"}>
                            {item.status}
                          </Badge>
                        </td>
                        <td className="r num">{item.attempts}</td>
                        <td className={`num text-xs ${item.last_error ? "text-bad" : "text-ink-2"}`}>
                          {item.last_error ?? item.pm_reference ?? "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function Count({ label, value, swatch }: { label: string; value: number; swatch: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-ink-3">
        <span aria-hidden className={`h-2 w-2 rounded-[1px] ${swatch}`} />
        {label}
      </dt>
      <dd className="num text-base font-semibold">{value}</dd>
    </div>
  );
}
