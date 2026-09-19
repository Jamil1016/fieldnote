/**
 * Role tiers, lowest to highest. Pure; safe to import from client components.
 */
export const ROLES = ["viewer", "lead", "manager", "hr_staff", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** Tiers a visitor may preview with the read-only "View as" switcher. */
export const VIEW_AS_ROLES = ["viewer", "lead", "manager"] as const;
export type ViewAsRole = (typeof VIEW_AS_ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  viewer: "Viewer",
  lead: "Lead",
  manager: "Manager",
  hr_staff: "HR staff",
  admin: "Admin",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isViewAsRole(value: unknown): value is ViewAsRole {
  return typeof value === "string" && (VIEW_AS_ROLES as readonly string[]).includes(value);
}

export function roleRank(role: Role): number {
  return ROLES.indexOf(role);
}

export function hasMinRole(role: Role, min: Role): boolean {
  return roleRank(role) >= roleRank(min);
}

export function lowerOf(a: Role, b: Role): Role {
  return roleRank(a) <= roleRank(b) ? a : b;
}

/**
 * The tier a request is evaluated at. "View as" can only ever LOWER the tier:
 * asking to view as something above your real role gives you your real role.
 * Unknown cookie values are ignored.
 */
export function effectiveRole(actual: Role, viewAs: unknown): Role {
  if (!isViewAsRole(viewAs)) return actual;
  return lowerOf(actual, viewAs);
}

/** True when the visitor is previewing a tier other than their own. */
export function isViewingAs(actual: Role, viewAs: unknown): boolean {
  return effectiveRole(actual, viewAs) !== actual;
}

export type AccessDecision =
  | { ok: true; effectiveRole: Role }
  | { ok: false; reason: "unauthenticated" | "forbidden" | "view_as_read_only"; needed: Role };

export interface AccessRequest {
  /** null = nobody signed in (or no app_user row). */
  actualRole: Role | null;
  viewAs?: unknown;
  minRole: Role;
  /** Mutations are refused while previewing another tier. */
  mutation?: boolean;
}

/** The single access rule. Every page, action and route handler goes through it. */
export function evaluateAccess(req: AccessRequest): AccessDecision {
  if (req.actualRole === null) return { ok: false, reason: "unauthenticated", needed: req.minRole };
  const effective = effectiveRole(req.actualRole, req.viewAs);
  if (!hasMinRole(effective, req.minRole)) return { ok: false, reason: "forbidden", needed: req.minRole };
  if (req.mutation && isViewingAs(req.actualRole, req.viewAs)) {
    return { ok: false, reason: "view_as_read_only", needed: req.minRole };
  }
  return { ok: true, effectiveRole: effective };
}

export interface NavItem {
  href: string;
  label: string;
  minRole: Role;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/approvals", label: "Approvals", minRole: "lead" },
  { href: "/approvals/scorecard", label: "Scorecard", minRole: "manager" },
  { href: "/analysis", label: "Hours variance", minRole: "lead" },
  { href: "/directory", label: "Directory", minRole: "viewer" },
  { href: "/reminders", label: "Reminders", minRole: "manager" },
  { href: "/policy", label: "Policy", minRole: "hr_staff" },
];

export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => hasMinRole(role, item.minRole));
}

/** Where a tier lands after sign-in or when it loses access to a page. */
export function homeFor(role: Role): string {
  return navFor(role)[0]?.href ?? "/directory";
}

/**
 * Team scope: managers and above see every team; a lead sees only the teams
 * they are an approver for; a viewer sees no approval data at all.
 * Returns null for "all teams".
 */
export function teamScope(role: Role, approverTeamIds: readonly number[]): number[] | null {
  if (hasMinRole(role, "manager")) return null;
  if (role === "lead") return [...approverTeamIds];
  return [];
}
