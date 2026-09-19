import type { BatchItemRow, BatchSummary } from "../data/approvals";
import type { RunChunkResult } from "./runner";
import { availableActions, deriveBatchState, type BatchActions, type BatchState } from "./state";
import type { BatchTotals } from "./types";

export interface BatchStatusResponse {
  summary: BatchSummary;
  totals: BatchTotals;
  state: BatchState;
  actions: BatchActions;
  items: BatchItemRow[];
}

export interface BatchRunResponse {
  result: RunChunkResult;
  status: BatchStatusResponse;
}

export function toTotals(summary: BatchSummary): BatchTotals {
  return {
    total: summary.total,
    pending: summary.pending,
    succeeded: summary.succeeded,
    failed: summary.failed,
    activeClaims: summary.active_claims,
  };
}

export function buildStatus(summary: BatchSummary, items: BatchItemRow[]): BatchStatusResponse {
  const totals = toTotals(summary);
  const state = deriveBatchState(totals);
  return { summary, totals, state, actions: availableActions(state, totals), items };
}
