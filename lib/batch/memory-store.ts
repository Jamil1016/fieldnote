/**
 * In-memory BatchStore with the same rules as the SQL functions. Used by unit
 * tests to exercise claim / resume / stale-claim logic with an injectable
 * clock. JavaScript is single-threaded, so "atomic" here simply means the
 * claim does no awaiting between picking rows and stamping them; the
 * two-runner guarantee against real Postgres is checked separately
 * (tests/db and scripts/local/claim-race.mjs).
 */
import { POLICY } from "../policy";
import { canTransition, totalsFromStatuses } from "./state";
import type { BatchMeta, BatchStore, BatchTotals, ClaimedItem, ItemOutcome, ItemStatus } from "./types";

export interface MemoryItem {
  itemId: number;
  batchId: string;
  reportId: number;
  status: ItemStatus;
  attempts: number;
  lastError: string | null;
  claimedAtMs: number | null;
  claimedBy: string | null;
  reference: string | null;
}

export class MemoryBatchStore implements BatchStore {
  readonly items: MemoryItem[] = [];
  private readonly batches = new Map<string, { outageAfter: number | null; outageCleared: boolean }>();
  private nextId = 1;
  /** Every successful approval recorded, in order. Mirrors approval_log. */
  readonly approvalLog: { reportId: number; reference: string }[] = [];

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly staleMs: number = POLICY.claimStaleMs,
  ) {}

  createBatch(batchId: string, reportIds: readonly number[], outageAfter: number | null = null): void {
    this.batches.set(batchId, { outageAfter, outageCleared: false });
    for (const reportId of reportIds) {
      this.items.push({
        itemId: this.nextId++,
        batchId,
        reportId,
        status: "pending",
        attempts: 0,
        lastError: null,
        claimedAtMs: null,
        claimedBy: null,
        reference: null,
      });
    }
  }

  clearOutage(batchId: string): void {
    const b = this.batches.get(batchId);
    if (b) b.outageCleared = true;
  }

  async getMeta(batchId: string): Promise<BatchMeta | null> {
    const b = this.batches.get(batchId);
    if (!b) return null;
    return {
      batchId,
      outageAfter: b.outageAfter,
      outageCleared: b.outageCleared,
      succeeded: this.items.filter((i) => i.batchId === batchId && i.status === "succeeded").length,
    };
  }

  async claim(batchId: string, limit: number, runner: string): Promise<ClaimedItem[]> {
    const nowMs = this.now();
    const picked = this.items
      .filter(
        (i) =>
          i.batchId === batchId &&
          i.status === "pending" &&
          (i.claimedAtMs === null || nowMs - i.claimedAtMs >= this.staleMs),
      )
      .slice(0, Math.max(0, limit));
    for (const item of picked) {
      item.claimedAtMs = nowMs;
      item.claimedBy = runner;
      item.attempts += 1;
    }
    return picked.map((i) => ({ itemId: i.itemId, reportId: i.reportId, attempts: i.attempts }));
  }

  async complete(itemId: number, runner: string, outcome: ItemOutcome): Promise<boolean> {
    const item = this.items.find((i) => i.itemId === itemId);
    if (!item || item.status !== "pending" || item.claimedBy !== runner) return false;
    const next: ItemStatus = outcome.ok ? "succeeded" : "failed";
    if (!canTransition(item.status, next)) return false;
    item.status = next;
    if (outcome.ok) {
      item.reference = outcome.reference;
      item.lastError = null;
      if (!this.approvalLog.some((l) => l.reportId === item.reportId)) {
        this.approvalLog.push({ reportId: item.reportId, reference: outcome.reference });
      }
    } else {
      item.lastError = outcome.error;
    }
    return true;
  }

  async release(itemIds: readonly number[], runner: string): Promise<number> {
    let count = 0;
    for (const item of this.items) {
      if (itemIds.includes(item.itemId) && item.status === "pending" && item.claimedBy === runner) {
        item.claimedAtMs = null;
        item.claimedBy = null;
        item.attempts = Math.max(0, item.attempts - 1);
        count += 1;
      }
    }
    return count;
  }

  retryFailed(batchId: string): number {
    let count = 0;
    for (const item of this.items) {
      if (item.batchId === batchId && item.status === "failed" && canTransition("failed", "pending")) {
        item.status = "pending";
        item.claimedAtMs = null;
        item.claimedBy = null;
        count += 1;
      }
    }
    return count;
  }

  totals(batchId: string): BatchTotals {
    return totalsFromStatuses(
      this.items.filter((i) => i.batchId === batchId),
      this.now(),
      this.staleMs,
    );
  }
}
