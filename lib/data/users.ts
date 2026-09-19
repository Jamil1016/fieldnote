import { z } from "zod";
import { ROLES } from "../auth/roles";
import { DataError, unwrap, type Db } from "./db";

export const appUserSchema = z.object({
  email: z.string(),
  display_name: z.string(),
  role: z.enum(ROLES),
  member_id: z.number().int().nullable(),
});
export type AppUser = z.infer<typeof appUserSchema>;

export async function getAppUser(db: Db, email: string): Promise<AppUser | null> {
  const rows = unwrap(
    "getAppUser",
    await db.schema("fn_app").from("app_user").select("email, display_name, role, member_id").eq("email", email.toLowerCase()).limit(1),
  );
  return z.array(appUserSchema).parse(rows)[0] ?? null;
}

export async function writeAudit(
  db: Db,
  entry: { actorEmail: string; action: string; entity: string; entityId: string; detail?: Record<string, unknown> },
): Promise<void> {
  const result = await db.schema("fn_app").from("audit_log").insert({
    actor_email: entry.actorEmail,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId,
    detail: entry.detail ?? {},
  });
  if (result.error) throw new DataError("writeAudit", result.error.message);
}

export const auditRowSchema = z.object({
  id: z.number().int(),
  actor_email: z.string(),
  action: z.string(),
  entity: z.string(),
  entity_id: z.string(),
  detail: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});
export type AuditRow = z.infer<typeof auditRowSchema>;

export async function listAudit(db: Db, limit = 20): Promise<AuditRow[]> {
  const rows = unwrap(
    "listAudit",
    await db.schema("fn_app").from("audit_log").select("*").order("id", { ascending: false }).limit(limit),
  );
  return z.array(auditRowSchema).parse(rows);
}
