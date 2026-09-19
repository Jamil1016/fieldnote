"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkAccess, refusalMessage } from "@/lib/auth/session";
import { checkBatchLimits, messageForSqlError, normalizeReportIds } from "@/lib/batch/limits";
import { clearBatchOutage, createBatch, recentBatchTimes, restoreDemoIfDepleted, retryFailedItems } from "@/lib/data/approvals";
import { DataError } from "@/lib/data/db";
import { POLICY } from "@/lib/policy";
import { createServiceClient } from "@/lib/supabase/service";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const createSchema = z.object({
  reportIds: z.array(z.number().int().positive()).min(1).max(POLICY.batchMaxItems),
  outageAfter: z.number().int().min(0).max(POLICY.batchMaxItems).nullable(),
});

/** Create a durable batch. Guard, validate, rate-limit, then hand over to SQL (which checks again). */
export async function createBatchAction(input: { reportIds: number[]; outageAfter: number | null }): Promise<ActionResult<{ batchId: string }>> {
  const access = await checkAccess("lead", { mutation: true });
  if (!access.ok) return { ok: false, error: refusalMessage(access.decision.reason, "lead") };

  const parsed = createSchema.safeParse({ ...input, reportIds: normalizeReportIds(input.reportIds ?? []) });
  if (!parsed.success) {
    return { ok: false, error: `Select between 1 and ${POLICY.batchMaxItems} reports.` };
  }

  const db = createServiceClient();
  const now = Date.now();
  try {
    const recent = await recentBatchTimes(db, new Date(now - POLICY.batchWindowMinutes * 60_000).toISOString());
    const limit = checkBatchLimits({ itemCount: parsed.data.reportIds.length, recentBatchTimesMs: recent, nowMs: now });
    if (!limit.ok) return { ok: false, error: limit.message };

    const batchId = await createBatch(db, {
      actorEmail: access.user.email,
      reportIds: parsed.data.reportIds,
      teamIds: access.user.teamScope,
      outageAfter: parsed.data.outageAfter,
    });
    return { ok: true, data: { batchId } };
  } catch (error) {
    if (error instanceof DataError) return { ok: false, error: messageForSqlError(error.detail) };
    throw error;
  }
}

const batchIdSchema = z.string().uuid();

export async function retryFailedAction(batchId: string): Promise<ActionResult<{ requeued: number }>> {
  const access = await checkAccess("lead", { mutation: true });
  if (!access.ok) return { ok: false, error: refusalMessage(access.decision.reason, "lead") };
  const id = batchIdSchema.safeParse(batchId);
  if (!id.success) return { ok: false, error: "Unknown batch." };
  const db = createServiceClient();
  // Retrying after a simulated outage only makes sense once the outage is over.
  await clearBatchOutage(db, id.data, access.user.email);
  const requeued = await retryFailedItems(db, id.data, access.user.email);
  return { ok: true, data: { requeued } };
}

/** Resume = end the simulated outage (if any). The client then drives the runner again. */
export async function resumeBatchAction(batchId: string): Promise<ActionResult<{ outageCleared: boolean }>> {
  const access = await checkAccess("lead", { mutation: true });
  if (!access.ok) return { ok: false, error: refusalMessage(access.decision.reason, "lead") };
  const id = batchIdSchema.safeParse(batchId);
  if (!id.success) return { ok: false, error: "Unknown batch." };
  const outageCleared = await clearBatchOutage(createServiceClient(), id.data, access.user.email);
  return { ok: true, data: { outageCleared } };
}

/** Restore the seed when earlier visitors have drained the queue. SQL refuses unless it is nearly empty. */
export async function restoreDemoAction(): Promise<ActionResult<{ restored: boolean }>> {
  const access = await checkAccess("manager", { mutation: true });
  if (!access.ok) return { ok: false, error: refusalMessage(access.decision.reason, "manager") };
  const restored = await restoreDemoIfDepleted(createServiceClient(), access.user.email);
  revalidatePath("/approvals");
  return { ok: true, data: { restored } };
}
