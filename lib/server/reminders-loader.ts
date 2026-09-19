import "server-only";
import { WorkCalendar } from "../analysis/calendar";
import { listHolidays } from "../data/analysis";
import type { Db } from "../data/db";
import { getSettings, listApproversWithOverdue, listLoggedKeys, listMembersMissingReport } from "../data/reminders";
import { isDemoMode } from "../env";
import {
  dedupeCandidates,
  dedupeKey,
  latestDuePeriod,
  selectMissingReportCandidates,
  selectOverdueCandidates,
  type Candidate,
} from "../reminders/candidates";
import { pinForDemo, resolveSendMode, type SendMode } from "../reminders/mode";

export interface ReminderPlan {
  mode: SendMode;
  configuredMode: string | null;
  sampleInbox: string;
  period: string;
  candidates: Candidate[];
  alreadyLogged: Set<string>;
}

const FALLBACK_INBOX = "reminders-sandbox@example.com";

/** Facts from SQL, rules from lib/reminders. Used by the page and by the send action, so both see the same list. */
export async function loadReminderPlan(db: Db, now: Date): Promise<ReminderPlan> {
  const [holidays, settings] = await Promise.all([listHolidays(db), getSettings(db)]);
  const calendar = new WorkCalendar(holidays);
  const period = latestDuePeriod(now, calendar);

  const [missing, overdue] = await Promise.all([
    listMembersMissingReport(db, period),
    listApproversWithOverdue(db, now.toISOString()),
  ]);
  const candidates = dedupeCandidates([
    ...selectMissingReportCandidates(missing, period),
    ...selectOverdueCandidates(overdue, now),
  ]);
  const alreadyLogged = await listLoggedKeys(db, [...new Set(candidates.map((c) => c.period))]);

  const configuredMode = settings.reminder_mode ?? null;
  const inbox = settings.sample_inbox;
  return {
    // Unknown or missing setting resolves to "preview"; the demo can never be "live".
    mode: pinForDemo(resolveSendMode(configuredMode), isDemoMode()),
    configuredMode,
    sampleInbox: inbox && inbox.endsWith("@example.com") ? inbox : FALLBACK_INBOX,
    period,
    candidates,
    alreadyLogged: new Set([...alreadyLogged].filter((k) => candidates.some((c) => dedupeKey(c) === k))),
  };
}
