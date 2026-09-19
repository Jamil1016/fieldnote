import type { Metadata } from "next";
import { RemindersClient, type PreviewItem } from "@/components/reminders/reminders-client";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";
import { requireMinRole } from "@/lib/auth/session";
import { listReminderLog } from "@/lib/data/reminders";
import { fmtDateTime, fmtDay } from "@/lib/format";
import { POLICY } from "@/lib/policy";
import { dedupeKey } from "@/lib/reminders/candidates";
import { MODE_DESCRIPTION, recipientFor, type SendMode } from "@/lib/reminders/mode";
import { renderEmail } from "@/lib/reminders/template";
import { loadReminderPlan } from "@/lib/server/reminders-loader";
import { serverNow } from "@/lib/server/clock";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "Reminders" };

const MODES: SendMode[] = ["preview", "sample", "live"];

export default async function RemindersPage() {
  const user = await requireMinRole("manager");
  const db = createServiceClient();
  const [plan, log] = await Promise.all([loadReminderPlan(db, serverNow()), listReminderLog(db, 40)]);

  const items: PreviewItem[] = plan.candidates.map((c) => {
    const email = renderEmail(c);
    const key = dedupeKey(c);
    return {
      key,
      kind: c.kind,
      name: c.name,
      intendedFor: c.email,
      recipient: recipientFor(plan.mode, c.email, plan.sampleInbox),
      period: c.period,
      subject: email.subject,
      html: email.html,
      alreadyLogged: plan.alreadyLogged.has(key),
    };
  });

  return (
    <>
      <PageHeader
        eyebrow="Reminders"
        title="Reminders"
        description={
          <>
            Members whose report for {fmtDay(plan.period)} is still missing after the {String(POLICY.reportCutoffHourUtc).padStart(2, "0")}:00 UTC
            cutoff, and approvers holding reports past the {POLICY.approvalSlaHours} hour window. Each reminder is logged
            exactly once per person and period.
          </>
        }
      />

      <Panel title="Send mode" aside="A server-side setting. Visitors cannot change it." className="mb-5">
        <div className="grid gap-3 md:grid-cols-3">
          {MODES.map((m) => {
            const active = plan.mode === m;
            return (
              <div key={m} className={`rounded-sm border px-3 py-2.5 ${active ? "border-accent bg-accent-soft" : "border-line bg-sunken opacity-75"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold capitalize">{m}</span>
                  {active ? <Badge tone="accent">active</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-ink-2">{MODE_DESCRIPTION[m]}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-ink-2">
          Stored value: <span className="num">{plan.configuredMode ?? "(none)"}</span>. Anything other than{" "}
          <span className="num">sample</span> or <span className="num">live</span> resolves to preview, and the public demo is
          pinned so that <span className="num">live</span> becomes sample. Sample inbox:{" "}
          <span className="num">{plan.sampleInbox}</span>. In this app no mode delivers mail; the only mailer records what it
          would have sent.
        </p>
      </Panel>

      <RemindersClient items={items} mode={plan.mode} canMutate={!user.viewingAs} />

      <Panel title="Reminder log" aside="UNIQUE (kind, subject_key, period), insert first" className="mt-5" flush>
        {log.length === 0 ? (
          <EmptyState title="The log is empty">Press Send reminders to write the first rows. The nightly reset clears them.</EmptyState>
        ) : (
          <div className="max-h-80 overflow-auto">
            <table className="table">
              <thead className="sticky top-0">
                <tr>
                  <th>Logged (UTC)</th>
                  <th>Kind</th>
                  <th>Subject key</th>
                  <th>Period</th>
                  <th>Mode</th>
                  <th>Addressed to</th>
                  <th>Intended for</th>
                  <th>Delivery</th>
                </tr>
              </thead>
              <tbody>
                {log.map((row) => (
                  <tr key={row.id}>
                    <td className="num whitespace-nowrap text-ink-2">{fmtDateTime(row.created_at)}</td>
                    <td>{row.kind === "missing_report" ? "Missing report" : "Approval overdue"}</td>
                    <td className="num">{row.subject_key}</td>
                    <td className="num">{row.period}</td>
                    <td>{row.mode}</td>
                    <td className="num text-xs">{row.recipient}</td>
                    <td className="num text-xs text-ink-2">{row.intended_recipient}</td>
                    <td>
                      <Badge tone={row.delivery === "logged" ? "ok" : row.delivery === "failed" ? "bad" : "neutral"}>
                        {row.delivery === "logged" ? "recorded, not sent" : row.delivery}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
