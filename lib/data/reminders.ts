import { z } from "zod";
import type { ReminderLogRow, ReminderLogStore } from "../reminders/send";
import { DataError, unwrap, type Db } from "./db";

const missingSchema = z.object({
  member_id: z.number().int(),
  full_name: z.string(),
  email: z.string(),
  team_name: z.string(),
  lead_name: z.string().nullable(),
});

const overdueSchema = z.object({
  approver_member_id: z.number().int(),
  full_name: z.string(),
  email: z.string(),
  overdue_count: z.number().int(),
  oldest_filed_at: z.string().nullable(),
});

export async function listMembersMissingReport(db: Db, day: string) {
  const rows = unwrap(
    "listMembersMissingReport",
    await db.schema("fn_analytics").rpc("members_missing_report", { p_date: day }),
  );
  return z.array(missingSchema).parse(rows);
}

export async function listApproversWithOverdue(db: Db, nowIso: string) {
  const rows = unwrap(
    "listApproversWithOverdue",
    await db.schema("fn_analytics").rpc("approvers_with_overdue", { p_now: nowIso }),
  );
  return z.array(overdueSchema).parse(rows);
}

export async function getSettings(db: Db): Promise<Record<string, string>> {
  const rows = unwrap("getSettings", await db.schema("fn_app").from("settings").select("key, value"));
  const out: Record<string, string> = {};
  for (const row of z.array(z.object({ key: z.string(), value: z.string() })).parse(rows)) out[row.key] = row.value;
  return out;
}

export const reminderLogRowSchema = z.object({
  id: z.number().int(),
  kind: z.enum(["missing_report", "approval_overdue"]),
  subject_key: z.string(),
  period: z.string(),
  mode: z.string(),
  recipient: z.string(),
  intended_recipient: z.string(),
  subject: z.string(),
  run_id: z.string(),
  delivery: z.string(),
  created_at: z.string(),
});
export type ReminderLogEntry = z.infer<typeof reminderLogRowSchema>;

export async function listReminderLog(db: Db, limit = 50): Promise<ReminderLogEntry[]> {
  const rows = unwrap(
    "listReminderLog",
    await db.schema("fn_app").from("reminder_log").select("*").order("id", { ascending: false }).limit(limit),
  );
  return z.array(reminderLogRowSchema).parse(rows);
}

/** Keys already logged for the given periods, to mark candidates "already sent" in the preview. */
export async function listLoggedKeys(db: Db, periods: readonly string[]): Promise<Set<string>> {
  if (periods.length === 0) return new Set();
  const rows = unwrap(
    "listLoggedKeys",
    await db.schema("fn_app").from("reminder_log").select("kind, subject_key, period").in("period", [...periods]).limit(1000),
  );
  return new Set(
    z
      .array(z.object({ kind: z.string(), subject_key: z.string(), period: z.string() }))
      .parse(rows)
      .map((r) => `${r.kind}|${r.subject_key}|${r.period}`),
  );
}

/**
 * Insert-first log. `upsert(..., { ignoreDuplicates: true }).select()` is sent
 * as INSERT ... ON CONFLICT (kind, subject_key, period) DO NOTHING RETURNING:
 * the row comes back only to the caller whose insert created it.
 */
export class SupabaseReminderLog implements ReminderLogStore {
  constructor(private readonly db: Db) {}

  async insertFirst(row: ReminderLogRow): Promise<"inserted" | "duplicate"> {
    const result = await this.db
      .schema("fn_app")
      .from("reminder_log")
      .upsert(
        {
          kind: row.kind,
          subject_key: row.subjectKey,
          period: row.period,
          mode: row.mode,
          recipient: row.recipient,
          intended_recipient: row.intendedRecipient,
          subject: row.subject,
          run_id: row.runId,
        },
        { onConflict: "kind,subject_key,period", ignoreDuplicates: true },
      )
      .select("id");
    if (result.error) throw new DataError("reminderLog.insertFirst", result.error.message);
    return result.data && result.data.length > 0 ? "inserted" : "duplicate";
  }

  async markDelivery(row: Pick<ReminderLogRow, "kind" | "subjectKey" | "period">, delivery: "logged" | "failed"): Promise<void> {
    const result = await this.db
      .schema("fn_app")
      .from("reminder_log")
      .update({ delivery })
      .eq("kind", row.kind)
      .eq("subject_key", row.subjectKey)
      .eq("period", row.period);
    if (result.error) throw new DataError("reminderLog.markDelivery", result.error.message);
  }
}
