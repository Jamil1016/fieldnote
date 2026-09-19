"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkAccess } from "@/lib/auth/session";
import { effectiveRole, homeFor, isViewAsRole } from "@/lib/auth/roles";
import { VIEW_AS_COOKIE } from "@/lib/env";

/**
 * "View as": a read-only preview of a lower tier. It writes ONE cookie and
 * nothing else; the signed-in user and their stored role never change. This
 * is the only action allowed while a preview is active (it has to be, to
 * switch back), which is why it does not pass `mutation: true`.
 */
export async function setViewAs(formData: FormData): Promise<void> {
  const access = await checkAccess("viewer");
  if (!access.ok) redirect("/signin");

  const requested = formData.get("role");
  const cookieStore = await cookies();
  const actual = access.user.actualRole;

  if (!isViewAsRole(requested) || effectiveRole(actual, requested) === actual) {
    cookieStore.delete(VIEW_AS_COOKIE);
    redirect(homeFor(actual));
  }
  cookieStore.set(VIEW_AS_COOKIE, requested, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 4,
  });
  redirect(homeFor(effectiveRole(actual, requested)));
}
