import pg from "pg";
import { startGateway } from "../../scripts/local/gateway.mjs";

const DATABASE_URL = process.env.LOCAL_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54329/postgres";

/** Reset the demo to a known state and start the /rest/v1 gateway for the run. */
export default async function setup() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query("select fn_demo.reset_demo()");
  await client.query("notify pgrst, 'reload schema'");
  await client.end();

  let server: { close: () => void } | null = null;
  try {
    server = (await startGateway(54331)) as { close: () => void };
  } catch {
    // Already running (for example alongside `next dev`): reuse it.
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return () => server?.close();
}
