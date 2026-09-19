import { describe, expect, it } from "vitest";
import { MemoryPmLedger, SimulatedPmApi, makeReference } from "../pm-api/simulated";
import { isPmApiError, PmApiError, type PmApi } from "../pm-api/types";
import { checkBatchLimits, messageForSqlError, normalizeReportIds } from "./limits";
import { MemoryBatchStore } from "./memory-store";
import { outageFault, runChunk, runUntilSettled } from "./runner";
import { availableActions, canTransition, deriveBatchState, isTerminal, progressFraction, totalsFromStatuses } from "./state";

const noSleep = async () => undefined;
const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i);

function makeApi(ledger = new MemoryPmLedger(), fault?: () => boolean) {
  return new SimulatedPmApi({ ledger, fault, sleep: noSleep, random: () => 0.5 });
}

describe("SimulatedPmApi", () => {
  it("accepts an approval and returns a reference", async () => {
    const api = makeApi();
    const r = await api.approveReport({ reportId: 12, idempotencyKey: "12", approverEmail: "a@example.com" });
    expect(r.reference).toMatch(/^PM-000012-[0-9a-f]{6}$/);
  });

  it("rejects a second approval with the same idempotency key as a duplicate", async () => {
    const api = makeApi();
    const first = await api.approveReport({ reportId: 12, idempotencyKey: "12", approverEmail: "a@example.com" });
    const again = api.approveReport({ reportId: 12, idempotencyKey: "12", approverEmail: "a@example.com" });
    await expect(again).rejects.toMatchObject({ kind: "duplicate", reference: first.reference });
  });

  it("duplicate detection survives a new API instance over the same ledger", async () => {
    const ledger = new MemoryPmLedger();
    await makeApi(ledger).approveReport({ reportId: 5, idempotencyKey: "5", approverEmail: "a@example.com" });
    await expect(
      makeApi(ledger).approveReport({ reportId: 5, idempotencyKey: "5", approverEmail: "a@example.com" }),
    ).rejects.toMatchObject({ kind: "duplicate" });
    expect(ledger.size).toBe(1);
  });

  it("fails on demand as unavailable and records nothing", async () => {
    const ledger = new MemoryPmLedger();
    const api = makeApi(ledger, () => true);
    await expect(api.approveReport({ reportId: 1, idempotencyKey: "1", approverEmail: "a@example.com" })).rejects.toMatchObject({
      kind: "unavailable",
      retryable: true,
    });
    expect(ledger.size).toBe(0);
    expect(api.accepted).toBe(0);
  });

  it("rejects a missing key or a bad report id without calling out", async () => {
    const api = makeApi();
    await expect(api.approveReport({ reportId: 1, idempotencyKey: "", approverEmail: "a@example.com" })).rejects.toMatchObject({ kind: "rejected" });
    await expect(api.approveReport({ reportId: -4, idempotencyKey: "x", approverEmail: "a@example.com" })).rejects.toMatchObject({ kind: "rejected" });
    expect(api.calls).toBe(0);
  });

  it("sleeps between 150 and 400 ms", async () => {
    const waits: number[] = [];
    let n = 0;
    const api = new SimulatedPmApi({
      ledger: new MemoryPmLedger(),
      sleep: async (ms) => void waits.push(ms),
      random: () => [0, 0.999, 0.5][n++ % 3],
    });
    for (const id of [1, 2, 3]) await api.approveReport({ reportId: id, idempotencyKey: String(id), approverEmail: "a@example.com" });
    for (const w of waits) {
      expect(w).toBeGreaterThanOrEqual(150);
      expect(w).toBeLessThanOrEqual(400);
    }
  });

  it("PmApiError is recognisable and only 'unavailable' is retryable", () => {
    expect(isPmApiError(new PmApiError("rejected", "no"))).toBe(true);
    expect(isPmApiError(new Error("no"))).toBe(false);
    expect(new PmApiError("rejected", "no").retryable).toBe(false);
    expect(new PmApiError("duplicate", "no").retryable).toBe(false);
  });

  it("makeReference is deterministic for a given random source", () => {
    expect(makeReference(7, () => 0)).toBe("PM-000007-000000");
  });
});

describe("batch state machine", () => {
  it("allows only the documented item transitions", () => {
    expect(canTransition("pending", "succeeded")).toBe(true);
    expect(canTransition("pending", "failed")).toBe(true);
    expect(canTransition("failed", "pending")).toBe(true);
    expect(canTransition("succeeded", "pending")).toBe(false);
    expect(canTransition("succeeded", "failed")).toBe(false);
    expect(canTransition("failed", "succeeded")).toBe(false);
  });

  it("succeeded is the only terminal status", () => {
    expect(isTerminal("succeeded")).toBe(true);
    expect(isTerminal("failed")).toBe(false);
    expect(isTerminal("pending")).toBe(false);
  });

  it.each([
    [{ total: 0, pending: 0, succeeded: 0, failed: 0, activeClaims: 0 }, "empty"],
    [{ total: 5, pending: 5, succeeded: 0, failed: 0, activeClaims: 0 }, "interrupted"],
    [{ total: 5, pending: 3, succeeded: 2, failed: 0, activeClaims: 2 }, "running"],
    [{ total: 5, pending: 2, succeeded: 2, failed: 1, activeClaims: 0 }, "interrupted"],
    [{ total: 5, pending: 0, succeeded: 5, failed: 0, activeClaims: 0 }, "completed"],
    [{ total: 5, pending: 0, succeeded: 3, failed: 2, activeClaims: 0 }, "completed_with_failures"],
  ])("derives %o as %s", (totals, state) => {
    expect(deriveBatchState(totals)).toBe(state);
  });

  it("counts a claim as active only while it is fresh", () => {
    const totals = totalsFromStatuses(
      [
        { status: "pending", claimedAtMs: 1_000 },
        { status: "pending", claimedAtMs: 100_000 },
        { status: "pending", claimedAtMs: null },
        { status: "succeeded", claimedAtMs: 100_000 },
      ],
      130_000,
      120_000,
    );
    expect(totals).toEqual({ total: 4, pending: 3, succeeded: 1, failed: 0, activeClaims: 1 });
  });

  it("offers resume only when interrupted and retry only when something failed", () => {
    const interrupted = { total: 4, pending: 2, succeeded: 1, failed: 1, activeClaims: 0 };
    expect(availableActions("interrupted", interrupted)).toEqual({ canResume: true, canRetryFailed: true });
    const running = { ...interrupted, activeClaims: 1 };
    expect(availableActions("running", running)).toEqual({ canResume: false, canRetryFailed: false });
    const done = { total: 4, pending: 0, succeeded: 4, failed: 0, activeClaims: 0 };
    expect(availableActions("completed", done)).toEqual({ canResume: false, canRetryFailed: false });
  });

  it("progress counts finished items, succeeded or failed", () => {
    expect(progressFraction({ total: 10, pending: 4, succeeded: 5, failed: 1, activeClaims: 0 })).toBeCloseTo(0.6);
    expect(progressFraction({ total: 0, pending: 0, succeeded: 0, failed: 0, activeClaims: 0 })).toBe(0);
  });
});

describe("claiming (memory store, same rules as the SQL)", () => {
  it("claims at most the limit, in order, and stamps the claim", async () => {
    const store = new MemoryBatchStore(() => 1000);
    store.createBatch("b", ids(10));
    const claimed = await store.claim("b", 4, "r1");
    expect(claimed.map((c) => c.reportId)).toEqual([1, 2, 3, 4]);
    expect(store.items.slice(0, 4).every((i) => i.claimedBy === "r1" && i.claimedAtMs === 1000 && i.attempts === 1)).toBe(true);
  });

  it("two runners never receive the same item", async () => {
    const store = new MemoryBatchStore(() => 1000);
    store.createBatch("b", ids(10));
    const [a, b] = await Promise.all([store.claim("b", 6, "r1"), store.claim("b", 6, "r2")]);
    const all = [...a, ...b].map((c) => c.itemId);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(10);
  });

  it("does not hand out a fresh claim again", async () => {
    let now = 0;
    const store = new MemoryBatchStore(() => now);
    store.createBatch("b", ids(3));
    await store.claim("b", 3, "r1");
    now = 119_000;
    expect(await store.claim("b", 3, "r2")).toEqual([]);
  });

  it("re-claims a stale claim after two minutes and counts the attempt", async () => {
    let now = 0;
    const store = new MemoryBatchStore(() => now);
    store.createBatch("b", ids(3));
    await store.claim("b", 3, "r1");
    now = 120_000;
    const again = await store.claim("b", 3, "r2");
    expect(again).toHaveLength(3);
    expect(again[0].attempts).toBe(2);
  });

  it("refuses an outcome from a runner that lost its claim", async () => {
    let now = 0;
    const store = new MemoryBatchStore(() => now);
    store.createBatch("b", [1]);
    const [item] = await store.claim("b", 1, "slow");
    now = 121_000;
    await store.claim("b", 1, "fast");
    expect(await store.complete(item.itemId, "slow", { ok: true, reference: "x" })).toBe(false);
    expect(await store.complete(item.itemId, "fast", { ok: true, reference: "y" })).toBe(true);
    expect(store.approvalLog).toEqual([{ reportId: 1, reference: "y" }]);
  });

  it("never claims succeeded or failed items, and only claims within the batch", async () => {
    const store = new MemoryBatchStore(() => 0);
    store.createBatch("b", ids(3));
    store.createBatch("other", ids(3, 100));
    const claimed = await store.claim("b", 3, "r1");
    await store.complete(claimed[0].itemId, "r1", { ok: true, reference: "x" });
    await store.complete(claimed[1].itemId, "r1", { ok: false, error: "boom" });
    await store.release([claimed[2].itemId], "r1");
    const next = await store.claim("b", 10, "r2");
    expect(next.map((c) => c.reportId)).toEqual([3]);
  });

  it("release only gives back the caller's own pending claims", async () => {
    const store = new MemoryBatchStore(() => 0);
    store.createBatch("b", ids(2));
    const claimed = await store.claim("b", 2, "r1");
    expect(await store.release(claimed.map((c) => c.itemId), "someone-else")).toBe(0);
    expect(await store.release(claimed.map((c) => c.itemId), "r1")).toBe(2);
    expect(store.items.every((i) => i.claimedBy === null && i.attempts === 0)).toBe(true);
  });
});

describe("runChunk / resume", () => {
  it("processes a whole batch and logs each approval once", async () => {
    const store = new MemoryBatchStore(() => 0);
    store.createBatch("b", ids(12));
    const api = makeApi();
    const r = await runUntilSettled({ store, api, batchId: "b", runnerId: "r1", approverEmail: "a@example.com" });
    expect(r.succeeded).toBe(12);
    expect(r.failed).toBe(0);
    expect(store.approvalLog).toHaveLength(12);
    expect(deriveBatchState(store.totals("b"))).toBe("completed");
    expect(api.calls).toBe(12);
  });

  it("reports idle when there is nothing to claim", async () => {
    const store = new MemoryBatchStore(() => 0);
    store.createBatch("b", []);
    const r = await runChunk({ store, api: makeApi(), batchId: "b", runnerId: "r1", approverEmail: "a@example.com" });
    expect(r).toMatchObject({ idle: true, claimed: 0 });
  });

  it("halts after three consecutive outages, releases the rest, and leaves the batch interrupted", async () => {
    const store = new MemoryBatchStore(() => 0);
    store.createBatch("b", ids(20), 7);
    const meta = await store.getMeta("b");
    const ledger = new MemoryPmLedger();
    const api: SimulatedPmApi = new SimulatedPmApi({
      ledger,
      sleep: noSleep,
      fault: () => outageFault(meta!, () => api.accepted)(),
    });
    const r = await runUntilSettled({ store, api, batchId: "b", runnerId: "r1", approverEmail: "a@example.com" });
    expect(r.halted).toBe(true);
    expect(r.succeeded).toBe(7);
    expect(r.failed).toBe(3);
    const totals = store.totals("b");
    expect(totals).toMatchObject({ succeeded: 7, failed: 3, pending: 10, activeClaims: 0 });
    expect(deriveBatchState(totals)).toBe("interrupted");
  });

  it("resume sends only what has not succeeded: no succeeded item is ever re-sent", async () => {
    const store = new MemoryBatchStore(() => 0);
    store.createBatch("b", ids(20), 7);
    const ledger = new MemoryPmLedger();
    const sent: number[] = [];
    const build = async () => {
      const meta = await store.getMeta("b");
      const inner: SimulatedPmApi = new SimulatedPmApi({ ledger, sleep: noSleep, fault: () => outageFault(meta!, () => inner.accepted)() });
      const spy: PmApi = {
        approveReport: async (req) => {
          sent.push(req.reportId);
          return inner.approveReport(req);
        },
      };
      return spy;
    };

    await runUntilSettled({ store, api: await build(), batchId: "b", runnerId: "r1", approverEmail: "a@example.com" });
    const sentBeforeResume = [...sent];
    const succeededFirst = store.items.filter((i) => i.status === "succeeded").map((i) => i.reportId);

    store.clearOutage("b");
    store.retryFailed("b");
    sent.length = 0;
    const r2 = await runUntilSettled({ store, api: await build(), batchId: "b", runnerId: "r2", approverEmail: "a@example.com" });

    expect(r2.succeeded).toBe(13);
    expect(sent.filter((id) => succeededFirst.includes(id))).toEqual([]);
    expect(sentBeforeResume).toHaveLength(10);
    expect(store.approvalLog).toHaveLength(20);
    expect(ledger.size).toBe(20);
    expect(deriveBatchState(store.totals("b"))).toBe("completed");
  });

  it("a crash after the API accepted but before recording is healed by the duplicate answer", async () => {
    let now = 0;
    const store = new MemoryBatchStore(() => now);
    store.createBatch("b", [41]);
    const ledger = new MemoryPmLedger();
    // Runner 1 claims, the API accepts, then the runner dies before complete().
    const [item] = await store.claim("b", 1, "dead");
    const accepted = await makeApi(ledger).approveReport({ reportId: item.reportId, idempotencyKey: "41", approverEmail: "a@example.com" });
    now = 130_000;
    const r = await runUntilSettled({ store, api: makeApi(ledger), batchId: "b", runnerId: "r2", approverEmail: "a@example.com" });
    expect(r.succeeded).toBe(1);
    expect(store.items[0].reference).toBe(accepted.reference);
    expect(ledger.size).toBe(1);
    expect(store.approvalLog).toHaveLength(1);
  });

  it("two concurrent runners finish a batch with no item processed twice", async () => {
    const store = new MemoryBatchStore(() => 0);
    store.createBatch("b", ids(37));
    const ledger = new MemoryPmLedger();
    const calls: number[] = [];
    const api = (): PmApi => {
      const inner = new SimulatedPmApi({ ledger, sleep: () => new Promise((r) => setTimeout(r, 1)) });
      return {
        approveReport: async (req) => {
          calls.push(req.reportId);
          return inner.approveReport(req);
        },
      };
    };
    const [a, b] = await Promise.all([
      runUntilSettled({ store, api: api(), batchId: "b", runnerId: "r1", approverEmail: "a@example.com" }),
      runUntilSettled({ store, api: api(), batchId: "b", runnerId: "r2", approverEmail: "a@example.com" }),
    ]);
    expect(a.succeeded + b.succeeded).toBe(37);
    expect(new Set(calls).size).toBe(37);
    expect(calls).toHaveLength(37);
    expect(a.succeeded).toBeGreaterThan(0);
    expect(b.succeeded).toBeGreaterThan(0);
  });

  it("a rejected item fails without halting the run", async () => {
    const store = new MemoryBatchStore(() => 0);
    store.createBatch("b", ids(6));
    const inner = makeApi();
    const api: PmApi = {
      approveReport: async (req) => {
        if (req.reportId === 3) throw new PmApiError("rejected", "Report is locked (HTTP 422)");
        return inner.approveReport(req);
      },
    };
    const r = await runUntilSettled({ store, api, batchId: "b", runnerId: "r1", approverEmail: "a@example.com" });
    expect(r).toMatchObject({ succeeded: 5, failed: 1, halted: false });
    expect(store.items[2]).toMatchObject({ status: "failed", lastError: "Report is locked (HTTP 422)" });
    expect(deriveBatchState(store.totals("b"))).toBe("completed_with_failures");
  });

  it("non-consecutive outages do not halt", async () => {
    const store = new MemoryBatchStore(() => 0);
    store.createBatch("b", ids(10));
    let n = 0;
    const api = makeApi(new MemoryPmLedger(), () => n++ % 2 === 0);
    const r = await runUntilSettled({ store, api, batchId: "b", runnerId: "r1", approverEmail: "a@example.com" });
    expect(r.halted).toBe(false);
    expect(r.succeeded).toBe(5);
    expect(r.failed).toBe(5);
  });

  it("an unexpected error type is recorded as a failure with its message", async () => {
    const store = new MemoryBatchStore(() => 0);
    store.createBatch("b", [1]);
    const api: PmApi = { approveReport: async () => Promise.reject(new TypeError("socket hang up")) };
    const r = await runChunk({ store, api, batchId: "b", runnerId: "r1", approverEmail: "a@example.com" });
    expect(r.failed).toBe(1);
    expect(store.items[0].lastError).toBe("socket hang up");
  });

  it("outageFault is inert when no outage is configured or it was cleared", () => {
    expect(outageFault({ outageAfter: null, outageCleared: false, succeeded: 99 }, () => 0)()).toBe(false);
    expect(outageFault({ outageAfter: 3, outageCleared: true, succeeded: 99 }, () => 0)()).toBe(false);
    expect(outageFault({ outageAfter: 3, outageCleared: false, succeeded: 2 }, () => 0)()).toBe(false);
    expect(outageFault({ outageAfter: 3, outageCleared: false, succeeded: 2 }, () => 1)()).toBe(true);
  });
});

describe("batch limits", () => {
  const now = 1_000_000_000;

  it("accepts a normal batch", () => {
    expect(checkBatchLimits({ itemCount: 40, recentBatchTimesMs: [], nowMs: now })).toEqual({ ok: true });
  });

  it("rejects an empty batch", () => {
    expect(checkBatchLimits({ itemCount: 0, recentBatchTimesMs: [], nowMs: now })).toMatchObject({ ok: false, code: "empty_batch" });
  });

  it("accepts exactly 200 items and rejects 201", () => {
    expect(checkBatchLimits({ itemCount: 200, recentBatchTimesMs: [], nowMs: now }).ok).toBe(true);
    expect(checkBatchLimits({ itemCount: 201, recentBatchTimesMs: [], nowMs: now })).toMatchObject({ ok: false, code: "batch_too_large" });
  });

  it("rejects the 11th batch inside ten minutes and says when to retry", () => {
    const recent = Array.from({ length: 10 }, (_, i) => now - (i + 1) * 30_000);
    const d = checkBatchLimits({ itemCount: 5, recentBatchTimesMs: recent, nowMs: now });
    expect(d).toMatchObject({ ok: false, code: "rate_limited" });
    if (!d.ok) expect(d.retryAfterSeconds).toBe(300);
  });

  it("ignores batches older than the window", () => {
    const old = Array.from({ length: 30 }, (_, i) => now - 601_000 - i * 1000);
    expect(checkBatchLimits({ itemCount: 5, recentBatchTimesMs: old, nowMs: now }).ok).toBe(true);
  });

  it("allows the 10th batch", () => {
    const recent = Array.from({ length: 9 }, (_, i) => now - (i + 1) * 1000);
    expect(checkBatchLimits({ itemCount: 5, recentBatchTimesMs: recent, nowMs: now }).ok).toBe(true);
  });

  it("normalises ids: integers only, positive, unique, sorted", () => {
    expect(normalizeReportIds([5, "3", 3, -1, 0, 2.5, "abc", null, 5])).toEqual([3, 5]);
  });

  it("maps SQL exceptions to friendly messages", () => {
    expect(messageForSqlError("rate_limited")).toMatch(/Too many batches/);
    expect(messageForSqlError("nothing_to_approve")).toMatch(/still need approval/);
    expect(messageForSqlError("something else")).toBe("The batch could not be created.");
  });
});
