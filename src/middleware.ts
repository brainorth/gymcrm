import { NextResponse, type NextRequest } from "next/server";
import {
  REQUEST_ID_HEADER,
  classifyHost,
  isPlatformPath,
  isPublicPath,
  tenantSlugFromPath,
} from "@/lib/routing";

/**
 * COARSE gate only. Middleware runs before any DB access, so it answers exactly
 * two questions: "is this the right host for this path?" and "is there a session
 * cookie at all?". Every real authorization decision (tenant membership, role,
 * billing state) happens in requireTenant() on the server.
 *
 * SECURITY: inbound tenant headers are stripped. A client must never be able to
 * set the tenant hint itself. Even after we set it, downstream code treats it as
 * a hint — the authoritative gymId always comes from the [gymSlug] route param.
 */
const TENANT_HINT_HEADER = "x-tenant-hint";
const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "gym_session";

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = request.headers.get("host");
  const kind = classifyHost(host);
  const slug = tenantSlugFromPath(pathname);
  const hasSession = Boolean(request.cookies.get(COOKIE_NAME)?.value);

  // Forward headers with any client-supplied identity/tenant values removed.
  const forward = new Headers(request.headers);
  forward.delete(TENANT_HINT_HEADER);
  forward.delete("x-gym-id");
  forward.delete("x-gym-slug");
  forward.delete("x-user-id");
  forward.delete("x-user-role");
  const requestId = crypto.randomUUID();
  forward.set(REQUEST_ID_HEADER, requestId);
  if (slug) forward.set(TENANT_HINT_HEADER, slug);

  const next = () => NextResponse.next({ request: { headers: forward } });

  // On the apex domain, tenant/admin paths belong to the app host.
  if (kind === "apex" && (slug || isPlatformPath(pathname))) {
    const appHost = process.env.NEXT_PUBLIC_APP_HOST ?? "gym.brainorth.com";
    const url = request.nextUrl.clone();
    url.host = appHost.split(":")[0] ?? appHost;
    url.port = appHost.includes(":") ? (appHost.split(":")[1] ?? "") : "";
    url.protocol = "https:";
    return NextResponse.redirect(url);
  }

  if (isPublicPath(pathname)) return next();

  // Marketing pages on the apex host stay public.
  if (kind === "apex" && !slug && !isPlatformPath(pathname)) return next();

  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const response = next();
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static assets.
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|map|txt)$).*)",
  ],
};
