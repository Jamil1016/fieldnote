import { describe, expect, it } from "vitest";
import { csvStream, encodeField, encodeRow, streamToString } from "../csv/csv";
import { analysisCsvRows, ANALYSIS_CSV_HEADER } from "./export";
import { assessFreshness, lastSuccessfulRun } from "./freshness";
import { breachTrend, buildAnalysis, filterGroups, type AnalysisInput } from "./heatmap";

const sec = (iso: string) => Date.parse(iso) / 1000;

const members = [
  { memberId: 1, name: "Bea Test", teamId: 10, teamName: "Alpha" },
  { memberId: 2, name: "Abe Test", teamId: 10, teamName: "Alpha" },
  { memberId: 3, name: "Cy Test", teamId: 20, teamName: "Beta" },
];
const days = ["2025-03-03", "2025-03-04"];

const input: AnalysisInput = {
  members,
  days,
  reports: [
    [1, "2025-03-03", 8, 101],
    [1, "2025-03-04", 10, 102], // breach: tracked 8
    [2, "2025-03-03", 8, 103], // missing timer
    [3, "2025-03-03", 4, 104],
    [3, "2025-03-01", 9, 105], // outside the window
  ],
  timers: [
    [1, sec("2025-03-03T08:00:00Z"), sec("2025-03-03T16:00:00Z")],
    [1, sec("2025-03-04T08:00:00Z"), sec("2025-03-04T16:00:00Z")],
    [1, sec("2025-03-04T09:00:00Z"), sec("2025-03-04T10:00:00Z")], // overlap, must not add
    [3, sec("2025-03-03T08:00:00Z"), sec("2025-03-03T12:00:00Z")],
    [3, sec("2025-03-04T08:00:00Z"), sec("2025-03-04T12:00:00Z")], // missing report
  ],
};

describe("buildAnalysis", () => {
  const result = buildAnalysis(input);

  it("groups rows by team, teams and members sorted by name", () => {
    expect(result.groups.map((g) => g.teamName)).toEqual(["Alpha", "Beta"]);
    expect(result.groups[0].rows.map((r) => r.member.name)).toEqual(["Abe Test", "Bea Test"]);
  });

  it("creates one cell per member per day", () => {
    for (const g of result.groups) for (const r of g.rows) expect(r.cells.map((c) => c.day)).toEqual(days);
  });

  it("classifies an exact match as ok", () => {
    const bea = result.groups[0].rows[1];
    expect(bea.cells[0]).toMatchObject({ state: "ok", variance: 0, claimed: 8, tracked: 8, reportId: 101 });
  });

  it("merges overlapping timers before comparing", () => {
    const bea = result.groups[0].rows[1];
    expect(bea.cells[1].tracked).toBe(8);
    expect(bea.cells[1].variance).toBeCloseTo(0.25);
    expect(bea.cells[1].state).toBe("breach");
  });

  it("marks a report with no timer as missing_timer", () => {
    expect(result.groups[0].rows[0].cells[0].state).toBe("missing_timer");
  });

  it("marks a day with neither as none", () => {
    expect(result.groups[0].rows[0].cells[1].state).toBe("none");
  });

  it("marks timer without report as missing_report", () => {
    expect(result.groups[1].rows[0].cells[1].state).toBe("missing_report");
  });

  it("ignores reports outside the window", () => {
    const ids = result.groups.flatMap((g) => g.rows.flatMap((r) => r.cells.map((c) => c.reportId)));
    expect(ids).not.toContain(105);
  });

  it("counts breaches per row", () => {
    expect(result.groups[0].rows[1].breachCount).toBe(1);
    expect(result.groups[0].rows[1].comparableCount).toBe(2);
  });

  it("summarises breach rate over comparable cells only", () => {
    expect(result.summary.comparable).toBe(3);
    expect(result.summary.breaches).toBe(1);
    expect(result.summary.breachRate).toBeCloseTo(1 / 3);
  });

  it("counts missing reports and timers", () => {
    expect(result.summary.missingReports).toBe(1);
    expect(result.summary.missingTimers).toBe(1);
  });

  it("names the worst team by breach rate", () => {
    expect(result.summary.worstTeam?.teamName).toBe("Alpha");
  });

  it("gives each team box-plot stats", () => {
    const alpha = result.summary.teams.find((t) => t.teamName === "Alpha");
    expect(alpha?.box?.count).toBe(2);
    expect(alpha?.box?.max).toBeCloseTo(0.25);
  });

  it("treats a report row with NULL hours as zero claimed", () => {
    const r = buildAnalysis({ ...input, reports: [[3, "2025-03-04", null, 200]] });
    const cell = r.groups[1].rows[0].cells[1];
    expect(cell.state).toBe("breach");
    expect(cell.variance).toBe(-1);
  });

  it("handles an empty input without dividing by zero", () => {
    const r = buildAnalysis({ members: [], reports: [], timers: [], days });
    expect(r.groups).toEqual([]);
    expect(r.summary.breachRate).toBeNull();
    expect(r.summary.worstTeam).toBeNull();
  });

  it("filterGroups narrows to one team or keeps all", () => {
    expect(filterGroups(result.groups, 20).map((g) => g.teamName)).toEqual(["Beta"]);
    expect(filterGroups(result.groups, null)).toHaveLength(2);
    expect(filterGroups(result.groups, 999)).toEqual([]);
  });
});

describe("breachTrend", () => {
  it("reports the change in percentage points", () => {
    const t = breachTrend(0.2, 0.15);
    expect(t.deltaPoints).toBeCloseTo(5);
    expect(t.direction).toBe("up");
  });

  it("is down when the rate fell", () => {
    expect(breachTrend(0.1, 0.15).direction).toBe("down");
  });

  it("is flat within half a point", () => {
    expect(breachTrend(0.151, 0.15).direction).toBe("flat");
  });

  it("is unknown when either side is missing", () => {
    expect(breachTrend(null, 0.2).direction).toBe("unknown");
    expect(breachTrend(0.2, null).deltaPoints).toBeNull();
  });
});

describe("assessFreshness", () => {
  const now = new Date("2025-03-10T12:00:00Z");

  it("is live for a recent successful load", () => {
    expect(assessFreshness("2025-03-10T09:00:00Z", now).state).toBe("live");
  });

  it("is live at exactly 26 hours", () => {
    expect(assessFreshness("2025-03-09T10:00:00Z", now).state).toBe("live");
  });

  it("is stale just past 26 hours", () => {
    const f = assessFreshness("2025-03-09T09:59:00Z", now);
    expect(f.state).toBe("stale");
    expect(f.ageHours).toBeGreaterThan(26);
  });

  it("is unknown with no successful load", () => {
    expect(assessFreshness(null, now).state).toBe("unknown");
  });

  it("is unknown for an unparseable timestamp", () => {
    expect(assessFreshness("yesterday-ish", now).state).toBe("unknown");
  });

  it("does not trust a load from the future", () => {
    expect(assessFreshness("2025-03-11T12:00:00Z", now).state).toBe("unknown");
  });

  it("lastSuccessfulRun ignores failed and unfinished runs", () => {
    expect(
      lastSuccessfulRun([
        { status: "failed", finished_at: "2025-03-10T11:00:00Z" },
        { status: "succeeded", finished_at: "2025-03-10T05:00:00Z" },
        { status: "succeeded", finished_at: "2025-03-09T05:00:00Z" },
        { status: "running", finished_at: null },
      ]),
    ).toBe("2025-03-10T05:00:00Z");
  });

  it("lastSuccessfulRun is null when nothing succeeded", () => {
    expect(lastSuccessfulRun([{ status: "failed", finished_at: "2025-03-10T11:00:00Z" }])).toBeNull();
  });
});

describe("csv", () => {
  it("leaves plain values alone", () => {
    expect(encodeField("Site survey")).toBe("Site survey");
    expect(encodeField(7.5)).toBe("7.5");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(encodeField("a,b")).toBe('"a,b"');
    expect(encodeField('say "hi"')).toBe('"say ""hi"""');
    expect(encodeField("two\nlines")).toBe('"two\nlines"');
  });

  it("writes null and undefined as empty", () => {
    expect(encodeRow([null, undefined, "x"])).toBe(",,x\r\n");
  });

  it("neutralises formula-leading strings but not negative numbers", () => {
    expect(encodeField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(encodeField("@cmd")).toBe("'@cmd");
    expect(encodeField(-12.5)).toBe("-12.5");
  });

  it("writes non-finite numbers as empty", () => {
    expect(encodeField(Number.NaN)).toBe("");
  });

  it("streams every row in order across chunks", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => [i, `row ${i}`]);
    const text = await streamToString(csvStream(rows, { chunkRows: 10 }));
    const lines = text.trimEnd().split("\r\n");
    expect(lines).toHaveLength(25);
    expect(lines[0]).toBe("0,row 0");
    expect(lines[24]).toBe("24,row 24");
  });

  it("emits more than one chunk for a large input", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => [i]);
    const reader = csvStream(rows, { chunkRows: 10 }).getReader();
    let chunks = 0;
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
      chunks += 1;
    }
    expect(chunks).toBe(3);
  });

  it("pulls lazily from a generator", async () => {
    let produced = 0;
    function* gen() {
      for (let i = 0; i < 1000; i += 1) {
        produced += 1;
        yield [i];
      }
    }
    const reader = csvStream(gen(), { chunkRows: 10 }).getReader();
    await reader.read();
    expect(produced).toBeLessThan(100);
    await reader.cancel();
  });

  it("handles an empty input", async () => {
    expect(await streamToString(csvStream([]))).toBe("");
  });

  it("can prepend a BOM", async () => {
    const { value } = await csvStream([["a"]], { bom: true }).getReader().read();
    expect([...(value ?? [])].slice(0, 4)).toEqual([0xef, 0xbb, 0xbf, 0x61]);
  });

  it("exports the analysis view with a header and one row per cell", async () => {
    const result = buildAnalysis(input);
    const text = await streamToString(csvStream(analysisCsvRows(result.groups)));
    const lines = text.trimEnd().split("\r\n");
    expect(lines[0]).toBe(ANALYSIS_CSV_HEADER.join(","));
    expect(lines).toHaveLength(1 + 3 * 2);
    expect(lines).toContain("Alpha,Bea Test,2025-03-04,breach,10,8,25,102");
  });
});
