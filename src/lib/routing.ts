/** Shared, dependency-free host/route helpers — safe for edge middleware. */

export const TENANT_HEADER = "x-gym-slug";
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Slugs that would collide with platform routes or infrastructure.
 * A gym may NEVER claim one of these.
 */
export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "www",
  "login",
  "logout",
  "register",
  "signup",
  "signin",
  "auth",
  "dashboard",
  "portal",
  "members",
  "staff",
  "plans",
  "settings",
  "billing",
  "pay",
  "pricing",
  "about",
  "contact",
  "legal",
  "privacy",
  "terms",
  "support",
  "help",
  "docs",
  "blog",
  "status",
  "health",
  "assets",
  "static",
  "public",
  "cdn",
  "mail",
  "email",
  "webhooks",
  "cron",
  "invite",
  "reset-password",
  "forgot-password",
  "verify-email",
  "onboarding",
  "new",
  "search",
  "notifications",
  "attendance",
  "reports",
  "super-admin",
  "superadmin",
  "platform",
  "internal",
  "_next",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !slug.includes("--") && !RESERVED_SLUGS.has(slug);
}

export function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 30);
}

export type HostKind = "apex" | "app" | "local";

/**
 * Routing contract:
 *   brainorth.com                -> marketing
 *   gym.brainorth.com/admin      -> platform (SUPER_ADMIN)
 *   gym.brainorth.com/<slug>/... -> tenant
 * On localhost we cannot use subdomains, so everything is path-based.
 */
export function classifyHost(host: string | null | undefined): HostKind {
  if (!host) return "local";
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".e2b.app") ||
    hostname.endsWith(".vercel.app")
  ) {
    return "local";
  }
  const apex = (process.env.NEXT_PUBLIC_APEX_DOMAIN ?? "brainorth.com").toLowerCase();
  const appHost = (process.env.NEXT_PUBLIC_APP_HOST ?? `gym.${apex}`).toLowerCase();
  if (hostname === appHost) return "app";
  if (hostname === apex || hostname === `www.${apex}`) return "apex";
  // Unknown host: treat as app so tenant paths still resolve (preview domains).
  return "app";
}

/** First path segment if it looks like a tenant slug (not a platform route). */
export function tenantSlugFromPath(pathname: string): string | null {
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return null;
  if (RESERVED_SLUGS.has(seg)) return null;
  return SLUG_RE.test(seg) ? seg : null;
}

export function isPlatformPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

/** Auth surface + public endpoints that never require a session cookie. */
export function isPublicPath(pathname: string): boolean {
  const publicPrefixes = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/invite",
    "/pay",
    "/api/webhooks",
    "/api/cron",
    "/api/health",
  ];
  return (
    pathname === "/" ||
    publicPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
}
