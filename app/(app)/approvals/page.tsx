import type { Metadata } from "next";
import { ApprovalsWorkbench, type QueueItem } from "@/components/approvals/workbench";
import { PageHeader, StatTile } from "@/components/ui";
import { requireMinRole } from "@/lib/auth/session";
import { hasMinRole } from "@/lib/auth/roles";
import { listQueue, listRecentBatches } from "@/lib/data/approvals";
import { POLICY } from "@/lib/policy";
import { countBuckets, slaStatus } from "@/lib/sla/sla";
import { serverNow } from "@/lib/server/clock";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const user = await requireMinRole("lead");
  const db = createServiceClient();
  const [rows, recentBatches] = await Promise.all([listQueue(db, user.teamScope), listRecentBatches(db, 6)]);

  const now = serverNow();
  const statuses = rows.map((r) => slaStatus(r.filed_at, now));
  const buckets = countBuckets(statuses);
  const items: QueueItem[] = rows.map((r, i) => ({
    reportId: r.report_id,
    memberId: r.member_id,
    memberName: r.member_name,
    memberPosition: r.member_position,
    teamId: r.team_id,
    teamName: r.team_name,
    reportDate: r.report_date,
    hoursClaimed: r.hours_claimed,
    summary: r.summary,
    filedAt: r.filed_at,
    taskCount: r.task_count,
    inOpenBatch: r.in_open_batch,
    bucket: statuses[i].bucket,
    hoursRemaining: statuses[i].hoursRemaining,
  }));
  // Most urgent first.
  items.sort((a, b) => a.hoursRemaining - b.hoursRemaining);

  return (
    <>
      <PageHeader
        eyebrow="Approvals"
        title="Reports awaiting approval"
        description={
          <>
            A filed report must be approved within {POLICY.approvalSlaHours} hours. Select reports and approve them in one
            batch: each approval is written to the project-management API, and the batch survives an outage, a closed tab
            or a second person running it at the same time.
          </>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Awaiting approval" value={rows.length} detail={user.teamScope === null ? "All teams" : "Your teams only"} tone="accent" />
        <StatTile label="Overdue" value={buckets.overdue} detail={`Past the ${POLICY.approvalSlaHours} h window`} tone={buckets.overdue ? "bad" : "ok"} />
        <StatTile label="Due soon" value={buckets.due_soon} detail={`Under ${POLICY.approvalDueSoonHours} h left`} tone={buckets.due_soon ? "warn" : "ok"} />
        <StatTile label="On time" value={buckets.on_time} detail="Comfortably inside the window" tone="ok" />
      </div>
      <ApprovalsWorkbench
        items={items}
        recentBatches={recentBatches}
        canMutate={!user.viewingAs}
        canRestore={hasMinRole(user.role, "manager") && !user.viewingAs}
        scopeNote={user.teamScope === null ? null : "scoped to the teams this lead approves"}
      />
    </>
  );
}
