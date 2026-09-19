import { describe, expect, it } from "vitest";
import { authBypassEnabled, bypassRefusedReason, isDemoMode } from "../env";
import {
  effectiveRole,
  evaluateAccess,
  hasMinRole,
  homeFor,
  isRole,
  isViewAsRole,
  isViewingAs,
  lowerOf,
  navFor,
  roleRank,
  ROLES,
  teamScope,
} from "./roles";

describe("role ordering", () => {
  it("is viewer < lead < manager < hr_staff < admin", () => {
    expect([...ROLES]).toEqual(["viewer", "lead", "manager", "hr_staff", "admin"]);
    for (let i = 1; i < ROLES.length; i += 1) expect(roleRank(ROLES[i])).toBeGreaterThan(roleRank(ROLES[i - 1]));
  });

  it("every role satisfies its own minimum", () => {
    for (const r of ROLES) expect(hasMinRole(r, r)).toBe(true);
  });

  it("a higher role satisfies every lower minimum and no higher one", () => {
    for (const have of ROLES) {
      for (const need of ROLES) {
        expect(hasMinRole(have, need)).toBe(roleRank(have) >= roleRank(need));
      }
    }
  });

  it("lowerOf picks the lower tier", () => {
    expect(lowerOf("manager", "lead")).toBe("lead");
    expect(lowerOf("viewer", "admin")).toBe("viewer");
  });

  it("isRole rejects unknown values", () => {
    expect(isRole("manager")).toBe(true);
    expect(isRole("superuser")).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(3)).toBe(false);
  });

  it("only viewer, lead and manager can be previewed", () => {
    expect(isViewAsRole("lead")).toBe(true);
    expect(isViewAsRole("admin")).toBe(false);
    expect(isViewAsRole("hr_staff")).toBe(false);
  });
});

describe("effectiveRole (View as)", () => {
  it("lowers a manager to lead", () => {
    expect(effectiveRole("manager", "lead")).toBe("lead");
  });

  it("can never raise a role", () => {
    expect(effectiveRole("viewer", "manager")).toBe("viewer");
    expect(effectiveRole("lead", "manager")).toBe("lead");
  });

  it("ignores tampered cookie values", () => {
    expect(effectiveRole("manager", "admin")).toBe("manager");
    expect(effectiveRole("manager", "'; drop table")).toBe("manager");
    expect(effectiveRole("manager", null)).toBe("manager");
    expect(effectiveRole("manager", 42)).toBe("manager");
  });

  it("viewing as your own role is not 'viewing as'", () => {
    expect(isViewingAs("manager", "manager")).toBe(false);
    expect(isViewingAs("manager", "viewer")).toBe(true);
    expect(isViewingAs("manager", undefined)).toBe(false);
  });
});

describe("evaluateAccess", () => {
  it("refuses when nobody is signed in", () => {
    expect(evaluateAccess({ actualRole: null, minRole: "viewer" })).toEqual({
      ok: false,
      reason: "unauthenticated",
      needed: "viewer",
    });
  });

  it("allows a manager onto a manager page", () => {
    expect(evaluateAccess({ actualRole: "manager", minRole: "manager" })).toEqual({ ok: true, effectiveRole: "manager" });
  });

  it("refuses a manager on an hr_staff page", () => {
    expect(evaluateAccess({ actualRole: "manager", minRole: "hr_staff" })).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("applies the previewed tier to page access", () => {
    expect(evaluateAccess({ actualRole: "manager", viewAs: "viewer", minRole: "lead" })).toMatchObject({
      ok: false,
      reason: "forbidden",
    });
    expect(evaluateAccess({ actualRole: "manager", viewAs: "lead", minRole: "lead" })).toEqual({
      ok: true,
      effectiveRole: "lead",
    });
  });

  it("blocks mutations while previewing another tier, even if that tier could do it", () => {
    expect(evaluateAccess({ actualRole: "manager", viewAs: "lead", minRole: "lead", mutation: true })).toMatchObject({
      ok: false,
      reason: "view_as_read_only",
    });
  });

  it("reports forbidden before read-only when the previewed tier lacks access", () => {
    expect(evaluateAccess({ actualRole: "manager", viewAs: "viewer", minRole: "lead", mutation: true })).toMatchObject({
      reason: "forbidden",
    });
  });

  it("allows mutations when not previewing", () => {
    expect(evaluateAccess({ actualRole: "manager", minRole: "lead", mutation: true }).ok).toBe(true);
    expect(evaluateAccess({ actualRole: "manager", viewAs: "manager", minRole: "lead", mutation: true }).ok).toBe(true);
  });

  it("a tampered view-as cookie neither elevates nor blocks", () => {
    expect(evaluateAccess({ actualRole: "lead", viewAs: "admin", minRole: "manager" }).ok).toBe(false);
    expect(evaluateAccess({ actualRole: "lead", viewAs: "admin", minRole: "lead", mutation: true }).ok).toBe(true);
  });

  it("admin passes every minimum", () => {
    for (const need of ROLES) expect(evaluateAccess({ actualRole: "admin", minRole: need }).ok).toBe(true);
  });
});

describe("navigation and scope", () => {
  it("a viewer only sees the directory", () => {
    expect(navFor("viewer").map((n) => n.href)).toEqual(["/directory"]);
  });

  it("a lead sees approvals, analysis and the directory, not the scorecard or reminders", () => {
    const hrefs = navFor("lead").map((n) => n.href);
    expect(hrefs).toContain("/approvals");
    expect(hrefs).toContain("/analysis");
    expect(hrefs).not.toContain("/approvals/scorecard");
    expect(hrefs).not.toContain("/reminders");
  });

  it("a manager does not see hr_staff pages, an admin sees everything", () => {
    expect(navFor("manager").map((n) => n.href)).not.toContain("/policy");
    expect(navFor("admin")).toHaveLength(6);
  });

  it("nav grows monotonically with rank", () => {
    for (let i = 1; i < ROLES.length; i += 1) {
      expect(navFor(ROLES[i]).length).toBeGreaterThanOrEqual(navFor(ROLES[i - 1]).length);
    }
  });

  it("homeFor sends each tier to its first allowed page", () => {
    expect(homeFor("viewer")).toBe("/directory");
    expect(homeFor("manager")).toBe("/approvals");
  });

  it("team scope: managers all, leads their teams, viewers none", () => {
    expect(teamScope("manager", [1])).toBeNull();
    expect(teamScope("admin", [])).toBeNull();
    expect(teamScope("lead", [1, 3])).toEqual([1, 3]);
    expect(teamScope("viewer", [1, 3])).toEqual([]);
  });
});

describe("environment switches", () => {
  it("demo mode is on only for the exact string true", () => {
    expect(isDemoMode({ DEMO_MODE: "true" })).toBe(true);
    expect(isDemoMode({ DEMO_MODE: "TRUE" })).toBe(false);
    expect(isDemoMode({})).toBe(false);
  });

  it("auth bypass works only in local demo mode", () => {
    expect(authBypassEnabled({ DEMO_AUTH_BYPASS_FOR_LOCAL_TESTS: "true", DEMO_MODE: "true", NODE_ENV: "development" })).toBe(true);
  });

  it("auth bypass is refused in production", () => {
    const env = { DEMO_AUTH_BYPASS_FOR_LOCAL_TESTS: "true", DEMO_MODE: "true", NODE_ENV: "production" };
    expect(authBypassEnabled(env)).toBe(false);
    expect(bypassRefusedReason(env)).toMatch(/production/);
  });

  it.each(["VERCEL", "VERCEL_ENV", "VERCEL_URL"])("auth bypass is refused when %s is set", (name) => {
    const env = { DEMO_AUTH_BYPASS_FOR_LOCAL_TESTS: "true", DEMO_MODE: "true", NODE_ENV: "development", [name]: "1" };
    expect(authBypassEnabled(env)).toBe(false);
    expect(bypassRefusedReason(env)).toMatch(/Vercel/);
  });

  it("auth bypass is off unless explicitly set, and needs demo mode", () => {
    expect(authBypassEnabled({ DEMO_MODE: "true" })).toBe(false);
    expect(authBypassEnabled({ DEMO_AUTH_BYPASS_FOR_LOCAL_TESTS: "true", NODE_ENV: "development" })).toBe(false);
    expect(bypassRefusedReason({ DEMO_MODE: "true" })).toBeNull();
  });
});
