import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/ui";
import { requireMinRole } from "@/lib/auth/session";
import { listAudit } from "@/lib/data/users";
import { fmtDateTime } from "@/lib/format";
import { POLICY } from "@/lib/policy";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "Policy" };

/** HR staff and above. The demo user is a manager, so this page exists to show a tier ABOVE the visitor being refused. */
export default async function PolicyPage() {
  await requireMinRole("hr_staff");
  const audit = await listAudit(createServiceClient(), 25);
  const rows: [string, string][] = [
    ["Approval SLA", `${POLICY.approvalSlaHours} hours from filing`],
    ["Due soon", `Under ${POLICY.approvalDueSoonHours} hours left`],
    ["Variance breach line", `${POLICY.varianceBreach * 100}% either way`],
    ["Variance watch line", `${POLICY.varianceWatch * 100}%`],
    ["Report cutoff", `${POLICY.reportCutoffHourUtc}:00 UTC on the next working day`],
    ["Data freshness limit", `${POLICY.freshnessMaxAgeHours} hours`],
    ["Batch size limit", `${POLICY.batchMaxItems} reports`],
    ["Batch rate limit", `${POLICY.batchMaxPerWindow} per ${POLICY.batchWindowMinutes} minutes`],
  ];
  return (
    <>
      <PageHeader eyebrow="Policy" title="Policy numbers and audit trail" description="Read-only. Every number here is invented for the demo." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Policy" flush>
          <table className="table">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <td className="text-ink-2">{k}</td>
                  <td className="r num">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Latest audit rows" flush>
          <table className="table">
            <thead>
              <tr>
                <th>When (UTC)</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td className="num whitespace-nowrap text-ink-2">{fmtDateTime(a.created_at)}</td>
                  <td className="num text-xs">{a.actor_email}</td>
                  <td>{a.action}</td>
                  <td className="num text-xs text-ink-2">
                    {a.entity} {a.entity_id.slice(0, 12)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
