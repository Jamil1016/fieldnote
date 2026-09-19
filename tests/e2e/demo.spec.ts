import { expect, test } from "@playwright/test";
import pg from "pg";

const DATABASE_URL = process.env.LOCAL_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54329/postgres";
const SHOTS = process.env.E2E_SHOTS_DIR ?? null;

async function shot(page: import("@playwright/test").Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.beforeAll(async () => {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query("select fn_demo.reset_demo()");
  await client.end();
});

test("bulk approve survives a simulated outage and resumes without re-sending", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/approvals");
  await expect(page.getByRole("heading", { name: "Reports awaiting approval" })).toBeVisible();
  await shot(page, "approvals");

  await page.getByRole("button", { name: /^Overdue/ }).click();
  await page.getByLabel("Team", { exact: true }).selectOption({ label: "Ridgeway Survey" });
  await page.getByLabel(/Select all/).check();
  await page.getByLabel("Demo: simulate an API outage after").check();
  await page.getByLabel("Items before the simulated outage").fill("12");
  await page.getByRole("button", { name: /Approve \d+ selected/ }).click();

  const panel = page.getByRole("region", { name: "Batch progress" });
  await expect(panel.getByText("Interrupted")).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByText(/Halted: PM API unavailable/)).toBeVisible();
  await expect(panel.locator("dd").first()).toHaveText("12");
  await shot(page, "batch-interrupted");

  await panel.getByRole("button", { name: "Resume" }).click();
  await expect(panel.getByRole("button", { name: "Retry failed" })).toBeVisible({ timeout: 120_000 });
  await panel.getByRole("button", { name: "Retry failed" }).click();
  await expect(panel.getByText("Completed", { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(panel.getByText(/each exactly once/)).toBeVisible();
  await shot(page, "batch-completed");

  // The database agrees: one approval-log row and one PM ledger row per item, none twice.
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  const { rows } = await client.query(
    `select (select count(*)::int from fn_app.approval_batch_item where status = 'succeeded') items,
            (select count(*)::int from fn_app.approval_log) logged,
            (select count(*)::int from fn_app.pm_sim_ledger) ledger`,
  );
  await client.end();
  expect(rows[0].logged).toBe(rows[0].items);
  expect(rows[0].ledger).toBe(rows[0].items);
});

test("row detail drawer shows task lines and timer entries", async ({ page }) => {
  await page.goto("/approvals");
  await page.getByRole("button", { name: "Details" }).first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Daily report")).toBeVisible();
  await expect(drawer.getByRole("columnheader", { name: "Task" }).first()).toBeVisible();
  await expect(drawer.getByText("Timer entries")).toBeVisible();
  await shot(page, "drawer");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("scorecard sorts", async ({ page }) => {
  await page.goto("/approvals/scorecard");
  await expect(page.getByRole("heading", { name: "Approver scorecard" })).toBeVisible();
  await page.getByRole("button", { name: "Backlog now" }).click();
  // Descending by backlog: read the numbers rather than assume which team is worst,
  // because the batch test above has just cleared one team's overdue reports.
  const backlog = async () =>
    (await page.locator("tbody tr td:nth-child(5) .num:first-child").allInnerTexts()).map(Number);
  const desc = await backlog();
  expect(desc).toEqual([...desc].sort((a, b) => b - a));
  await page.getByRole("button", { name: "Backlog now" }).click();
  const asc = await backlog();
  expect(asc).toEqual([...asc].sort((a, b) => a - b));
  await shot(page, "scorecard");
});

test("heatmap drills into a member-day and exports CSV", async ({ page }) => {
  await page.goto("/analysis");
  await expect(page.getByText(/Live, timer data loaded/)).toBeVisible();
  await expect(page.getByText("Metro Closeout").first()).toBeVisible();
  await shot(page, "analysis");
  await page.getByRole("button", { name: /breach$/ }).first().click();
  await expect(page.getByRole("dialog").getByText(/Breach \(15% line\)/)).toBeVisible();
  await shot(page, "analysis-drill");
  await page.keyboard.press("Escape");

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/^fieldnote-hours-variance-\d{4}-\d{2}-\d{2}\.csv$/);
});

test("stale pipeline data is called out instead of 'live'", async ({ page }) => {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query("update fn_demo.pipeline_runs set status = 'failed' where finished_at > now() - interval '27 hours'");
  try {
    await page.goto("/analysis");
    await expect(page.getByText("Stale data.")).toBeVisible();
    await expect(page.getByText(/Live, timer data loaded/)).toHaveCount(0);
    await shot(page, "analysis-stale");
  } finally {
    await client.query("update fn_demo.pipeline_runs set status = 'succeeded' where id not in (23, 35)");
    await client.end();
  }
});

test("reminders: the second run sends nothing", async ({ page }) => {
  await page.goto("/reminders");
  await expect(page.getByText("active")).toBeVisible();
  await page.getByRole("button", { name: "Send reminders" }).click();
  await expect(page.getByText(/logged for reminders-sandbox@example.com/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Send reminders" }).click();
  await expect(page.getByText("Zero new sends: every reminder was already logged")).toBeVisible({ timeout: 60_000 });
  await shot(page, "reminders");
});

test("directory and member page", async ({ page }) => {
  await page.goto("/directory");
  await page.getByLabel("Search name, position, email or lead").fill("metro");
  await shot(page, "directory");
  await page.goto("/directory/12");
  await expect(page.getByText("Filing timeliness")).toBeVisible();
  await shot(page, "member");
});

test("View as re-renders navigation and access, and blocks mutations", async ({ page }) => {
  await page.goto("/approvals");
  await page.getByRole("button", { name: "Viewer", exact: true }).click();
  await expect(page).toHaveURL(/\/directory$/);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(["Directory"]);
  await page.goto("/approvals");
  await expect(page).toHaveURL(/\/no-access\?need=lead/);
  await shot(page, "no-access");

  await page.getByRole("button", { name: "Lead", exact: true }).click();
  await expect(page).toHaveURL(/\/approvals$/);
  await expect(page.getByText(/Read-only while you preview another role/)).toBeVisible();
  await expect(page.getByText("Your teams only")).toBeVisible();
  await page.goto("/reminders");
  await expect(page).toHaveURL(/\/no-access\?need=manager/);

  await page.getByRole("button", { name: "Manager", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(5);
  await page.goto("/policy");
  await expect(page).toHaveURL(/\/no-access\?need=hr_staff/);
});
