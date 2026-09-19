export type ItemStatus = "pending" | "succeeded" | "failed";

export interface ClaimedItem {
  itemId: number;
  reportId: number;
  attempts: number;
}

export interface BatchMeta {
  batchId: string;
  /** Demo control: simulate an API outage once this many items have succeeded. */
  outageAfter: number | null;
  outageCleared: boolean;
  succeeded: number;
}

export type ItemOutcome =
  | { ok: true; reference: string }
  | { ok: false; error: string };

/**
 * Storage the batch runner needs. The app implements it with Postgres RPCs
 * (lib/batch/supabase-store.ts); tests use MemoryBatchStore, which follows the
 * same rules.
 */
export interface BatchStore {
  getMeta(batchId: string): Promise<BatchMeta | null>;
  /**
   * Atomically claim up to `limit` claimable items for `runner`. An item is
   * claimable when it is pending and either unclaimed or its claim is stale.
   * Two concurrent callers must never receive the same item.
   */
  claim(batchId: string, limit: number, runner: string): Promise<ClaimedItem[]>;
  /**
   * Record an outcome. Returns false (and changes nothing) unless the item is
   * still pending AND still claimed by `runner`.
   */
  complete(itemId: number, runner: string, outcome: ItemOutcome): Promise<boolean>;
  /** Hand claimed items back, unprocessed. */
  release(itemIds: readonly number[], runner: string): Promise<number>;
}

export interface BatchTotals {
  total: number;
  pending: number;
  succeeded: number;
  failed: number;
  /** Pending items holding a claim that is not stale yet. */
  activeClaims: number;
}
