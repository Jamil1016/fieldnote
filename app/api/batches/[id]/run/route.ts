import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { buildStatus } from "@/lib/batch/api-types";
import { outageFault, runChunk } from "@/lib/batch/runner";
import { getBatchSummary, listBatchItems, SupabaseBatchStore, SupabasePmLedger } from "@/lib/data/approvals";
import { isSameOrigin } from "@/lib/http";
import { SimulatedPmApi } from "@/lib/pm-api/simulated";
import type { PmApi } from "@/lib/pm-api/types";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The worker. One POST = one chunk: claim a few items (FOR UPDATE SKIP LOCKED),
 * send each to the PM API, record each outcome. The caller repeats until the
 * response says idle or halted. Any number of callers may run the same batch
 * at once; the claim keeps them on disjoint items.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/batches/[id]/run">) {
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin request refused." }, { status: 403 });
  const auth = await requireApiRole("lead", { mutation: true });
  if (auth.response) return auth.response;

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Unknown batch." }, { status: 404 });

  const db = createServiceClient();
  const store = new SupabaseBatchStore(db, { email: auth.user.email, memberId: auth.user.memberId });
  const meta = await store.getMeta(id);
  if (!meta) return Response.json({ error: "Unknown batch." }, { status: 404 });

  // The only PmApi implementation in this app. A real HTTP client would be
  // constructed here instead; nothing else would change.
  const simulated: SimulatedPmApi = new SimulatedPmApi({
    ledger: new SupabasePmLedger(db),
    fault: outageFault(meta, () => simulated.accepted),
  });
  const api: PmApi = simulated;

  const result = await runChunk({
    store,
    api,
    batchId: id,
    runnerId: `web-${randomUUID().slice(0, 8)}`,
    approverEmail: auth.user.email,
  });

  const [summary, items] = await Promise.all([getBatchSummary(db, id), listBatchItems(db, id)]);
  if (!summary) return Response.json({ error: "Unknown batch." }, { status: 404 });
  return Response.json({ result, status: buildStatus(summary, items) }, { headers: { "cache-control": "no-store" } });
}
