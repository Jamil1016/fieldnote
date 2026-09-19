// Local verification only: prove that two database sessions claiming from the
// same batch at the same time never receive the same item.
//
//   npm run db:race
//
// Session A claims inside an OPEN transaction (so its row locks are still
// held), then session B claims. With FOR UPDATE SKIP LOCKED, B does not wait
// for A and does not see A's rows: it gets the next ones. Then both sessions
// drain the rest of the batch in parallel.
import pg from "pg";

const connectionString = process.env.LOCAL_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54329/postgres";
const a = new pg.Client({ connectionString });
const b = new pg.Client({ connectionString });
await Promise.all([a.connect(), b.connect()]);

const claim = async (client, batchId, limit, runner) =>
  (await client.query("select item_id from fn_app.claim_batch_items($1, $2, $3)", [batchId, limit, runner])).rows.map((r) => Number(r.item_id));

try {
  await a.query("select fn_demo.reset_demo()");
  const ids = (await a.query("select report_id from fn_analytics.v_approval_queue order by report_id limit 40")).rows.map((r) => r.report_id);
  const batchId = (await a.query("select fn_app.create_approval_batch('demo@example.com', $1::int[]) as id", [ids])).rows[0].id;
  console.log(`batch ${batchId} with ${ids.length} items`);

  await a.query("begin");
  const startedA = Date.now();
  const claimedA = await claim(a, batchId, 15, "session-A");
  console.log(`session A (transaction still open) claimed ${claimedA.length}: ${claimedA[0]}..${claimedA.at(-1)}`);

  const startedB = Date.now();
  const claimedB = await claim(b, batchId, 15, "session-B");
  console.log(`session B claimed ${claimedB.length} in ${Date.now() - startedB} ms without waiting: ${claimedB[0]}..${claimedB.at(-1)}`);
  await a.query("commit");
  console.log(`session A committed after ${Date.now() - startedA} ms`);

  const overlapFirst = claimedA.filter((id) => claimedB.includes(id));
  console.log(`overlap between A and B: ${overlapFirst.length}`);

  // Drain the rest from both sessions at once.
  const drain = async (client, runner) => {
    const mine = [];
    for (;;) {
      const got = await claim(client, batchId, 3, runner);
      if (got.length === 0) return mine;
      mine.push(...got);
    }
  };
  const [restA, restB] = await Promise.all([drain(a, "session-A"), drain(b, "session-B")]);
  const allA = [...claimedA, ...restA];
  const allB = [...claimedB, ...restB];
  const overlap = allA.filter((id) => allB.includes(id));
  const total = new Set([...allA, ...allB]).size;
  console.log(`parallel drain: A +${restA.length}, B +${restB.length}`);
  console.log(`totals: A=${allA.length} B=${allB.length} distinct=${total} overlap=${overlap.length}`);

  const byRunner = (await a.query("select claimed_by, count(*)::int n from fn_app.approval_batch_item where batch_id = $1 group by 1 order by 1", [batchId])).rows;
  console.log("claimed_by in the table:", JSON.stringify(byRunner));

  // Stale claims: nothing is claimable now, but a claim older than 2 minutes is.
  const none = await claim(b, batchId, 50, "session-C");
  await a.query("update fn_app.approval_batch_item set claimed_at = now() - interval '3 minutes' where batch_id = $1 and claimed_by = 'session-A'", [batchId]);
  const stale = await claim(b, batchId, 50, "session-C");
  console.log(`fresh claims re-claimable: ${none.length}; after ageing A's claims past 2 minutes, session C re-claimed ${stale.length} (= A's ${allA.length})`);

  const ok = overlapFirst.length === 0 && overlap.length === 0 && total === ids.length && none.length === 0 && stale.length === allA.length;
  console.log(ok ? "PASS: disjoint claims, nothing lost, stale claims reclaimable" : "FAIL");
  await a.query("select fn_demo.reset_demo()");
  process.exitCode = ok ? 0 : 1;
} finally {
  await Promise.all([a.end(), b.end()]);
}
