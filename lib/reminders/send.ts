/**
 * The reminder send path.
 *
 * EXACTLY-ONCE LOG, INSERT FIRST
 *   For each candidate the run first tries to insert the log row
 *   (INSERT ... ON CONFLICT (kind, subject_key, period) DO NOTHING RETURNING).
 *   Only the run that actually inserted the row hands the message to the
 *   mailer. A second run, a double click, or two overlapping runs therefore
 *   produce zero extra messages: the database decides the winner, not a
 *   read-then-write check in application code.
 *   The trade-off is deliberate: a crash between insert and send loses that
 *   one reminder (at-most-once delivery) rather than ever sending it twice.
 *
 * CIRCUIT BREAKER
 *   If log writes start failing, the run stops. Sending without a working log
 *   would break the guarantee above.
 *
 * NOTHING IS DELIVERED in this app: the Mailer is an interface and the only
 * implementation, LoggedMailer, records what would have gone out.
 */
import type { Candidate } from "./candidates";
import { dedupeCandidates } from "./candidates";
import { recipientFor, type SendMode } from "./mode";
import { renderEmail } from "./template";

export interface OutgoingMessage {
  to: string;
  intendedFor: string;
  subject: string;
  html: string;
}

export interface Mailer {
  send(message: OutgoingMessage): Promise<void>;
}

/** Records messages instead of delivering them. */
export class LoggedMailer implements Mailer {
  readonly outbox: OutgoingMessage[] = [];

  async send(message: OutgoingMessage): Promise<void> {
    this.outbox.push(message);
  }
}

export interface ReminderLogRow {
  kind: Candidate["kind"];
  subjectKey: string;
  period: string;
  mode: Exclude<SendMode, "preview">;
  recipient: string;
  intendedRecipient: string;
  subject: string;
  runId: string;
}

export interface ReminderLogStore {
  /** Insert-first. "inserted" only for the caller that created the row. */
  insertFirst(row: ReminderLogRow): Promise<"inserted" | "duplicate">;
  markDelivery(row: Pick<ReminderLogRow, "kind" | "subjectKey" | "period">, delivery: "logged" | "failed"): Promise<void>;
}

export class CircuitBreaker {
  private consecutiveFailures = 0;
  private opened = false;

  constructor(private readonly threshold: number = 3) {
    if (!Number.isInteger(threshold) || threshold < 1) throw new Error("CircuitBreaker: threshold must be >= 1");
  }

  recordSuccess(): void {
    if (!this.opened) this.consecutiveFailures = 0;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.threshold) this.opened = true;
  }

  /** Once open it stays open for the rest of the run. */
  get isOpen(): boolean {
    return this.opened;
  }

  get failures(): number {
    return this.consecutiveFailures;
  }
}

export interface RunRemindersOptions {
  candidates: readonly Candidate[];
  mode: SendMode;
  sampleInbox: string;
  runId: string;
  log: ReminderLogStore;
  mailer: Mailer;
  breaker?: CircuitBreaker;
}

export interface RunRemindersResult {
  mode: SendMode;
  considered: number;
  sent: number;
  skippedAlreadySent: number;
  logFailures: number;
  mailFailures: number;
  notAttempted: number;
  stoppedByBreaker: boolean;
}

export async function runReminders(options: RunRemindersOptions): Promise<RunRemindersResult> {
  const candidates = dedupeCandidates(options.candidates);
  const breaker = options.breaker ?? new CircuitBreaker(3);
  const result: RunRemindersResult = {
    mode: options.mode,
    considered: candidates.length,
    sent: 0,
    skippedAlreadySent: 0,
    logFailures: 0,
    mailFailures: 0,
    notAttempted: 0,
    stoppedByBreaker: false,
  };

  if (options.mode === "preview") {
    result.notAttempted = candidates.length;
    return result;
  }

  for (let index = 0; index < candidates.length; index += 1) {
    if (breaker.isOpen) {
      result.stoppedByBreaker = true;
      result.notAttempted = candidates.length - index;
      break;
    }
    const candidate = candidates[index];
    const recipient = recipientFor(options.mode, candidate.email, options.sampleInbox);
    if (!recipient) {
      result.notAttempted += 1;
      continue;
    }
    const email = renderEmail(candidate);

    let outcome: "inserted" | "duplicate";
    try {
      outcome = await options.log.insertFirst({
        kind: candidate.kind,
        subjectKey: candidate.subjectKey,
        period: candidate.period,
        mode: options.mode,
        recipient,
        intendedRecipient: candidate.email,
        subject: email.subject,
        runId: options.runId,
      });
      breaker.recordSuccess();
    } catch {
      // No log row, so no send. Never the other way round.
      result.logFailures += 1;
      breaker.recordFailure();
      continue;
    }

    if (outcome === "duplicate") {
      result.skippedAlreadySent += 1;
      continue;
    }

    try {
      await options.mailer.send({ to: recipient, intendedFor: candidate.email, subject: email.subject, html: email.html });
      result.sent += 1;
      await options.log.markDelivery(candidate, "logged").catch(() => undefined);
    } catch {
      result.mailFailures += 1;
      await options.log.markDelivery(candidate, "failed").catch(() => undefined);
    }
  }

  if (breaker.isOpen) result.stoppedByBreaker = true;
  return result;
}

/** In-memory log with the same uniqueness rule, for tests. */
export class MemoryReminderLog implements ReminderLogStore {
  readonly rows = new Map<string, ReminderLogRow & { delivery: "claimed" | "logged" | "failed" }>();
  failNextInserts = 0;

  async insertFirst(row: ReminderLogRow): Promise<"inserted" | "duplicate"> {
    if (this.failNextInserts > 0) {
      this.failNextInserts -= 1;
      throw new Error("log write failed");
    }
    const key = `${row.kind}|${row.subjectKey}|${row.period}`;
    if (this.rows.has(key)) return "duplicate";
    this.rows.set(key, { ...row, delivery: "claimed" });
    return "inserted";
  }

  async markDelivery(row: Pick<ReminderLogRow, "kind" | "subjectKey" | "period">, delivery: "logged" | "failed"): Promise<void> {
    const existing = this.rows.get(`${row.kind}|${row.subjectKey}|${row.period}`);
    if (existing) existing.delivery = delivery;
  }
}
