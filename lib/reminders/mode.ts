/**
 * Send mode. FAIL-CLOSED: anything that is not exactly "sample" or "live"
 * (missing setting, typo, wrong type, different case) resolves to "preview",
 * the mode that does nothing.
 *
 *   preview  render only; no log rows, nothing handed to the mailer
 *   sample   everything is addressed to ONE test inbox
 *   live     addressed to the real recipient
 *
 * In this app no mode delivers anything: the only Mailer is LoggedMailer.
 */
export type SendMode = "preview" | "sample" | "live";

export function resolveSendMode(value: unknown): SendMode {
  if (value === "sample" || value === "live") return value;
  return "preview";
}

/** The public demo never runs "live", whatever the settings table says. */
export function pinForDemo(mode: SendMode, demoMode: boolean): SendMode {
  if (demoMode && mode === "live") return "sample";
  return mode;
}

export function recipientFor(mode: SendMode, intended: string, sampleInbox: string): string | null {
  if (mode === "live") return intended;
  if (mode === "sample") return sampleInbox;
  return null;
}

export const MODE_DESCRIPTION: Record<SendMode, string> = {
  preview: "Render only. Nothing is logged or handed to the mailer.",
  sample: "Every message is addressed to one test inbox instead of the real recipient.",
  live: "Messages are addressed to the real recipient.",
};
