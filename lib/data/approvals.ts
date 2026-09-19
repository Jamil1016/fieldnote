import { z } from "zod";
import type { BatchMeta, BatchStore, ClaimedItem, ItemOutcome } from "../batch/types";
import type { PmLedger } from "../pm-api/simulated";
import { DataError, unwrap, type Db } from "./db";

// ---- queue -------------------------------------------------------------------

export const queueRowSchema = z.object({
  report_id: z.number().int(),
  member_id: z.number().int(),
  member_name: z.string(),
  member_position: z.string(),
  team_id: z.number().int(),
  team_name: z.string(),
  client_label: z.string(),
  report_date: z.string(),
  hours_claimed: z.coerce.number(),
  summary: z.string(),
  filed_at: z.string(),
  approval_due_at: z.string(),
  task_count: z.number().int(),
  in_open_batch: z.boolean(),
});
export type QueueRow = z.infer<typeof queueRowSchema>;

/** teamIds: null = every team, [] = none. */
export async function listQueue(db: Db, teamIds: readonly number[] | null): Promise<QueueRow[]> {
  if (teamIds !== null && teamIds.length === 0) return [];
  let query = db.schema("fn_analytics").from("v_approval_queue").select("*").order("filed_at", { ascending: true }).limit(1000);
  if (teamIds !== null) query = query.in("team_id", [...teamIds]);
  const rows = unwrap("listQueue", await query);
  return z.array(queueRowSchema).parse(rows);
}

export async function listApproverTeamIds(db: Db, memberId: number | null): Promise<number[]> {
  if (memberId === null) return [];
  const rows = unwrap(
    "listApproverTeamIds",
    await db.schema("fn_analytics").from("v_approver_teams").select("team_id").eq("approver_member_id", memberId),
  );
  return z.array(z.object({ team_id: z.number().int() })).parse(rows).map((r) => r.team_id);
}

// ---- member-day detail ---------------------------------------------------------

export const memberDayDetailSchema = z.object({
  member: z
    .object({
      member_id: z.number().int(),
      full_name: z.string(),
      team_name: z.string(),
      position: z.string(),
      shift: z.string(),
      lead_name: z.string().nullable(),
    })
    .nullable(),
  date: z.string(),
  report: z
    .object({
      report_id: z.number().int(),
      hours_claimed: z.coerce.number(),
      summary: z.string(),
      filed_at: z.string(),
      status: z.enum(["awaiting", "approved"]),
      approved_at: z.string().nullable(),
    })
    .nullable(),
  task_lines: z.array(
    z.object({ line_no: z.number().int(), task_name: z.string(), client_label: z.string(), hours: z.coerce.number() }),
  ),
  timer_entries: z.array(
    z.object({ id: z.number().int(), started_at: z.string(), ended_at: z.string(), task_name: z.string() }),
  ),
});
export type MemberDayDetail = z.infer<typeof memberDayDetailSchema>;

export async function getMemberDayDetail(db: Db, memberId: number, day: string): Promise<MemberDayDetail> {
  const data = unwrap(
    "getMemberDayDetail",
    await db.schema("fn_analytics").rpc("member_day_detail", { p_member_id: memberId, p_date: day }),
  );
  return memberDayDetailSchema.parse(data);
}

// ---- batches -------------------------------------------------------------------

export const batchSummarySchema = z.object({
  batch_id: z.string(),
  created_by: z.string(),
  created_at: z.string(),
  outage_after: z.number().int().nullable(),
  outage_cleared: z.boolean(),
  total: z.number().int(),
  pending: z.number().int(),
  succeeded: z.number().int(),
  failed: z.number().int(),
  active_claims: z.number().int(),
  last_activity_at: z.string().nullable(),
});
export type BatchSummary = z.infer<typeof batchSummarySchema>;

export const batchItemSchema = z.object({
  item_id: z.number().int(),
  batch_id: z.string(),
  report_id: z.number().int(),
  status: z.enum(["pending", "succeeded", "failed"]),
  attempts: z.number().int(),
  last_error: z.string().nullable(),
  claimed_at: z.string().nullable(),
  claimed_by: z.string().nullable(),
  pm_reference: z.string().nullable(),
  finished_at: z.string().nullable(),
  member_name: z.string(),
  team_name: z.string(),
  report_date: z.string(),
  hours_claimed: z.coerce.number(),
});
export type BatchItemRow = z.infer<typeof batchItemSchema>;

export async function createBatch(
  db: Db,
  input: { actorEmail: string; reportIds: readonly number[]; teamIds: readonly number[] | null; outageAfter: number | null },
): Promise<string> {
  const result = await db.schema("fn_app").rpc("create_approval_batch", {
    p_actor_email: input.actorEmail,
    p_report_ids: [...input.reportIds],
    p_team_ids: input.teamIds === null ? null : [...input.teamIds],
    p_outage_after: input.outageAfter,
  });
  return z.string().uuid().parse(unwrap("createBatch", result));
}

export async function recentBatchTimes(db: Db, sinceIso: string): Promise<number[]> {
  const rows = unwrap(
    "recentBatchTimes",
    await db.schema("fn_app").from("approval_batch").select("created_at").gte("created_at", sinceIso).limit(100),
  );
  return z.array(z.object({ created_at: z.string() })).parse(rows).map((r) => Date.parse(r.created_at));
}

export async function getBatchSummary(db: Db, batchId: string): Promise<BatchSummary | null> {
  const rows = unwrap(
    "getBatchSummary",
    await db.schema("fn_analytics").from("v_batch_summary").select("*").eq("batch_id", batchId).limit(1),
  );
  const parsed = z.array(batchSummarySchema).parse(rows);
  return parsed[0] ?? null;
}

export async function listBatchItems(db: Db, batchId: string): Promise<BatchItemRow[]> {
  const rows = unwrap(
    "listBatchItems",
    await db.schema("fn_analytics").from("v_batch_items").select("*").eq("batch_id", batchId).order("item_id").limit(250),
  );
  return z.array(batchItemSchema).parse(rows);
}

export async function listRecentBatches(db: Db, limit = 8): Promise<BatchSummary[]> {
  const rows = unwrap(
    "listRecentBatches",
    await db.schema("fn_analytics").from("v_batch_summary").select("*").order("created_at", { ascending: false }).limit(limit),
  );
  return z.array(batchSummarySchema).parse(rows);
}

export async function retryFailedItems(db: Db, batchId: string, actorEmail: string): Promise<number> {
  const data = unwrap(
    "retryFailedItems",
    await db.schema("fn_app").rpc("retry_failed_items", { p_batch_id: batchId, p_actor_email: actorEmail }),
  );
  return z.number().int().parse(data);
}

export async function clearBatchOutage(db: Db, batchId: string, actorEmail: string): Promise<boolean> {
  const data = unwrap(
    "clearBatchOutage",
    await db.schema("fn_app").rpc("clear_batch_outage", { p_batch_id: batchId, p_actor_email: actorEmail }),
  );
  return z.boolean().parse(data);
}

export async function restoreDemoIfDepleted(db: Db, actorEmail: string): Promise<boolean> {
  const data = unwrap(
    "restoreDemoIfDepleted",
    await db.schema("fn_app").rpc("restore_demo_if_depleted", { p_actor_email: actorEmail }),
  );
  return z.boolean().parse(data);
}

/** BatchStore over the Postgres functions (claim = FOR UPDATE SKIP LOCKED). */
export class SupabaseBatchStore implements BatchStore {
  constructor(
    private readonly db: Db,
    private readonly actor: { email: string; memberId: number | null },
  ) {}

  async getMeta(batchId: string): Promise<BatchMeta | null> {
    const summary = await getBatchSummary(this.db, batchId);
    if (!summary) return null;
    return {
      batchId,
      outageAfter: summary.outage_after,
      outageCleared: summary.outage_cleared,
      succeeded: summary.succeeded,
    };
  }

  async claim(batchId: string, limit: number, runner: string): Promise<ClaimedItem[]> {
    const rows = unwrap(
      "claimBatchItems",
      await this.db.schema("fn_app").rpc("claim_batch_items", { p_batch_id: batchId, p_limit: limit, p_runner: runner }),
    );
    return z
      .array(z.object({ item_id: z.number().int(), report_id: z.number().int(), attempts: z.number().int() }))
      .parse(rows)
      .map((r) => ({ itemId: r.item_id, reportId: r.report_id, attempts: r.attempts }));
  }

  async complete(itemId: number, runner: string, outcome: ItemOutcome): Promise<boolean> {
    const data = unwrap(
      "completeBatchItem",
      await this.db.schema("fn_app").rpc("complete_batch_item", {
        p_item_id: itemId,
        p_runner: runner,
        p_ok: outcome.ok,
        p_reference: outcome.ok ? outcome.reference : null,
        p_error: outcome.ok ? null : outcome.error,
        p_actor_email: this.actor.email,
        p_actor_member_id: this.actor.memberId,
      }),
    );
    return z.boolean().parse(data);
  }

  async release(itemIds: readonly number[], runner: string): Promise<number> {
    if (itemIds.length === 0) return 0;
    const data = unwrap(
      "releaseBatchItems",
      await this.db.schema("fn_app").rpc("release_batch_items", { p_item_ids: [...itemIds], p_runner: runner }),
    );
    return z.number().int().parse(data);
  }
}

/** The simulated PM system's memory of accepted idempotency keys, in Postgres. */
export class SupabasePmLedger implements PmLedger {
  constructor(private readonly db: Db) {}

  async record(key: string, reference: string) {
    const inserted = await this.db
      .schema("fn_app")
      .from("pm_sim_ledger")
      .upsert({ idempotency_key: key, reference }, { onConflict: "idempotency_key", ignoreDuplicates: true })
      .select("idempotency_key");
    if (inserted.error) throw new DataError("pmLedger.record", inserted.error.message);
    if (inserted.data && inserted.data.length > 0) return { outcome: "inserted" as const };

    const existing = unwrap(
      "pmLedger.lookup",
      await this.db.schema("fn_app").from("pm_sim_ledger").select("reference").eq("idempotency_key", key).limit(1),
    );
    const ref = z.array(z.object({ reference: z.string() })).parse(existing)[0]?.reference ?? "unknown";
    return { outcome: "duplicate" as const, reference: ref };
  }
}

// ---- scorecard -----------------------------------------------------------------

export const scorecardRowSchema = z.object({
  approver_member_id: z.number().int(),
  approver_name: z.string(),
  teams: z.string(),
  approved_count: z.number().int(),
  median_hours_to_approve: z.coerce.number().nullable(),
  pct_within_sla: z.coerce.number().nullable(),
  backlog: z.number().int(),
  overdue_backlog: z.number().int(),
});
export type ScorecardRow = z.infer<typeof scorecardRowSchema>;

export async function getScorecard(db: Db, days = 30): Promise<ScorecardRow[]> {
  const rows = unwrap("getScorecard", await db.schema("fn_analytics").rpc("approver_scorecard", { p_days: days }));
  return z.array(scorecardRowSchema).parse(rows);
}
