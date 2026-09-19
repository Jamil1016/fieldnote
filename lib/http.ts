/**
 * Same-origin check for state-changing route handlers. Session cookies are
 * SameSite=Lax already; this is a second, explicit line of defence.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    // Non-browser clients send no Origin; browsers always do on POST.
    return request.headers.get("sec-fetch-site") !== "cross-site";
  }
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}
