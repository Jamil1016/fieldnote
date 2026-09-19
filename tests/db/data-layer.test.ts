/**
 * Every query the app makes, against the real SQL. Needs the local stack:
 *   docker compose -f docker-compose.local.yml up -d && npm run db:apply
 * The order matters in places (the rate-limit test runs last on purpose).
 */
import { describe, expect, it } from "vitest";
import { msToDay, WorkCalendar } from "@/lib/analysis/calendar";
import { assessFreshness, lastSuccessfulRun } from "@/lib/analysis/freshness";
import { buildAnalysis } from "@/lib/analysis/heatmap";
import { buildMemberTimeline } from "@/lib/analysis/member-timeline";
import { buildStatus } from "@/lib/batch/api-types";
import { outageFault, runUntilSettled } from "@/lib/batch/runner";
import { getVarianceSource, listHolidays, listRecentPipelineRuns } from "@/lib/data/analysis";
import {
  clearBatchOutage,
  createBatch,
  getBatchSummary,
  getMemberDayDetail,
  getScorecard,
  listApproverTeamIds,
  listBatchItems,
  listQueue,
  listRecentBatches,
  recentBatchTimes,
  restoreDemoIfDepleted,
  retryFailedItems,
  SupabaseBatchStore,
  SupabasePmLedger,
} from "@/lib/data/approvals";
import { getDirectoryMember, listDirectory, listMemberReports } from "@/lib/data/directory";
import {
  getSettings,
  listApproversWithOverdue,
  listLoggedKeys,
  listMembersMissingReport,
  listReminderLog,
  SupabaseReminderLog,
} from "@/lib/data/reminders";
import { getAppUser, listAudit, writeAudit } from "@/lib/data/users";
import { SimulatedPmApi } from "@/lib/pm-api/simulated";
import type { PmApi } from "@/lib/pm-api/types";
import { dedupeCandidates, latestDuePeriod, selectMissingReportCandidates, selectOverdueCandidates } from "@/lib/reminders/candidates";
import { LoggedMailer, runReminders } from "@/lib/reminders/send";
import { clientFor, noSleep, sql } from "./helpers";

const db = clientFor("service_role");
const actor = { email: "demo@example.com", memberId: 6 };
const now = new Date();

function apiFor(meta: { outageAfter: number | null; outageCleared: boolean; succeeded: number }, sent?: number[]): PmApi {
  const inner: SimulatedPmApi = new SimulatedPmApi({
    ledger: new SupabasePmLedger(db),
    sleep: noSleep,
    fault: outageFault(meta, () => inner.accepted),
  });
  return {
    approveReport: async (req) => {
      sent?.push(req.reportId);
      return inner.approveReport(req);
    },
  };
}

describe("lockdown", () => {
  it.each(["anon", "authenticated"] as const)("%s cannot read a view, a table or call an RPC", async (role) => {
    const c = clientFor(role);
    const view = await c.schema("fn_analytics").from("v_approval_queue").select("report_id").limit(1);
    const table = await c.schema("fn_app").from("settings").select("key").limit(1);
    const rpc = await c.schema("fn_analytics").rpc("approver_scorecard", { p_days: 30 });
    const write = await c.schema("fn_app").from("audit_log").insert({ actor_email: "x@example.com", action: "x", entity: "x", entity_id: "x" });
    for (const r of [view, table, rpc, write]) {
      expect(r.error?.message ?? "").toMatch(/permission denied/i);
      expect(r.data).toBeNull();
    }
  });

  it("fn_demo is not exposed over the API at all, even to the service role", async () => {
    const r = await db.schema("fn_demo").from("members").select("id").limit(1);
    expect(r.error).not.toBeNull();
  });
});

describe("users and audit", () => {
  it("finds the demo user as a manager linked to a member", async () => {
    expect(await getAppUser(db, "DEMO@example.com")).toMatchObject({ email: "demo@example.com", role: "manager", member_id: 6 });
    expect(await getAppUser(db, "nobody@example.com")).toBeNull();
  });

  it("writes and lists audit rows, and the log is append-only", async () => {
    await writeAudit(db, { actorEmail: actor.email, action: "test.ping", entity: "test", entityId: "1", detail: { a: 1 } });
    const rows = await listAudit(db, 5);
    expect(rows[0]).toMatchObject({ action: "test.ping", detail: { a: 1 } });
    const upd = await db.schema("fn_app").from("audit_log").update({ action: "tampered" }).eq("id", rows[0].id);
    expect(upd.error?.message).toMatch(/append-only/);
    const del = await db.schema("fn_app").from("audit_log").delete().eq("id", rows[0].id);
    expect(del.error?.message).toMatch(/append-only/);
  });
});

describe("approval queue", () => {
  it("lists awaiting reports for all teams and for a lead's teams", async () => {
    const all = await listQueue(db, null);
    expect(all.length).toBeGreaterThan(100);
    expect(all.length).toBeLessThanOrEqual(1000);
    const teamIds = await listApproverTeamIds(db, 6);
    expect(teamIds).toEqual([1]);
    const scoped = await listQueue(db, teamIds);
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((r) => r.team_id === 1)).toBe(true);
    expect(await listQueue(db, [])).toEqual([]);
    expect(await listApproverTeamIds(db, null)).toEqual([]);
  });

  it("returns a member-day with task lines and timer entries", async () => {
    const [row] = await listQueue(db, null);
    const detail = await getMemberDayDetail(db, row.member_id, row.report_date);
    expect(detail.report?.report_id).toBe(row.report_id);
    expect(detail.task_lines.length).toBeGreaterThanOrEqual(2);
    expect(detail.task_lines.reduce((n, l) => n + l.hours, 0)).toBeCloseTo(row.hours_claimed, 2);
    const unknown = await getMemberDayDetail(db, 99999, row.report_date);
    expect(unknown.member).toBeNull();
  });

  it("computes the scorecard in SQL", async () => {
    const rows = await getScorecard(db, 30);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.approved_count > 0 && r.pct_within_sla !== null)).toBe(true);
    const slow = rows.find((r) => r.teams === "Ridgeway Survey");
    expect(slow?.pct_within_sla).toBeLessThan(50);
  });
});

describe("analysis sources", () => {
  it("feeds the pure analysis and shows the seeded story", async () => {
    const calendar = new WorkCalendar(await listHolidays(db));
    const days = calendar.lastWorkingDays(msToDay(now.getTime()), 30);
    const source = await getVarianceSource(db, days[0], days[days.length - 1]);
    expect(source.timers.length).toBeGreaterThan(5000);
    const members = (await listDirectory(db))
      .filter((d) => d.files_reports)
      .map((d) => ({ memberId: d.member_id, name: d.full_name, teamId: d.team_id, teamName: d.team_name }));
    expect(members).toHaveLength(42);
    const result = buildAnalysis({ members, reports: source.reports, timers: source.timers, days });
    expect(result.groups).toHaveLength(5);
    expect(result.summary.worstTeam?.teamName).toBe("Metro Closeout");
    expect(result.summary.worstTeam?.breachRate).toBeGreaterThan(0.4);
    const others = result.summary.teams.filter((t) => t.teamName !== "Metro Closeout");
    expect(others.every((t) => (t.breachRate ?? 1) < 0.15)).toBe(true);
    expect(result.summary.missingReports).toBeGreaterThan(0);
    console.log("variance by team:", result.summary.teams.map((t) => `${t.teamName} ${((t.breachRate ?? 0) * 100).toFixed(1)}%`).join(", "));
  });

  it("filters the source to one member", async () => {
    const calendar = new WorkCalendar(await listHolidays(db));
    const days = calendar.lastWorkingDays(msToDay(now.getTime()), 30);
    const source = await getVarianceSource(db, days[0], days[days.length - 1], 12);
    expect(new Set(source.reports.map((r) => r[0]))).toEqual(new Set([12]));
    const reports = await listMemberReports(db, 12, days[0], days[days.length - 1]);
    const timeline = buildMemberTimeline({
      days,
      calendar,
      reports,
      timers: source.timers.map(([, s, e]) => ({ start: s * 1000, end: e * 1000 })),
    });
    // Member 12 is one of the two habitually late filers.
    expect(timeline.filter((d) => d.filing === "late").length).toBeGreaterThan(8);
  });

  it("reports a fresh pipeline", async () => {
    const runs = await listRecentPipelineRuns(db, 12);
    expect(runs).toHaveLength(12);
    expect(assessFreshness(lastSuccessfulRun(runs), now).state).toBe("live");
  });
});

describe("directory", () => {
  it("lists everyone and fetches one member", async () => {
    const rows = await listDirectory(db);
    expect(rows).toHaveLength(48);
    expect(rows.filter((r) => r.is_approver)).toHaveLength(6);
    expect(rows.every((r) => r.email.endsWith("@example.com"))).toBe(true);
    expect(await getDirectoryMember(db, 7)).toMatchObject({ member_id: 7, team_name: "Northline Install" });
    expect(await getDirectoryMember(db, 99999)).toBeNull();
  });
});

describe("reminders", () => {
  it("selects candidates and logs each exactly once across two runs", async () => {
    const calendar = new WorkCalendar(await listHolidays(db));
    const period = latestDuePeriod(now, calendar);
    const missing = await listMembersMissingReport(db, period);
    const overdue = await listApproversWithOverdue(db, now.toISOString());
    expect(missing.length).toBeGreaterThan(0);
    expect(overdue.length).toBeGreaterThan(0);
    const candidates = dedupeCandidates([...selectMissingReportCandidates(missing, period), ...selectOverdueCandidates(overdue, now)]);

    const settings = await getSettings(db);
    expect(settings).toMatchObject({ reminder_mode: "sample", sample_inbox: "reminders-sandbox@example.com" });

    const log = new SupabaseReminderLog(db);
    const mailer = new LoggedMailer();
    const first = await runReminders({ candidates, mode: "sample", sampleInbox: settings.sample_inbox, runId: crypto.randomUUID(), log, mailer });
    const second = await runReminders({ candidates, mode: "sample", sampleInbox: settings.sample_inbox, runId: crypto.randomUUID(), log, mailer });
    console.log("reminders:", JSON.stringify({ candidates: candidates.length, first: first.sent, second: second.sent, secondSkipped: second.skippedAlreadySent }));
    expect(first.sent).toBe(candidates.length);
    expect(second).toMatchObject({ sent: 0, skippedAlreadySent: candidates.length });
    expect(mailer.outbox).toHaveLength(candidates.length);
    expect(mailer.outbox.every((m) => m.to === "reminders-sandbox@example.com")).toBe(true);

    const rows = await listReminderLog(db, 100);
    expect(rows).toHaveLength(candidates.length);
    expect(rows.every((r) => r.delivery === "logged")).toBe(true);
    expect((await listLoggedKeys(db, [period])).size).toBe(missing.length);
    expect((await listLoggedKeys(db, [])).size).toBe(0);
  });

  it("two overlapping runs still log each reminder once (the UNIQUE constraint decides)", async () => {
    await sql("truncate fn_app.reminder_log");
    const calendar = new WorkCalendar(await listHolidays(db));
    const period = latestDuePeriod(now, calendar);
    const candidates = selectMissingReportCandidates(await listMembersMissingReport(db, period), period);
    const mailer = new LoggedMailer();
    const run = () =>
      runReminders({ candidates, mode: "sample", sampleInbox: "reminders-sandbox@example.com", runId: crypto.randomUUID(), log: new SupabaseReminderLog(db), mailer });
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.sent + b.sent).toBe(candidates.length);
    expect(mailer.outbox).toHaveLength(candidates.length);
  });
});

describe("durable batches", () => {
  let batchId = "";
  let reportIds: number[] = [];

  it("creates a batch, halts on the simulated outage, and leaves it interrupted", async () => {
    reportIds = (await listQueue(db, null)).slice(0, 20).map((r) => r.report_id);
    batchId = await createBatch(db, { actorEmail: actor.email, reportIds, teamIds: null, outageAfter: 7 });

    const store = new SupabaseBatchStore(db, actor);
    const meta = await store.getMeta(batchId);
    expect(meta).toMatchObject({ outageAfter: 7, outageCleared: false, succeeded: 0 });
    const r = await runUntilSettled({ store, api: apiFor(meta!), batchId, runnerId: "t-1", approverEmail: actor.email });
    expect(r).toMatchObject({ halted: true, succeeded: 7, failed: 3 });

    const status = buildStatus((await getBatchSummary(db, batchId))!, await listBatchItems(db, batchId));
    expect(status.totals).toEqual({ total: 20, pending: 10, succeeded: 7, failed: 3, activeClaims: 0 });
    expect(status.state).toBe("interrupted");
    expect(status.actions).toEqual({ canResume: true, canRetryFailed: true });
    expect(status.items.filter((i) => i.status === "failed")[0].last_error).toMatch(/unavailable/);
  });

  it("marks queued reports as in a batch and refuses to batch them twice", async () => {
    const queue = await listQueue(db, null);
    const pendingIds = (await listBatchItems(db, batchId)).filter((i) => i.status === "pending").map((i) => i.report_id);
    expect(queue.filter((q) => pendingIds.includes(q.report_id)).every((q) => q.in_open_batch)).toBe(true);
    await expect(createBatch(db, { actorEmail: actor.email, reportIds: pendingIds, teamIds: null, outageAfter: null })).rejects.toThrow(/nothing_to_approve/);
  });

  it("resumes: only unfinished items are sent, succeeded ones never again", async () => {
    const succeededBefore = (await listBatchItems(db, batchId)).filter((i) => i.status === "succeeded").map((i) => i.report_id);
    expect(await clearBatchOutage(db, batchId, actor.email)).toBe(true);
    expect(await clearBatchOutage(db, batchId, actor.email)).toBe(false);
    expect(await retryFailedItems(db, batchId, actor.email)).toBe(3);

    const store = new SupabaseBatchStore(db, actor);
    const sent: number[] = [];
    const r = await runUntilSettled({ store, api: apiFor((await store.getMeta(batchId))!, sent), batchId, runnerId: "t-2", approverEmail: actor.email });
    expect(r).toMatchObject({ halted: false, succeeded: 13, failed: 0 });
    expect(sent.filter((id) => succeededBefore.includes(id))).toEqual([]);

    const status = buildStatus((await getBatchSummary(db, batchId))!, await listBatchItems(db, batchId));
    expect(status.state).toBe("completed");
    const [{ n: logged }] = await sql<{ n: number }>("select count(*)::int n from fn_app.approval_log where batch_id = $1", [batchId]);
    const [{ n: ledger }] = await sql<{ n: number }>("select count(*)::int n from fn_app.pm_sim_ledger where idempotency_key = any($1)", [reportIds.map(String)]);
    const [{ n: audited }] = await sql<{ n: number }>("select count(*)::int n from fn_app.audit_log where action = 'report.approved'");
    expect([logged, ledger, audited]).toEqual([20, 20, 20]);
    const stillQueued = (await listQueue(db, null)).filter((q) => reportIds.includes(q.report_id));
    expect(stillQueued).toEqual([]);
  });

  it("the simulated PM API rejects a re-send of an approved report", async () => {
    const api = new SimulatedPmApi({ ledger: new SupabasePmLedger(db), sleep: noSleep });
    await expect(api.approveReport({ reportId: reportIds[0], idempotencyKey: String(reportIds[0]), approverEmail: actor.email })).rejects.toMatchObject({
      kind: "duplicate",
    });
  });

  it("two concurrent runners finish one batch without sharing an item", async () => {
    const ids = (await listQueue(db, null)).slice(0, 40).map((r) => r.report_id);
    const id = await createBatch(db, { actorEmail: actor.email, reportIds: ids, teamIds: null, outageAfter: null });
    const sentA: number[] = [];
    const sentB: number[] = [];
    const meta = { outageAfter: null, outageCleared: false, succeeded: 0 };
    const run = (runnerId: string, sent: number[]) =>
      runUntilSettled({ store: new SupabaseBatchStore(db, actor), api: apiFor(meta, sent), batchId: id, runnerId, approverEmail: actor.email });
    const [a, b] = await Promise.all([run("race-a", sentA), run("race-b", sentB)]);
    console.log("concurrent runners:", JSON.stringify({ a: a.succeeded, b: b.succeeded, overlap: sentA.filter((x) => sentB.includes(x)).length }));
    expect(a.succeeded + b.succeeded).toBe(40);
    expect(sentA.filter((x) => sentB.includes(x))).toEqual([]);
    expect(new Set([...sentA, ...sentB]).size).toBe(40);
    const claimedBy = await sql<{ claimed_by: string; n: number }>("select claimed_by, count(*)::int n from fn_app.approval_batch_item where batch_id = $1 group by 1", [id]);
    expect(claimedBy.reduce((n, r) => n + r.n, 0)).toBe(40);
  });

  it("a lead's team scope is enforced inside the SQL function", async () => {
    const other = (await listQueue(db, [2])).slice(0, 3).map((r) => r.report_id);
    await expect(createBatch(db, { actorEmail: actor.email, reportIds: other, teamIds: [1], outageAfter: null })).rejects.toThrow(/nothing_to_approve/);
  });

  it("refuses more than 200 items", async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => i + 1);
    await expect(createBatch(db, { actorEmail: actor.email, reportIds: tooMany, teamIds: null, outageAfter: null })).rejects.toThrow(/batch_too_large/);
  });

  it("does not restore the demo while the queue is healthy", async () => {
    expect(await restoreDemoIfDepleted(db, actor.email)).toBe(false);
  });

  it("rate-limits batch creation at 10 per 10 minutes", async () => {
    const queue = await listQueue(db, null);
    const already = (await recentBatchTimes(db, new Date(Date.now() - 600_000).toISOString())).length;
    let created = already;
    let refused: unknown = null;
    for (let i = 0; i < 12 && refused === null; i += 1) {
      try {
        await createBatch(db, { actorEmail: actor.email, reportIds: [queue[i].report_id], teamIds: null, outageAfter: null });
        created += 1;
      } catch (error) {
        refused = error;
      }
    }
    expect(created).toBe(10);
    expect(String(refused)).toMatch(/rate_limited/);
    expect((await listRecentBatches(db, 20)).length).toBe(10);
  });
});
