/**
 * SimulatedPmApi: stands in for the external project-management system.
 *   - adds 150-400 ms of latency per call
 *   - fails on demand (the `fault` hook) with an "unavailable" error
 *   - remembers every idempotency key it accepted, in a ledger, and rejects a
 *     second approval with the same key as a duplicate. That makes the
 *     "succeeded items are never re-sent" guarantee observable: if the batch
 *     runner ever re-sent one, this would say so.
 *
 * The ledger is an interface so the app can keep it in Postgres (the state
 * must survive across serverless invocations) and tests can keep it in memory.
 */
import { PmApiError, type ApproveReportRequest, type ApproveReportResult, type PmApi } from "./types";

export interface PmLedger {
  /**
   * Record a key. Resolves "inserted" the first time, or "duplicate" with the
   * reference stored by the first call. Must be atomic.
   */
  record(key: string, reference: string): Promise<{ outcome: "inserted" } | { outcome: "duplicate"; reference: string }>;
}

export class MemoryPmLedger implements PmLedger {
  private readonly seen = new Map<string, string>();

  async record(key: string, reference: string) {
    const existing = this.seen.get(key);
    if (existing !== undefined) return { outcome: "duplicate" as const, reference: existing };
    this.seen.set(key, reference);
    return { outcome: "inserted" as const };
  }

  get size(): number {
    return this.seen.size;
  }

  has(key: string): boolean {
    return this.seen.has(key);
  }
}

export interface SimulatedPmApiOptions {
  ledger: PmLedger;
  /** Return true to make THIS call fail as "unavailable". */
  fault?: (request: ApproveReportRequest) => boolean | Promise<boolean>;
  /** [min, max] latency in ms. Default [150, 400]. */
  latencyMs?: readonly [number, number];
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function makeReference(reportId: number, random: () => number): string {
  const suffix = Math.floor(random() * 0xffffff)
    .toString(16)
    .padStart(6, "0");
  return `PM-${String(reportId).padStart(6, "0")}-${suffix}`;
}

export class SimulatedPmApi implements PmApi {
  private readonly ledger: PmLedger;
  private readonly fault: NonNullable<SimulatedPmApiOptions["fault"]>;
  private readonly latency: readonly [number, number];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  /** Calls that reached the simulated remote system, for tests and the UI. */
  calls = 0;
  /** Approvals accepted (first time) during this instance's life. */
  accepted = 0;

  constructor(options: SimulatedPmApiOptions) {
    this.ledger = options.ledger;
    this.fault = options.fault ?? (() => false);
    this.latency = options.latencyMs ?? [150, 400];
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  async approveReport(request: ApproveReportRequest): Promise<ApproveReportResult> {
    if (!request.idempotencyKey) {
      throw new PmApiError("rejected", "Missing idempotency key");
    }
    if (!Number.isInteger(request.reportId) || request.reportId <= 0) {
      throw new PmApiError("rejected", `Unknown report ${request.reportId}`);
    }
    this.calls += 1;
    const [min, max] = this.latency;
    await this.sleep(Math.round(min + this.random() * Math.max(0, max - min)));

    if (await this.fault(request)) {
      throw new PmApiError("unavailable", "PM API unavailable (simulated outage, HTTP 503)");
    }

    const reference = makeReference(request.reportId, this.random);
    const recorded = await this.ledger.record(request.idempotencyKey, reference);
    if (recorded.outcome === "duplicate") {
      throw new PmApiError(
        "duplicate",
        `Approval already recorded for key ${request.idempotencyKey} (HTTP 409)`,
        recorded.reference,
      );
    }
    this.accepted += 1;
    return { reference };
  }
}
