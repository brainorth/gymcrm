import { randomUUID } from "node:crypto";
import { requireGymBySlug, tenantAccessLevel, type ResolvedGym } from "@/server/tenancy/resolve";
import { tenantDb, type TenantDb } from "@/server/db/tenant-client";
import { runWithRequestContext, type RequestContext } from "@/server/db/context";
import { ForbiddenError, UnauthenticatedError } from "@/server/db/errors";
import type { GymRole } from "@/generated/prisma/client";
import { getCurrentSession, type SessionUser } from "./session";

/**
 * Authorization. Two questions, always both, always server-side:
 *   1. Does this user belong to THIS gym? (GymMembership, not a global role)
 *   2. Does that membership's role grant this permission?
 *
 * Middleware only checks "is there a session cookie". It cannot be trusted for
 * anything else — it runs before the DB and can be bypassed by direct RSC calls.
 */

export const PERMISSIONS = [
  "member:read",
  "member:write",
  "member:archive",
  "plan:read",
  "plan:write",
  "subscription:read",
  "subscription:write",
  "subscription:freeze",
  "payment:read",
  "payment:record",
  "payment:refund",
  "invoice:read",
  "invoice:write",
  "attendance:read",
  "attendance:mark",
  "analytics:read", // revenue + business totals: OWNER ONLY
  "staff:read",
  "staff:write",
  "gym:settings",
  "billing:saas", // the gym's SaaS subscription: OWNER ONLY
  "portal:self", // member's own data
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const OWNER: readonly Permission[] = PERMISSIONS.filter((p) => p !== "portal:self");

const STAFF: readonly Permission[] = [
  "member:read",
  "member:write",
  "plan:read",
  "subscription:read",
  "subscription:write",
  "subscription:freeze",
  "payment:read",
  "payment:record",
  "invoice:read",
  "invoice:write",
  "attendance:read",
  "attendance:mark",
];

const TRAINER: readonly Permission[] = [
  "member:read",
  "plan:read",
  "subscription:read",
  "attendance:read",
  "attendance:mark",
];

const MEMBER: readonly Permission[] = ["portal:self"];

export const ROLE_PERMISSIONS: Record<GymRole, readonly Permission[]> = {
  GYM_OWNER: OWNER,
  STAFF,
  TRAINER,
  MEMBER,
};

export function can(role: GymRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export type EffectiveRole = GymRole | "SUPER_ADMIN";

export type TenantContext = {
  user: SessionUser;
  gym: ResolvedGym;
  role: EffectiveRole;
  impersonating: boolean;
  db: TenantDb;
  request: RequestContext;
};

/**
 * The gate every tenant page/action goes through. Throws typed errors that the
 * action wrapper converts into safe client messages.
 */
export async function requireTenant(
  gymSlug: string,
  permission: Permission,
): Promise<TenantContext> {
  const [session, gymOrError] = await Promise.all([
    getCurrentSession(),
    requireGymBySlug(gymSlug).catch(
      (err: unknown): ResolvedGym | Error => (err instanceof Error ? err : new Error(String(err))),
    ),
  ]);
  if (!session) throw new UnauthenticatedError();
  if (gymOrError instanceof Error) throw gymOrError;
  const gym = gymOrError;
  const user = session.user;
  const isSuperAdmin = user.platformRole === "SUPER_ADMIN";
  const membership = user.memberships.find((m) => m.gymId === gym.id);

  if (!isSuperAdmin && !membership) {
    // Deliberately identical to "no permission": never confirm who belongs here.
    throw new ForbiddenError("You do not have access to this gym.");
  }

  const role: EffectiveRole = isSuperAdmin ? "SUPER_ADMIN" : membership!.role;

  if (!isSuperAdmin && !can(membership!.role, permission)) {
    throw new ForbiddenError("Your role does not allow this action.");
  }

  // Lapsed SaaS billing locks the tenant down to billing/settings for the owner.
  const access = tenantAccessLevel(gym);
  if (access === "closed") throw new ForbiddenError("This gym has been archived.");
  if (access === "billing_only" && !isSuperAdmin) {
    const allowed: Permission[] = ["billing:saas", "gym:settings", "portal:self"];
    if (!allowed.includes(permission)) {
      throw new ForbiddenError(
        "This gym's subscription is inactive. The owner must update billing to continue.",
      );
    }
  }

  const request: RequestContext = {
    requestId: randomUUID(),
    gymId: gym.id,
    gymSlug: gym.slug,
    userId: user.id,
    role,
    impersonating: isSuperAdmin && !membership,
  };

  return {
    user,
    gym,
    role,
    impersonating: request.impersonating,
    db: tenantDb(gym.id),
    request,
  };
}

/** Same gate, but also installs the ambient context for audit/outbox writes. */
export async function withTenant<T>(
  gymSlug: string,
  permission: Permission,
  fn: (ctx: TenantContext) => Promise<T>,
): Promise<T> {
  const ctx = await requireTenant(gymSlug, permission);
  return runWithRequestContext(ctx.request, () => fn(ctx));
}

export async function requireSuperAdmin(): Promise<SessionUser> {
  const session = await getCurrentSession();
  if (!session) throw new UnauthenticatedError();
  if (session.user.platformRole !== "SUPER_ADMIN") {
    throw new ForbiddenError("Platform administrators only.");
  }
  return session.user;
}

/** A MEMBER may only ever read their own MemberProfile. */
export async function requireOwnMemberProfile(ctx: TenantContext): Promise<string> {
  if (ctx.role !== "MEMBER") {
    throw new ForbiddenError("Only members can use the member portal.");
  }
  const profile = await ctx.db.memberProfile.findFirst({
    where: { userId: ctx.user.id },
    select: { id: true },
  });
  if (!profile) throw new ForbiddenError("No member profile is linked to this account.");
  return profile.id;
}
