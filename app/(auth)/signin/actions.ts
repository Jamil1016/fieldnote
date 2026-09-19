"use server";

import { redirect } from "next/navigation";
import { authBypassEnabled, DEMO_USER_EMAIL, isDemoMode } from "@/lib/env";
import { createAuthClient } from "@/lib/supabase/server";

/**
 * Sign in the seeded demo user with email + password. The password lives in
 * DEMO_USER_PASSWORD and never leaves the server; the visitor only presses a
 * button. Refuses outright unless DEMO_MODE=true.
 */
export async function enterDemo(): Promise<void> {
  if (!isDemoMode()) redirect("/signin?err=" + encodeURIComponent("Demo mode is not enabled (DEMO_MODE=true)."));
  if (authBypassEnabled()) redirect("/");

  const password = process.env.DEMO_USER_PASSWORD;
  if (!password) redirect("/signin?err=" + encodeURIComponent("DEMO_USER_PASSWORD is not set on the server."));

  const supabase = await createAuthClient();
  const { error } = await supabase.auth.signInWithPassword({ email: DEMO_USER_EMAIL, password });
  if (error) {
    redirect(
      "/signin?err=" +
        encodeURIComponent(`Demo sign-in failed: ${error.message}. Create the ${DEMO_USER_EMAIL} user in Supabase Auth (see README).`),
    );
  }
  redirect("/");
}

export async function signOut(): Promise<void> {
  if (!authBypassEnabled()) {
    const supabase = await createAuthClient();
    await supabase.auth.signOut();
  }
  redirect("/signin");
}
