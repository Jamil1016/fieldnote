"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { checkAccess, refusalMessage } from "@/lib/auth/session";
import { SupabaseReminderLog } from "@/lib/data/reminders";
import { writeAudit } from "@/lib/data/users";
import { CircuitBreaker, LoggedMailer, runReminders, type RunRemindersResult } from "@/lib/reminders/send";
import { loadReminderPlan } from "@/lib/server/reminders-loader";
import { createServiceClient } from "@/lib/supabase/service";

export type SendResult =
  | { ok: true; result: RunRemindersResult; outbox: { to: string; intendedFor: string; subject: string }[] }
  | { ok: false; error: string };

/**
 * "Send reminders". The candidate list is recomputed on the server (nothing
 * from the client is trusted), the log row is inserted first, and only the
 * run that inserted it hands the message to the mailer. The mailer is
 * LoggedMailer: NOTHING IS DELIVERED, whatever the mode.
 */
export async function sendRemindersAction(): Promise<SendResult> {
  const access = await checkAccess("manager", { mutation: true });
  if (!access.ok) return { ok: false, error: refusalMessage(access.decision.reason, "manager") };

  const db = createServiceClient();
  const plan = await loadReminderPlan(db, new Date());
  const mailer = new LoggedMailer();
  const runId = randomUUID();

  const result = await runReminders({
    candidates: plan.candidates,
    mode: plan.mode,
    sampleInbox: plan.sampleInbox,
    runId,
    log: new SupabaseReminderLog(db),
    mailer,
    breaker: new CircuitBreaker(3),
  });

  if (result.sent > 0 || result.stoppedByBreaker) {
    await writeAudit(db, {
      actorEmail: access.user.email,
      action: "reminders.run",
      entity: "reminder_run",
      entityId: runId,
      detail: { ...result },
    });
  }
  revalidatePath("/reminders");
  return {
    ok: true,
    result,
    outbox: mailer.outbox.map((m) => ({ to: m.to, intendedFor: m.intendedFor, subject: m.subject })),
  };
}
