// Local verification only: apply roles, then schema.sql, seed.sql and
// reset_demo.sql TWICE each (idempotency check) to the Postgres container
// from docker-compose.local.yml, then tell PostgREST to reload its cache.
//
//   docker compose -f docker-compose.local.yml up -d
//   npm run db:apply
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const connectionString = process.env.LOCAL_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54329/postgres";

const files = [
  ["scripts/local/00_roles.sql", 1],
  ["supabase/schema.sql", 2],
  ["supabase/seed.sql", 2],
  ["supabase/reset_demo.sql", 2],
];

const client = new pg.Client({ connectionString });
await client.connect();
try {
  for (const [file, times] of files) {
    const sql = fs.readFileSync(path.join(root, file), "utf8");
    for (let i = 1; i <= times; i += 1) {
      const started = Date.now();
      await client.query(sql);
      console.log(`applied ${file} (${i}/${times}) in ${Date.now() - started} ms`);
    }
  }
  await client.query("notify pgrst, 'reload schema'");
  console.log("ok");
} finally {
  await client.end();
}
