import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listApproverTeamIds } from "../data/approvals";
import { getAppUser } from "../data/users";
import { authBypassEnabled, DEMO_USER_EMAIL, VIEW_AS_COOKIE } from "../env";
import { createAuthClient } from "../supabase/server";
import { createServiceClient } from "../supabase/service";
import {
  effectiveRole,
  evaluateAccess,
  homeFor,
  isViewingAs,
  teamScope,
  type AccessDecision,
  type Role,
} from "./roles";

export interface CurrentUser {
  email: string;
  displayName: string;
  /** The role stored for the signed-in user. Never changed by "View as". */
  actualRole: Role;
  /** The tier this request is evaluated at. */
  role: Role;
  viewAs: string | null;
  viewingAs: boolean;
  memberId: number | null;
  /** null = all teams. */
  teamScope: number[] | null;
}

/** The signed-in email, or null. Validated against the Auth server (getUser), not just the cookie. */
const getSessionEmail = cache(async (): Promise<string | null> => {
  if (authBypassEnabled()) return DEMO_USER_EMAIL;
  try {
    const supabase = await createAuthClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user?.email) return null;
    return data.user.email.toLowerCase();
  } catch {
    return null;
  }
});

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const email = await getSessionEmail();
  if (!email) return null;
  const db = createServiceClient();
  const appUser = await getAppUser(db, email);
  if (!appUser) return null;

  const cookieStore = await cookies();
  const viewAs = cookieStore.get(VIEW_AS_COOKIE)?.value ?? null;
  const role = effectiveRole(appUser.role, viewAs);
  const approverTeams = role === "lead" ? await listApproverTeamIds(db, appUser.member_id) : [];

  return {
    email: appUser.email,
    displayName: appUser.display_name,
    actualRole: appUser.role,
    role,
    viewAs,
    viewingAs: isViewingAs(appUser.role, viewAs),
    memberId: appUser.member_id,
    teamScope: teamScope(role, approverTeams),
  };
});

export type AccessResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; decision: Extract<AccessDecision, { ok: false }> };

/**
 * The one guard. Pages, server actions and route handlers all call this (or
 * requireMinRole, which wraps it) themselves; nothing relies on a layout
 * having checked first.
 */
export async function checkAccess(minRole: Role, options: { mutation?: boolean } = {}): Promise<AccessResult> {
  const user = await getCurrentUser();
  const decision = evaluateAccess({
    actualRole: user?.actualRole ?? null,
    viewAs: user?.viewAs,
    minRole,
    mutation: options.mutation,
  });
  if (!decision.ok || !user) {
    return { ok: false, decision: decision.ok ? { ok: false, reason: "unauthenticated", needed: minRole } : decision };
  }
  return { ok: true, user };
}

/** For pages: redirects instead of returning a refusal. */
export async function requireMinRole(minRole: Role): Promise<CurrentUser> {
  const access = await checkAccess(minRole);
  if (access.ok) return access.user;
  if (access.decision.reason === "unauthenticated") redirect("/signin");
  redirect(`/no-access?need=${minRole}`);
}

/** For route handlers: a JSON 401/403, or the user. */
export async function requireApiRole(
  minRole: Role,
  options: { mutation?: boolean } = {},
): Promise<{ user: CurrentUser; response: null } | { user: null; response: Response }> {
  const access = await checkAccess(minRole, options);
  if (access.ok) return { user: access.user, response: null };
  const status = access.decision.reason === "unauthenticated" ? 401 : 403;
  return {
    user: null,
    response: Response.json({ error: refusalMessage(access.decision.reason, minRole) }, { status }),
  };
}

export function refusalMessage(reason: "unauthenticated" | "forbidden" | "view_as_read_only", needed: Role): string {
  if (reason === "unauthenticated") return "Sign in to continue.";
  if (reason === "view_as_read_only") return "You are previewing another role. Switch back to your own role to make changes.";
  return `This needs the ${needed} role or higher.`;
}

export { homeFor };
