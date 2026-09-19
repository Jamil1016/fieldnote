/**
 * Approval SLA (invented rule): a report must be approved within 48 hours of
 * being filed. "Due soon" is the last 12 hours before that deadline.
 */
import { POLICY } from "../policy";

export type SlaBucket = "on_time" | "due_soon" | "overdue";

export interface SlaStatus {
  bucket: SlaBucket;
  dueAt: Date;
  /** Hours until the deadline; negative once overdue. */
  hoursRemaining: number;
}

export interface SlaRule {
  slaHours: number;
  dueSoonHours: number;
}

const DEFAULT_RULE: SlaRule = {
  slaHours: POLICY.approvalSlaHours,
  dueSoonHours: POLICY.approvalDueSoonHours,
};

export function approvalDueAt(filedAt: Date, rule: SlaRule = DEFAULT_RULE): Date {
  return new Date(filedAt.getTime() + rule.slaHours * 3_600_000);
}

export function slaStatus(filedAt: Date | string, now: Date, rule: SlaRule = DEFAULT_RULE): SlaStatus {
  const filed = typeof filedAt === "string" ? new Date(filedAt) : filedAt;
  if (!Number.isFinite(filed.getTime())) throw new Error("slaStatus: invalid filedAt");
  const dueAt = approvalDueAt(filed, rule);
  const hoursRemaining = (dueAt.getTime() - now.getTime()) / 3_600_000;
  // The deadline itself is still inside the SLA; one millisecond later is not.
  const bucket: SlaBucket =
    hoursRemaining < 0 ? "overdue" : hoursRemaining <= rule.dueSoonHours ? "due_soon" : "on_time";
  return { bucket, dueAt, hoursRemaining };
}

/** Was an approval made inside the SLA? */
export function approvedWithinSla(filedAt: Date, approvedAt: Date, rule: SlaRule = DEFAULT_RULE): boolean {
  return approvedAt.getTime() <= approvalDueAt(filedAt, rule).getTime();
}

export function countBuckets(statuses: readonly SlaStatus[]): Record<SlaBucket, number> {
  const out: Record<SlaBucket, number> = { on_time: 0, due_soon: 0, overdue: 0 };
  for (const s of statuses) out[s.bucket] += 1;
  return out;
}

/** "5h left", "1d 3h left", "overdue 2d 4h". */
export function describeRemaining(hoursRemaining: number): string {
  const abs = Math.abs(hoursRemaining);
  const days = Math.floor(abs / 24);
  const hours = Math.floor(abs - days * 24);
  const span = days > 0 ? `${days}d ${hours}h` : abs < 1 ? `${Math.max(1, Math.round(abs * 60))}m` : `${hours}h`;
  return hoursRemaining < 0 ? `overdue ${span}` : `${span} left`;
}

/**
 * Filing timeliness (invented rule): a report for working day D is on time if
 * filed by the cutoff hour (UTC) on the next working day.
 */
export function filingDeadline(nextWorkingDay: string, cutoffHourUtc: number = POLICY.reportCutoffHourUtc): Date {
  return new Date(Date.parse(`${nextWorkingDay}T00:00:00Z`) + cutoffHourUtc * 3_600_000);
}

export function filedOnTime(filedAt: Date | string, nextWorkingDay: string, cutoffHourUtc?: number): boolean {
  const filed = typeof filedAt === "string" ? new Date(filedAt) : filedAt;
  return filed.getTime() <= filingDeadline(nextWorkingDay, cutoffHourUtc).getTime();
}
