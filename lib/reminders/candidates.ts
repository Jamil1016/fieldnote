/**
 * Who should be reminded. Pure: facts come in (who has not filed for a date,
 * which approvers hold overdue reports), rules are applied here.
 *
 * Rules (invented):
 *   - The report for working day D is due by 10:00 UTC on the next working day.
 *   - Once that cutoff passes, anyone active who has not filed for D gets one
 *     "missing report" reminder for D.
 *   - An approver holding reports past the 48 h approval SLA gets one
 *     "approval overdue" reminder per calendar day.
 */
import { POLICY } from "../policy";
import { msToDay, type Day, type WorkCalendar } from "../analysis/calendar";
import { filingDeadline } from "../sla/sla";

export type ReminderKind = "missing_report" | "approval_overdue";

export interface Candidate {
  kind: ReminderKind;
  /** Who the reminder is about, e.g. "member:17". */
  subjectKey: string;
  /** What it covers: the report date, or today's date for approver nudges. */
  period: string;
  name: string;
  email: string;
  fields: Record<string, string>;
}

export interface MissingMemberFact {
  member_id: number;
  full_name: string;
  email: string;
  team_name: string;
  lead_name: string | null;
}

export interface OverdueApproverFact {
  approver_member_id: number;
  full_name: string;
  email: string;
  overdue_count: number;
  oldest_filed_at: string | null;
}

/**
 * The most recent working day whose filing cutoff has already passed at `now`.
 * On a Saturday that is Thursday (Friday's reports are not due until Monday).
 */
export function latestDuePeriod(
  now: Date,
  calendar: WorkCalendar,
  cutoffHourUtc: number = POLICY.reportCutoffHourUtc,
): Day {
  let day = calendar.previousWorkingDay(msToDay(now.getTime() + 86_400_000));
  // `day` starts at the latest working day <= today; walk back until its
  // deadline (cutoff on the following working day) is in the past.
  for (let guard = 0; guard < 400; guard += 1) {
    const deadline = filingDeadline(calendar.nextWorkingDay(day), cutoffHourUtc);
    if (deadline.getTime() <= now.getTime()) return day;
    day = calendar.previousWorkingDay(day);
  }
  throw new Error("latestDuePeriod: no due period found");
}

function validEmail(email: string | null | undefined): email is string {
  return typeof email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export function selectMissingReportCandidates(facts: readonly MissingMemberFact[], period: Day): Candidate[] {
  return facts
    .filter((f) => validEmail(f.email))
    .map((f) => ({
      kind: "missing_report" as const,
      subjectKey: `member:${f.member_id}`,
      period,
      name: f.full_name,
      email: f.email,
      fields: {
        name: f.full_name,
        first_name: f.full_name.split(" ")[0] ?? f.full_name,
        report_date: period,
        team: f.team_name,
        lead: f.lead_name ?? "your lead",
      },
    }));
}

export function selectOverdueCandidates(facts: readonly OverdueApproverFact[], now: Date): Candidate[] {
  const today = msToDay(now.getTime());
  return facts
    .filter((f) => f.overdue_count > 0 && validEmail(f.email))
    .map((f) => ({
      kind: "approval_overdue" as const,
      subjectKey: `member:${f.approver_member_id}`,
      period: today,
      name: f.full_name,
      email: f.email,
      fields: {
        name: f.full_name,
        first_name: f.full_name.split(" ")[0] ?? f.full_name,
        overdue_count: String(f.overdue_count),
        report_word: f.overdue_count === 1 ? "report" : "reports",
        oldest_filed: f.oldest_filed_at ? msToDay(Date.parse(f.oldest_filed_at)) : "unknown",
        sla_hours: String(POLICY.approvalSlaHours),
      },
    }));
}

/** The exactly-once key. Matches the UNIQUE (kind, subject_key, period) constraint. */
export function dedupeKey(c: Pick<Candidate, "kind" | "subjectKey" | "period">): string {
  return `${c.kind}|${c.subjectKey}|${c.period}`;
}

/** Drop repeats inside one run (first wins) so a run never competes with itself. */
export function dedupeCandidates(candidates: readonly Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of candidates) {
    const key = dedupeKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
