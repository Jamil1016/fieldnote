import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authBypassEnabled } from "@/lib/env";
import { NO_REALTIME } from "@/lib/supabase/no-realtime";

/**
 * Session refresh, following the @supabase/ssr pattern. Server Components
 * cannot write cookies, so the refreshed token has to be written here, before
 * render.
 *
 * This does NOT gate access. Authorisation lives in requireMinRole() /
 * checkAccess(), which every page, server action and route handler calls.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || authBypassEnabled()) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    realtime: NO_REALTIME,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  try {
    // getClaims() refreshes an expired session (writing the new cookie above)
    // and verifies the token's signature against the project's public key
    // locally, instead of calling the Auth server on every request as getUser()
    // does. The cost: a session revoked server-side stays valid until its
    // token expires (one hour), which is acceptable for a shared demo account.
    await supabase.auth.getClaims();
  } catch {
    // Auth service unreachable: let the request through; the guard decides.
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
