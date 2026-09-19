/**
 * Abuse limits for batch creation. Visitors share one demo account, so these
 * are global. The same numbers are enforced again inside
 * fn_app.create_approval_batch; this copy gives a friendly message first.
 */
import { POLICY } from "../policy";

export type LimitDecision =
  | { ok: true }
  | { ok: false; code: "empty_batch" | "batch_too_large" | "rate_limited"; message: string; retryAfterSeconds?: number };

export interface BatchLimitInput {
  itemCount: number;
  /** created_at (ms) of batches made recently, any order. */
  recentBatchTimesMs: readonly number[];
  nowMs: number;
  maxItems?: number;
  maxPerWindow?: number;
  windowMinutes?: number;
}

export function checkBatchLimits(input: BatchLimitInput): LimitDecision {
  const maxItems = input.maxItems ?? POLICY.batchMaxItems;
  const maxPerWindow = input.maxPerWindow ?? POLICY.batchMaxPerWindow;
  const windowMs = (input.windowMinutes ?? POLICY.batchWindowMinutes) * 60_000;

  if (!Number.isInteger(input.itemCount) || input.itemCount <= 0) {
    return { ok: false, code: "empty_batch", message: "Select at least one report." };
  }
  if (input.itemCount > maxItems) {
    return {
      ok: false,
      code: "batch_too_large",
      message: `A batch can hold at most ${maxItems} reports. You selected ${input.itemCount}.`,
    };
  }
  const inWindow = input.recentBatchTimesMs.filter((t) => t > input.nowMs - windowMs && t <= input.nowMs);
  if (inWindow.length >= maxPerWindow) {
    const oldest = Math.min(...inWindow);
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - input.nowMs) / 1000));
    return {
      ok: false,
      code: "rate_limited",
      message: `The shared demo account is limited to ${maxPerWindow} batches per ${Math.round(windowMs / 60_000)} minutes. Try again in about ${Math.ceil(retryAfterSeconds / 60)} min.`,
      retryAfterSeconds,
    };
  }
  return { ok: true };
}

/** Deduplicate and validate ids coming from the client. */
export function normalizeReportIds(ids: readonly unknown[]): number[] {
  const out = new Set<number>();
  for (const id of ids) {
    const n = typeof id === "string" ? Number(id) : id;
    if (typeof n === "number" && Number.isInteger(n) && n > 0) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** Map the SQL function's exception text back to a message. */
export function messageForSqlError(text: string): string {
  if (text.includes("rate_limited")) return "Too many batches were created recently on the shared demo account. Try again in a few minutes.";
  if (text.includes("batch_too_large")) return `A batch can hold at most ${POLICY.batchMaxItems} reports.`;
  if (text.includes("nothing_to_approve")) return "None of the selected reports still need approval. The queue has been refreshed.";
  if (text.includes("empty_batch")) return "Select at least one report.";
  return "The batch could not be created.";
}
