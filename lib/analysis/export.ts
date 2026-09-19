import type { CsvValue } from "../csv/csv";
import type { TeamGroup } from "./heatmap";

export const ANALYSIS_CSV_HEADER = [
  "team",
  "member",
  "date",
  "state",
  "hours_claimed",
  "hours_tracked",
  "variance_pct",
  "report_id",
] as const;

/** Lazily yields the CSV rows for the groups currently in view. */
export function* analysisCsvRows(groups: readonly TeamGroup[]): Generator<CsvValue[]> {
  yield [...ANALYSIS_CSV_HEADER];
  for (const group of groups) {
    for (const row of group.rows) {
      for (const cell of row.cells) {
        yield [
          group.teamName,
          row.member.name,
          cell.day,
          cell.state,
          cell.claimed,
          cell.tracked,
          cell.variance === null ? null : Math.round(cell.variance * 1000) / 10,
          cell.reportId,
        ];
      }
    }
  }
}
