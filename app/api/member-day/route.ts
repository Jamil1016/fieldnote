import { z } from "zod";
import { isDay } from "@/lib/analysis/calendar";
import { requireApiRole } from "@/lib/auth/session";
import { getMemberDayDetail } from "@/lib/data/approvals";
import { getDirectoryMember } from "@/lib/data/directory";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  member: z.coerce.number().int().positive(),
  date: z.string().refine(isDay, "Invalid date"),
});

/** One member-day: report, task lines and timer entries. Used by both drawers. */
export async function GET(request: Request) {
  const auth = await requireApiRole("lead");
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ member: url.searchParams.get("member"), date: url.searchParams.get("date") });
  if (!parsed.success) return Response.json({ error: "Expected ?member=<id>&date=YYYY-MM-DD." }, { status: 400 });

  const db = createServiceClient();
  // A lead may only open member-days inside their own teams.
  if (auth.user.teamScope !== null) {
    const member = await getDirectoryMember(db, parsed.data.member);
    if (!member || !auth.user.teamScope.includes(member.team_id)) {
      return Response.json({ error: "That member is outside your teams." }, { status: 403 });
    }
  }

  const detail = await getMemberDayDetail(db, parsed.data.member, parsed.data.date);
  if (!detail.member) return Response.json({ error: "Unknown member." }, { status: 404 });
  return Response.json(detail, { headers: { "cache-control": "no-store" } });
}
