"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendRemindersAction, type SendResult } from "@/app/(app)/reminders/actions";
import type { SendMode } from "@/lib/reminders/mode";
import { Badge, buttonClass, EmptyState, Notice, Panel } from "../ui";

export interface PreviewItem {
  key: string;
  kind: "missing_report" | "approval_overdue";
  name: string;
  intendedFor: string;
  recipient: string | null;
  period: string;
  subject: string;
  html: string;
  alreadyLogged: boolean;
}

const KIND_LABEL = { missing_report: "Missing report", approval_overdue: "Approval overdue" } as const;

export function RemindersClient({ items, mode, canMutate }: { items: PreviewItem[]; mode: SendMode; canMutate: boolean }) {
  const router = useRouter();
  const [selectedKey, setSelectedKey] = useState<string | null>(items[0]?.key ?? null);
  const [runs, setRuns] = useState<Extract<SendResult, { ok: true }>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selected = items.find((i) => i.key === selectedKey) ?? items[0] ?? null;

  function send() {
    setError(null);
    startTransition(async () => {
      const res = await sendRemindersAction();
      if (!res.ok) setError(res.error);
      else setRuns((prev) => [...prev, res]);
      router.refresh();
    });
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={send} disabled={!canMutate || pending || mode === "preview"} className={buttonClass.primary}>
          {pending ? "Running..." : "Send reminders"}
        </button>
        <p className="text-sm text-ink-2">
          {mode === "preview"
            ? "Preview mode renders only, so there is nothing to run."
            : "Nothing leaves this app: the mailer records what it would have sent. Press it twice to see the exactly-once log refuse the second run."}
        </p>
      </div>

      {error ? (
        <div className="mb-4">
          <Notice tone="bad">{error}</Notice>
        </div>
      ) : null}

      {runs.length > 0 ? (
        <Panel title="Runs in this session" className="mb-5" flush>
          <table className="table">
            <thead>
              <tr>
                <th>Run</th>
                <th className="r">Candidates</th>
                <th className="r">New sends</th>
                <th className="r">Skipped, already logged</th>
                <th className="r">Log failures</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run, i) => (
                <tr key={i}>
                  <td className="num">#{i + 1}</td>
                  <td className="r num">{run.result.considered}</td>
                  <td className="r num font-semibold">{run.result.sent}</td>
                  <td className="r num">{run.result.skippedAlreadySent}</td>
                  <td className="r num">{run.result.logFailures}</td>
                  <td>
                    {run.result.stoppedByBreaker ? (
                      <Badge tone="bad">Stopped by circuit breaker</Badge>
                    ) : run.result.sent === 0 ? (
                      <Badge tone="ok">Zero new sends: every reminder was already logged</Badge>
                    ) : (
                      <Badge tone="accent">
                        {run.result.sent} logged for {run.outbox[0]?.to}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Panel title="Who would be reminded right now" aside={`${items.length} recipients`} flush>
          {items.length === 0 ? (
            <EmptyState title="Nobody needs a reminder">Every report is in and no approver holds an overdue report.</EmptyState>
          ) : (
            <ul className="max-h-[560px] divide-y divide-line overflow-auto">
              {items.map((item) => {
                const active = selected?.key === item.key;
                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => setSelectedKey(item.key)}
                      aria-pressed={active}
                      className={`flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left ${active ? "bg-accent-soft" : "hover:bg-sunken"}`}
                    >
                      <span className="min-w-0">
                        <span className="block font-medium">{item.name}</span>
                        <span className="block truncate text-xs text-ink-3">{item.subject}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={item.kind === "missing_report" ? "warn" : "bad"}>{KIND_LABEL[item.kind]}</Badge>
                        {item.alreadyLogged ? <Badge tone="neutral">already logged</Badge> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Rendered email" aside="From the template, with merge fields filled">
          {selected ? (
            <>
              <dl className="mb-3 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-ink-3">To</dt>
                <dd className="num break-all">{selected.recipient ?? "(preview mode: no recipient)"}</dd>
                <dt className="text-ink-3">Intended for</dt>
                <dd className="num break-all">{selected.intendedFor}</dd>
                <dt className="text-ink-3">Subject</dt>
                <dd className="font-medium">{selected.subject}</dd>
                <dt className="text-ink-3">Log key</dt>
                <dd className="num break-all text-xs text-ink-2">{selected.key}</dd>
              </dl>
              <iframe
                title="Email body preview"
                sandbox=""
                srcDoc={`<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#101b25;margin:16px">${selected.html}</body></html>`}
                className="h-64 w-full rounded-sm border border-line bg-white"
              />
            </>
          ) : (
            <EmptyState title="Nothing to preview" />
          )}
        </Panel>
      </div>
    </>
  );
}
