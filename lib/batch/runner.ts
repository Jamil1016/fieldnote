/**
 * The batch worker. One call = one CHUNK: claim a few items, send each to the
 * PM API, record each outcome, return. The browser (or anything else) keeps
 * calling until nothing is left, which keeps every invocation well inside a
 * serverless time limit. Nothing about progress lives in memory: if the
 * caller disappears mid-batch, the rows say exactly where things stand and any
 * later call picks up from there.
 *
 * Guarantees
 *   - An item is only ever processed by the runner that claimed it (the store
 *     hands out disjoint claims).
 *   - A succeeded item is never claimed again, so it is never re-sent.
 *   - If a runner dies AFTER the PM API accepted an approval but BEFORE the
 *     outcome was recorded, the item is re-claimed later, the API answers
 *     "duplicate", and that is recorded as success. No double approval.
 *   - Several consecutive "unavailable" errors halt the runner and release the
 *     unprocessed claims so a resume does not wait for them to go stale.
 */
import { POLICY } from "../policy";
import { isPmApiError, type PmApi } from "../pm-api/types";
import type { BatchStore, ClaimedItem } from "./types";

export interface RunChunkOptions {
  store: BatchStore;
  api: PmApi;
  batchId: string;
  runnerId: string;
  approverEmail: string;
  chunkSize?: number;
  haltAfterFailures?: number;
}

export interface RunChunkResult {
  claimed: number;
  succeeded: number;
  failed: number;
  /** Outcomes the store refused because the claim had been lost. */
  lostClaims: number;
  released: number;
  halted: boolean;
  haltReason: string | null;
  /** True when this call found nothing to claim. */
  idle: boolean;
}

export async function runChunk(options: RunChunkOptions): Promise<RunChunkResult> {
  const chunkSize = options.chunkSize ?? POLICY.batchChunkSize;
  const haltAfter = options.haltAfterFailures ?? POLICY.batchHaltAfterFailures;
  const result: RunChunkResult = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    lostClaims: 0,
    released: 0,
    halted: false,
    haltReason: null,
    idle: false,
  };

  const items = await options.store.claim(options.batchId, chunkSize, options.runnerId);
  result.claimed = items.length;
  if (items.length === 0) {
    result.idle = true;
    return result;
  }

  let consecutiveUnavailable = 0;
  const remaining: ClaimedItem[] = [...items];

  while (remaining.length > 0) {
    const item = remaining.shift() as ClaimedItem;
    let recorded: boolean;
    try {
      const response = await options.api.approveReport({
        reportId: item.reportId,
        idempotencyKey: String(item.reportId),
        approverEmail: options.approverEmail,
      });
      recorded = await options.store.complete(item.itemId, options.runnerId, { ok: true, reference: response.reference });
      if (recorded) result.succeeded += 1;
      consecutiveUnavailable = 0;
    } catch (error) {
      if (isPmApiError(error) && error.kind === "duplicate") {
        // Already approved remotely: the goal state holds, so this is success.
        recorded = await options.store.complete(item.itemId, options.runnerId, {
          ok: true,
          reference: error.reference ?? "duplicate",
        });
        if (recorded) result.succeeded += 1;
        consecutiveUnavailable = 0;
      } else {
        const message = error instanceof Error ? error.message : "Unknown error";
        recorded = await options.store.complete(item.itemId, options.runnerId, { ok: false, error: message });
        if (recorded) result.failed += 1;
        if (isPmApiError(error) && error.kind === "unavailable") consecutiveUnavailable += 1;
        else consecutiveUnavailable = 0;
      }
    }
    if (!recorded) result.lostClaims += 1;

    if (consecutiveUnavailable >= haltAfter) {
      result.halted = true;
      result.haltReason = `PM API unavailable ${consecutiveUnavailable} times in a row`;
      if (remaining.length > 0) {
        result.released = await options.store.release(
          remaining.map((r) => r.itemId),
          options.runnerId,
        );
      }
      break;
    }
  }
  return result;
}

/** Drive chunks until the batch is drained or a chunk halts. Used by tests and scripts. */
export async function runUntilSettled(
  options: RunChunkOptions,
  maxChunks = 1000,
): Promise<RunChunkResult & { chunks: number }> {
  const total: RunChunkResult & { chunks: number } = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    lostClaims: 0,
    released: 0,
    halted: false,
    haltReason: null,
    idle: false,
    chunks: 0,
  };
  for (let i = 0; i < maxChunks; i += 1) {
    const r = await runChunk(options);
    total.chunks += 1;
    total.claimed += r.claimed;
    total.succeeded += r.succeeded;
    total.failed += r.failed;
    total.lostClaims += r.lostClaims;
    total.released += r.released;
    if (r.halted) {
      total.halted = true;
      total.haltReason = r.haltReason;
      break;
    }
    if (r.idle) {
      total.idle = true;
      break;
    }
  }
  return total;
}

/**
 * The demo's "Simulate an API outage after N items" control, as a fault hook
 * for SimulatedPmApi. `acceptedThisRun` reports how many approvals the API has
 * accepted during this runner call, on top of what the batch already had.
 */
export function outageFault(
  meta: { outageAfter: number | null; outageCleared: boolean; succeeded: number },
  acceptedThisRun: () => number,
): () => boolean {
  return () =>
    meta.outageAfter !== null && !meta.outageCleared && meta.succeeded + acceptedThisRun() >= meta.outageAfter;
}
