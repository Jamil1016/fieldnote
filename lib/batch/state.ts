/**
 * Batch state machine. A batch has no stored status: its state is DERIVED from
 * its items, so it can never disagree with them.
 *
 *   item:   pending --claim+success--> succeeded   (terminal, never re-sent)
 *           pending --claim+failure--> failed
 *           failed  --retry----------> pending
 *
 *   batch:  empty | running | interrupted | completed | completed_with_failures
 */
import type { BatchTotals, ItemStatus } from "./types";

export type BatchState = "empty" | "running" | "interrupted" | "completed" | "completed_with_failures";

const TRANSITIONS: Record<ItemStatus, readonly ItemStatus[]> = {
  pending: ["succeeded", "failed"],
  failed: ["pending"],
  succeeded: [],
};

export function canTransition(from: ItemStatus, to: ItemStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ItemStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function deriveBatchState(totals: BatchTotals): BatchState {
  if (totals.total === 0) return "empty";
  if (totals.pending > 0) {
    // Pending work with a live claim means some runner is on it. Pending work
    // with no live claim means nobody is: the batch was interrupted (tab
    // closed, function timed out, outage halt) and is waiting for a resume.
    return totals.activeClaims > 0 ? "running" : "interrupted";
  }
  return totals.failed > 0 ? "completed_with_failures" : "completed";
}

export function totalsFromStatuses(
  items: readonly { status: ItemStatus; claimedAtMs?: number | null }[],
  nowMs: number,
  staleMs: number,
): BatchTotals {
  const totals: BatchTotals = { total: items.length, pending: 0, succeeded: 0, failed: 0, activeClaims: 0 };
  for (const item of items) {
    totals[item.status] += 1;
    if (
      item.status === "pending" &&
      item.claimedAtMs !== null &&
      item.claimedAtMs !== undefined &&
      nowMs - item.claimedAtMs < staleMs
    ) {
      totals.activeClaims += 1;
    }
  }
  return totals;
}

export interface BatchActions {
  canResume: boolean;
  canRetryFailed: boolean;
}

export function availableActions(state: BatchState, totals: BatchTotals): BatchActions {
  return {
    canResume: state === "interrupted",
    canRetryFailed: totals.failed > 0 && state !== "running",
  };
}

export function progressFraction(totals: BatchTotals): number {
  if (totals.total === 0) return 0;
  return (totals.succeeded + totals.failed) / totals.total;
}
