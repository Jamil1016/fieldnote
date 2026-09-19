/**
 * Fieldnote never uses Supabase Realtime (progress is polled from Postgres).
 * supabase-js still constructs a Realtime client eagerly and, on Node versions
 * without a global WebSocket (Node 20), throws before any query is made.
 * Handing it this inert transport keeps the app and CI independent of the Node
 * version. It is only ever instantiated if something calls .channel(), which
 * nothing here does.
 */
export class NoRealtimeTransport {
  constructor() {
    throw new Error("Supabase Realtime is not used in this app.");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const NO_REALTIME = { transport: NoRealtimeTransport as any };
