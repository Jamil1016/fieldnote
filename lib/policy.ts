/**
 * Every policy number in the app, in one place. All of them are INVENTED for
 * this demo; none is taken from a real organisation.
 */
export const POLICY = {
  /** A filed report must be approved within this many hours. */
  approvalSlaHours: 48,
  /** "Due soon" when fewer than this many hours remain before the SLA lapses. */
  approvalDueSoonHours: 12,
  /** |claimed - tracked| / tracked at or above this is a breach. */
  varianceBreach: 0.15,
  /** Shown as "watch" on the heatmap: over this but under the breach line. */
  varianceWatch: 0.08,
  /** A daily report is due by this UTC hour on the next working day. */
  reportCutoffHourUtc: 10,
  /** The analysis page refuses to say "live" past this age of the last load. */
  freshnessMaxAgeHours: 26,
  /** Bulk approve limits, enforced in the app and again in SQL. */
  batchMaxItems: 200,
  batchMaxPerWindow: 10,
  batchWindowMinutes: 10,
  /** A claim older than this is considered abandoned and can be re-claimed. */
  claimStaleMs: 2 * 60 * 1000,
  /** Items claimed per runner call. */
  batchChunkSize: 5,
  /** Consecutive "unavailable" errors before a runner halts and releases. */
  batchHaltAfterFailures: 3,
  /** Heatmap window, in working days (6 weeks). */
  analysisWindowDays: 30,
} as const;

/** The demo company keeps every clock in UTC so day boundaries are unambiguous. */
export const COMPANY = {
  name: "Example Co Field Services",
  product: "Fieldnote",
  timezone: "UTC",
} as const;
