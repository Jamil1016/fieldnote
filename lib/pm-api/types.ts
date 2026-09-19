/**
 * THE SEAM to the external project-management system.
 *
 * Approving a report in Fieldnote writes the approval back to the system where
 * the work is planned. This interface is the only thing the rest of the app
 * knows about that system. In the demo the single implementation is
 * `SimulatedPmApi`; a real one would be a small HTTP client.
 *
 * CONTRACT for implementers
 *   approveReport(request)
 *     - Sends ONE approval. Must be safe to call more than once for the same
 *       `idempotencyKey`: the remote system either accepts the first call and
 *       rejects later ones as duplicates, or accepts all of them with no
 *       further effect. Fieldnote uses the report id as the key.
 *     - Resolves with the remote reference when the approval was accepted.
 *     - Rejects with `PmApiError`:
 *         kind "duplicate"    the key was already accepted earlier. Carries the
 *                             original `reference` when known. The batch runner
 *                             treats this as SUCCESS (the approval exists).
 *         kind "unavailable"  network failure, timeout, 5xx, rate limit.
 *                             Retryable. Several in a row halt the runner.
 *         kind "rejected"     the remote system refused the request (4xx).
 *                             Not retryable without a change.
 *     - Must not throw anything other than `PmApiError` for expected failures.
 *
 * A real HTTP implementation would map: 2xx -> resolve, 409 -> duplicate,
 * 408/429/5xx/network -> unavailable, other 4xx -> rejected, and would send
 * the key in an `Idempotency-Key` header.
 */
export interface ApproveReportRequest {
  reportId: number;
  /** Stable per report. Fieldnote passes String(reportId). */
  idempotencyKey: string;
  approverEmail: string;
}

export interface ApproveReportResult {
  /** The remote system's identifier for the accepted approval. */
  reference: string;
}

export interface PmApi {
  approveReport(request: ApproveReportRequest): Promise<ApproveReportResult>;
}

export type PmApiErrorKind = "duplicate" | "unavailable" | "rejected";

export class PmApiError extends Error {
  readonly kind: PmApiErrorKind;
  readonly reference: string | null;

  constructor(kind: PmApiErrorKind, message: string, reference: string | null = null) {
    super(message);
    this.name = "PmApiError";
    this.kind = kind;
    this.reference = reference;
  }

  get retryable(): boolean {
    return this.kind === "unavailable";
  }
}

export function isPmApiError(error: unknown): error is PmApiError {
  return error instanceof PmApiError;
}
