import { z } from "zod";
import { unwrap, type Db } from "./db";

export const varianceSourceSchema = z.object({
  from: z.string(),
  to: z.string(),
  reports: z.array(z.tuple([z.number().int(), z.string(), z.coerce.number().nullable(), z.number().int()])),
  timers: z.array(z.tuple([z.number().int(), z.number(), z.number()])),
});
export type VarianceSource = z.infer<typeof varianceSourceSchema>;

export async function getVarianceSource(
  db: Db,
  from: string,
  to: string,
  memberId: number | null = null,
): Promise<VarianceSource> {
  const data = unwrap(
    "getVarianceSource",
    await db.schema("fn_analytics").rpc("variance_source", { p_from: from, p_to: to, p_member_id: memberId }),
  );
  return varianceSourceSchema.parse(data);
}

export async function listHolidays(db: Db): Promise<string[]> {
  const rows = unwrap("listHolidays", await db.schema("fn_analytics").from("v_holidays").select("holiday_date"));
  return z.array(z.object({ holiday_date: z.string() })).parse(rows).map((r) => r.holiday_date);
}

export const pipelineRunSchema = z.object({
  id: z.number().int(),
  source: z.string(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  status: z.string(),
  rows_loaded: z.number().int(),
});
export type PipelineRun = z.infer<typeof pipelineRunSchema>;

export async function listRecentPipelineRuns(db: Db, limit = 12): Promise<PipelineRun[]> {
  const rows = unwrap(
    "listRecentPipelineRuns",
    await db.schema("fn_analytics").from("v_pipeline_runs").select("*").order("started_at", { ascending: false }).limit(limit),
  );
  return z.array(pipelineRunSchema).parse(rows);
}
