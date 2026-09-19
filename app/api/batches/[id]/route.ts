import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { buildStatus } from "@/lib/batch/api-types";
import { getBatchSummary, listBatchItems } from "@/lib/data/approvals";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** Batch status for the progress panel (polled once a second while a batch runs). */
export async function GET(_request: Request, ctx: RouteContext<"/api/batches/[id]">) {
  const auth = await requireApiRole("lead");
  if (auth.response) return auth.response;

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Unknown batch." }, { status: 404 });

  const db = createServiceClient();
  const [summary, items] = await Promise.all([getBatchSummary(db, id), listBatchItems(db, id)]);
  if (!summary) return Response.json({ error: "Unknown batch." }, { status: 404 });

  return Response.json(buildStatus(summary, items), { headers: { "cache-control": "no-store" } });
}
