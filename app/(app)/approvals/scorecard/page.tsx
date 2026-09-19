import type { Metadata } from "next";
import { ScorecardTable } from "@/components/approvals/scorecard-table";
import { EmptyState, PageHeader, Panel, StatTile } from "@/components/ui";
import { requireMinRole } from "@/lib/auth/session";
import { getScorecard } from "@/lib/data/approvals";
import { POLICY } from "@/lib/policy";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "Approver scorecard" };

export default async function ScorecardPage() {
  await requireMinRole("manager");
  const rows = await getScorecard(createServiceClient(), 30);

  const approved = rows.reduce((n, r) => n + r.approved_count, 0);
  const within = rows.reduce((n, r) => n + (r.pct_within_sla === null ? 0 : (r.pct_within_sla / 100) * r.approved_count), 0);
  const slowest = [...rows].filter((r) => r.median_hours_to_approve !== null).sort((a, b) => (b.median_hours_to_approve ?? 0) - (a.median_hours_to_approve ?? 0))[0];
  const overdue = rows.reduce((n, r) => Math.max(n, r.overdue_backlog), 0);

  return (
    <>
      <PageHeader
        eyebrow="Approvals"
        title="Approver scorecard"
        description={
          <>
            The last 30 days, per approver, computed in one SQL function. The line on the median bar marks the{" "}
            {POLICY.approvalSlaHours} hour SLA. A team with two approvers shares its backlog, so that backlog counts for both.
          </>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatTile label="Approved, 30 days" value={approved} tone="accent" />
        <StatTile
          label="Within SLA overall"
          value={approved ? `${((within / approved) * 100).toFixed(1)}%` : "-"}
          detail={`Approved inside ${POLICY.approvalSlaHours} h of filing`}
          tone={approved && within / approved >= 0.8 ? "ok" : "warn"}
        />
        <StatTile
          label="Slowest median"
          value={slowest?.median_hours_to_approve != null ? `${slowest.median_hours_to_approve.toFixed(1)} h` : "-"}
          detail={slowest ? `${slowest.approver_name}, largest overdue backlog ${overdue}` : undefined}
          tone="bad"
        />
      </div>
      <Panel title="Per approver" aside="Click a column to sort" flush>
        {rows.length === 0 ? <EmptyState title="No approvers are assigned to a team yet" /> : <ScorecardTable rows={rows} />}
      </Panel>
    </>
  );
}
