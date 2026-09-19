import { z } from "zod";
import { unwrap, type Db } from "./db";

export const directoryRowSchema = z.object({
  member_id: z.number().int(),
  full_name: z.string(),
  email: z.string(),
  position: z.string(),
  shift: z.enum(["early", "day", "late"]),
  work_arrangement: z.enum(["on_site", "hybrid", "remote"]),
  status: z.enum(["active", "on_leave", "inactive"]),
  files_reports: z.boolean(),
  hired_on: z.string(),
  team_id: z.number().int(),
  team_name: z.string(),
  team_code: z.string(),
  client_label: z.string(),
  lead_member_id: z.number().int().nullable(),
  lead_name: z.string().nullable(),
  is_approver: z.boolean(),
});
export type DirectoryRow = z.infer<typeof directoryRowSchema>;

export async function listDirectory(db: Db): Promise<DirectoryRow[]> {
  const rows = unwrap(
    "listDirectory",
    await db.schema("fn_analytics").from("v_directory").select("*").order("team_name").order("full_name").limit(500),
  );
  return z.array(directoryRowSchema).parse(rows);
}

export async function getDirectoryMember(db: Db, memberId: number): Promise<DirectoryRow | null> {
  const rows = unwrap(
    "getDirectoryMember",
    await db.schema("fn_analytics").from("v_directory").select("*").eq("member_id", memberId).limit(1),
  );
  return z.array(directoryRowSchema).parse(rows)[0] ?? null;
}

export const memberReportSchema = z.object({
  report_id: z.number().int(),
  report_date: z.string(),
  hours_claimed: z.coerce.number(),
  filed_at: z.string(),
  status: z.enum(["awaiting", "approved"]),
  approved_at: z.string().nullable(),
});
export type MemberReport = z.infer<typeof memberReportSchema>;

export async function listMemberReports(db: Db, memberId: number, from: string, to: string): Promise<MemberReport[]> {
  const rows = unwrap(
    "listMemberReports",
    await db
      .schema("fn_analytics")
      .from("v_report_status")
      .select("report_id, report_date, hours_claimed, filed_at, status, approved_at")
      .eq("member_id", memberId)
      .gte("report_date", from)
      .lte("report_date", to)
      .order("report_date")
      .limit(200),
  );
  return z.array(memberReportSchema).parse(rows);
}
