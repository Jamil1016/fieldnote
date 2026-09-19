import { msToDay } from "@/lib/analysis/calendar";
import { analysisCsvRows } from "@/lib/analysis/export";
import { filterGroups } from "@/lib/analysis/heatmap";
import { requireApiRole } from "@/lib/auth/session";
import { csvStream } from "@/lib/csv/csv";
import { loadAnalysis, parseTeamParam } from "@/lib/server/analysis-loader";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** CSV of the current heatmap view (same team filter, same role scope), streamed. */
export async function GET(request: Request) {
  const auth = await requireApiRole("lead");
  if (auth.response) return auth.response;

  const now = new Date();
  const teamId = parseTeamParam(new URL(request.url).searchParams.get("team"));
  const analysis = await loadAnalysis(createServiceClient(), { teamScope: auth.user.teamScope, now });
  const groups = filterGroups(analysis.current.groups, teamId);

  return new Response(csvStream(analysisCsvRows(groups), { bom: true }), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="fieldnote-hours-variance-${msToDay(now.getTime())}.csv"`,
      "cache-control": "no-store",
    },
  });
}
