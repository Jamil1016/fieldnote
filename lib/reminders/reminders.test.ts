import { describe, expect, it } from "vitest";
import { WorkCalendar } from "../analysis/calendar";
import {
  dedupeCandidates,
  dedupeKey,
  latestDuePeriod,
  selectMissingReportCandidates,
  selectOverdueCandidates,
  type Candidate,
} from "./candidates";
import { pinForDemo, recipientFor, resolveSendMode } from "./mode";
import { CircuitBreaker, LoggedMailer, MemoryReminderLog, runReminders, type Mailer } from "./send";
import { escapeHtml, mergeFieldsIn, renderEmail, renderString } from "./template";

// 2025-03-03 is a Monday; 2025-03-05 (Wed) is a holiday.
const cal = new WorkCalendar(["2025-03-05"]);

describe("latestDuePeriod", () => {
  it("before the cutoff, yesterday is not due yet", () => {
    expect(latestDuePeriod(new Date("2025-03-11T09:59:00Z"), cal)).toBe("2025-03-07");
  });

  it("at the cutoff, yesterday becomes due", () => {
    expect(latestDuePeriod(new Date("2025-03-11T10:00:00Z"), cal)).toBe("2025-03-10");
  });

  it("on a Saturday the latest due day is Thursday", () => {
    expect(latestDuePeriod(new Date("2025-03-15T15:00:00Z"), cal)).toBe("2025-03-13");
  });

  it("on Monday morning Friday is still not due", () => {
    expect(latestDuePeriod(new Date("2025-03-17T08:00:00Z"), cal)).toBe("2025-03-13");
  });

  it("on Monday afternoon Friday is due", () => {
    expect(latestDuePeriod(new Date("2025-03-17T13:00:00Z"), cal)).toBe("2025-03-14");
  });

  it("a holiday pushes the deadline to the following working day", () => {
    // Tuesday 4th is due on Thursday 6th (Wednesday is a holiday).
    expect(latestDuePeriod(new Date("2025-03-05T15:00:00Z"), cal)).toBe("2025-03-03");
    expect(latestDuePeriod(new Date("2025-03-06T10:30:00Z"), cal)).toBe("2025-03-04");
  });

  it("honours a custom cutoff hour", () => {
    expect(latestDuePeriod(new Date("2025-03-11T07:00:00Z"), cal, 6)).toBe("2025-03-10");
  });
});

const missingFacts = [
  { member_id: 12, full_name: "Ada Example", email: "ada.example@example.com", team_name: "Alpha", lead_name: "Lee Lead" },
  { member_id: 13, full_name: "Bo Example", email: "not-an-email", team_name: "Alpha", lead_name: null },
];

describe("candidate selection", () => {
  it("builds one missing-report candidate per member with a usable email", () => {
    const c = selectMissingReportCandidates(missingFacts, "2025-03-10");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: "missing_report", subjectKey: "member:12", period: "2025-03-10" });
    expect(c[0].fields).toMatchObject({ first_name: "Ada", report_date: "2025-03-10", lead: "Lee Lead" });
  });

  it("falls back to a generic lead name", () => {
    const c = selectMissingReportCandidates([{ ...missingFacts[1], email: "bo@example.com" }], "2025-03-10");
    expect(c[0].fields.lead).toBe("your lead");
  });

  it("returns nothing when nobody is missing", () => {
    expect(selectMissingReportCandidates([], "2025-03-10")).toEqual([]);
  });

  it("nudges approvers with overdue reports, one period per calendar day", () => {
    const now = new Date("2025-03-11T12:00:00Z");
    const c = selectOverdueCandidates(
      [
        { approver_member_id: 3, full_name: "Vi Lead", email: "vi@example.com", overdue_count: 4, oldest_filed_at: "2025-03-02T18:00:00Z" },
        { approver_member_id: 4, full_name: "Al Lead", email: "al@example.com", overdue_count: 0, oldest_filed_at: null },
      ],
      now,
    );
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: "approval_overdue", subjectKey: "member:3", period: "2025-03-11" });
    expect(c[0].fields).toMatchObject({ overdue_count: "4", report_word: "reports", oldest_filed: "2025-03-02" });
  });

  it("uses the singular for one report", () => {
    const c = selectOverdueCandidates(
      [{ approver_member_id: 3, full_name: "Vi Lead", email: "vi@example.com", overdue_count: 1, oldest_filed_at: null }],
      new Date("2025-03-11T12:00:00Z"),
    );
    expect(c[0].fields.report_word).toBe("report");
    expect(c[0].fields.oldest_filed).toBe("unknown");
  });
});

const cand = (id: number, period = "2025-03-10", kind: Candidate["kind"] = "missing_report"): Candidate => ({
  kind,
  subjectKey: `member:${id}`,
  period,
  name: `Person ${id}`,
  email: `person${id}@example.com`,
  fields: { name: `Person ${id}`, first_name: "Person", report_date: period, team: "Alpha", lead: "Lee Lead",
    overdue_count: "2", report_word: "reports", oldest_filed: "2025-03-01", sla_hours: "48" },
});

describe("dedupe key", () => {
  it("is kind, subject and period", () => {
    expect(dedupeKey(cand(7))).toBe("missing_report|member:7|2025-03-10");
  });

  it("differs by period, by kind and by subject", () => {
    const keys = new Set([dedupeKey(cand(7)), dedupeKey(cand(7, "2025-03-11")), dedupeKey(cand(7, "2025-03-10", "approval_overdue")), dedupeKey(cand(8))]);
    expect(keys.size).toBe(4);
  });

  it("dedupeCandidates keeps the first of each key", () => {
    const out = dedupeCandidates([cand(1), cand(2), { ...cand(1), name: "Second copy" }]);
    expect(out.map((c) => c.name)).toEqual(["Person 1", "Person 2"]);
  });
});

describe("send mode", () => {
  it.each([
    ["sample", "sample"],
    ["live", "live"],
    ["preview", "preview"],
    ["LIVE", "preview"],
    [" live", "preview"],
    ["", "preview"],
    [undefined, "preview"],
    [null, "preview"],
    [true, "preview"],
    [{ mode: "live" }, "preview"],
  ])("resolves %o to %s (fail-closed)", (value, expected) => {
    expect(resolveSendMode(value)).toBe(expected);
  });

  it("the demo can never be live", () => {
    expect(pinForDemo("live", true)).toBe("sample");
    expect(pinForDemo("sample", true)).toBe("sample");
    expect(pinForDemo("preview", true)).toBe("preview");
    expect(pinForDemo("live", false)).toBe("live");
  });

  it("routes recipients by mode", () => {
    expect(recipientFor("live", "a@example.com", "box@example.com")).toBe("a@example.com");
    expect(recipientFor("sample", "a@example.com", "box@example.com")).toBe("box@example.com");
    expect(recipientFor("preview", "a@example.com", "box@example.com")).toBeNull();
  });
});

describe("templates", () => {
  it("renders subject and body from merge fields", () => {
    const email = renderEmail(cand(1));
    expect(email.subject).toBe("Daily report missing for 2025-03-10");
    expect(email.html).toContain("Hi Person,");
    expect(email.html).toContain("<strong>2025-03-10</strong>");
  });

  it("renders the approver template", () => {
    const email = renderEmail(cand(1, "2025-03-11", "approval_overdue"));
    expect(email.subject).toBe("2 reports waiting past the 48 h approval window");
  });

  it("escapes HTML in field values", () => {
    const c = cand(1);
    c.fields.first_name = "<script>alert(1)</script>";
    expect(renderEmail(c).html).not.toContain("<script>");
    expect(escapeHtml(`"a" & 'b'`)).toBe("&quot;a&quot; &amp; &#39;b&#39;");
  });

  it("keeps line breaks out of the subject", () => {
    const c = cand(1);
    c.fields.report_date = "2025-03-10\r\nBcc: someone@example.com";
    expect(renderEmail(c).subject).not.toMatch(/[\r\n]/);
  });

  it("throws on a field with no value instead of sending a blank", () => {
    expect(() => renderString("Hi {{nobody}}", {}, true)).toThrow(/nobody/);
  });

  it("lists the merge fields a template uses", () => {
    expect(mergeFieldsIn("{{a}} and {{ b }} and {{a}}")).toEqual(["a", "b"]);
  });
});

describe("CircuitBreaker", () => {
  it("opens after the threshold of consecutive failures", () => {
    const b = new CircuitBreaker(3);
    b.recordFailure();
    b.recordFailure();
    expect(b.isOpen).toBe(false);
    b.recordFailure();
    expect(b.isOpen).toBe(true);
  });

  it("a success resets the count", () => {
    const b = new CircuitBreaker(3);
    b.recordFailure();
    b.recordFailure();
    b.recordSuccess();
    b.recordFailure();
    b.recordFailure();
    expect(b.isOpen).toBe(false);
    expect(b.failures).toBe(2);
  });

  it("stays open once tripped", () => {
    const b = new CircuitBreaker(1);
    b.recordFailure();
    b.recordSuccess();
    expect(b.isOpen).toBe(true);
  });

  it("rejects a nonsensical threshold", () => {
    expect(() => new CircuitBreaker(0)).toThrow();
  });
});

describe("runReminders (insert-first, exactly-once)", () => {
  const base = { sampleInbox: "box@example.com", runId: "run-1" };

  it("sends each candidate once and logs it", async () => {
    const log = new MemoryReminderLog();
    const mailer = new LoggedMailer();
    const r = await runReminders({ ...base, candidates: [cand(1), cand(2), cand(3)], mode: "sample", log, mailer });
    expect(r).toMatchObject({ considered: 3, sent: 3, skippedAlreadySent: 0 });
    expect(mailer.outbox).toHaveLength(3);
    expect([...log.rows.values()].every((row) => row.delivery === "logged")).toBe(true);
  });

  it("a second run sends nothing", async () => {
    const log = new MemoryReminderLog();
    const mailer = new LoggedMailer();
    const candidates = [cand(1), cand(2), cand(3)];
    await runReminders({ ...base, candidates, mode: "sample", log, mailer });
    const second = await runReminders({ ...base, runId: "run-2", candidates, mode: "sample", log, mailer });
    expect(second).toMatchObject({ sent: 0, skippedAlreadySent: 3 });
    expect(mailer.outbox).toHaveLength(3);
  });

  it("two overlapping runs send each reminder exactly once between them", async () => {
    const log = new MemoryReminderLog();
    const mailer = new LoggedMailer();
    const candidates = Array.from({ length: 15 }, (_, i) => cand(i + 1));
    const [a, b] = await Promise.all([
      runReminders({ ...base, runId: "a", candidates, mode: "sample", log, mailer }),
      runReminders({ ...base, runId: "b", candidates, mode: "sample", log, mailer }),
    ]);
    expect(a.sent + b.sent).toBe(15);
    expect(mailer.outbox).toHaveLength(15);
  });

  it("a new period is a new reminder", async () => {
    const log = new MemoryReminderLog();
    const mailer = new LoggedMailer();
    await runReminders({ ...base, candidates: [cand(1, "2025-03-10")], mode: "sample", log, mailer });
    const r = await runReminders({ ...base, candidates: [cand(1, "2025-03-11")], mode: "sample", log, mailer });
    expect(r.sent).toBe(1);
  });

  it("sample mode addresses everything to the test inbox and keeps the intended recipient", async () => {
    const mailer = new LoggedMailer();
    await runReminders({ ...base, candidates: [cand(1)], mode: "sample", log: new MemoryReminderLog(), mailer });
    expect(mailer.outbox[0]).toMatchObject({ to: "box@example.com", intendedFor: "person1@example.com" });
  });

  it("live mode addresses the real recipient", async () => {
    const mailer = new LoggedMailer();
    await runReminders({ ...base, candidates: [cand(1)], mode: "live", log: new MemoryReminderLog(), mailer });
    expect(mailer.outbox[0].to).toBe("person1@example.com");
  });

  it("preview mode writes no log rows and sends nothing", async () => {
    const log = new MemoryReminderLog();
    const mailer = new LoggedMailer();
    const r = await runReminders({ ...base, candidates: [cand(1), cand(2)], mode: "preview", log, mailer });
    expect(r).toMatchObject({ sent: 0, notAttempted: 2 });
    expect(log.rows.size).toBe(0);
    expect(mailer.outbox).toHaveLength(0);
  });

  it("never sends when the log write fails", async () => {
    const log = new MemoryReminderLog();
    log.failNextInserts = 1;
    const mailer = new LoggedMailer();
    const r = await runReminders({ ...base, candidates: [cand(1), cand(2)], mode: "sample", log, mailer });
    expect(r).toMatchObject({ logFailures: 1, sent: 1 });
    expect(mailer.outbox.map((m) => m.intendedFor)).toEqual(["person2@example.com"]);
  });

  it("the breaker stops the run when log writes keep failing", async () => {
    const log = new MemoryReminderLog();
    log.failNextInserts = 100;
    const mailer = new LoggedMailer();
    const candidates = Array.from({ length: 10 }, (_, i) => cand(i + 1));
    const r = await runReminders({ ...base, candidates, mode: "sample", log, mailer, breaker: new CircuitBreaker(3) });
    expect(r).toMatchObject({ stoppedByBreaker: true, logFailures: 3, notAttempted: 7, sent: 0 });
    expect(mailer.outbox).toHaveLength(0);
  });

  it("a mailer failure is counted and marked, and does not send twice on the next run", async () => {
    const log = new MemoryReminderLog();
    const failing: Mailer = { send: async () => Promise.reject(new Error("smtp down")) };
    const r = await runReminders({ ...base, candidates: [cand(1)], mode: "sample", log, mailer: failing });
    expect(r).toMatchObject({ sent: 0, mailFailures: 1 });
    expect([...log.rows.values()][0].delivery).toBe("failed");
    const mailer = new LoggedMailer();
    const again = await runReminders({ ...base, candidates: [cand(1)], mode: "sample", log, mailer });
    expect(again.skippedAlreadySent).toBe(1);
    expect(mailer.outbox).toHaveLength(0);
  });

  it("collapses duplicate candidates inside one run", async () => {
    const mailer = new LoggedMailer();
    const r = await runReminders({ ...base, candidates: [cand(1), cand(1)], mode: "sample", log: new MemoryReminderLog(), mailer });
    expect(r).toMatchObject({ considered: 1, sent: 1 });
  });
});
