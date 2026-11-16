import { cookies } from "next/headers";
import { cache } from "react";
import { env } from "@/env";
import { prisma } from "@/server/db/client";
import { UnauthenticatedError } from "@/server/db/errors";
import type { BillingStatus, GymRole, GymStatus, PlatformRole } from "@/generated/prisma/client";
import { newOpaqueToken, tokenFingerprint } from "./tokens";

/**
 * Own auth, database-backed sessions.
 *
 * Why not JWT? Revocation. "Log out everywhere", "fire this trainer", "suspend
 * this gym" must take effect on the NEXT request, not when a token expires.
 * The cookie holds an opaque 256-bit token; the DB holds only its HMAC.
 *
 * The cookie is scoped to the apex domain in production so one sign-in works on
 * both brainorth.com and gym.brainorth.com. Tenant authority is NEVER taken from the cookie:
 * `activeGymId` is a UI convenience that requireTenant() re-verifies every time.
 */

export type SessionMembership = {
  gymId: string;
  gymSlug: string;
  gymName: string;
  role: GymRole;
  gymStatus: GymStatus;
  billingStatus: BillingStatus;
};

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  platformRole: PlatformRole;
  emailVerifiedAt: Date | null;
  memberships: SessionMembership[];
};

export type CurrentSession = {
  sessionId: string;
  user: SessionUser;
  activeGymId: string | null;
  expiresAt: Date;
};

function cookieDomain(): string | undefined {
  const apex = (process.env.NEXT_PUBLIC_APEX_DOMAIN ?? "").split(":")[0]?.toLowerCase();
  if (!apex || apex === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(apex)) return undefined;
  if (apex.endsWith(".e2b.app") || apex.endsWith(".vercel.app")) return undefined;
  return `.${apex}`;
}

function ttlMs(): number {
  return env().SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
}

export async function createSession(input: {
  userId: string;
  activeGymId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = newOpaqueToken();
  const expiresAt = new Date(Date.now() + ttlMs());
  const session = await prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash: tokenFingerprint(token),
      activeGymId: input.activeGymId ?? null,
      expiresAt,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 400) ?? null,
    },
    select: { id: true },
  });
  return { token, sessionId: session.id, expiresAt };
}

/** Only call from a Server Action or Route Handler (Next forbids it in RSC). */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(env().SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    domain: cookieDomain(),
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(env().SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    domain: cookieDomain(),
    maxAge: 0,
  });
}

/** Per-request memoised. Safe to call from any server component. */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  const store = await cookies();
  const token = store.get(env().SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const row = await prisma.session.findUnique({
    where: { tokenHash: tokenFingerprint(token) },
    select: {
      id: true,
      activeGymId: true,
      expiresAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          platformRole: true,
          emailVerifiedAt: true,
          isActive: true,
          memberships: {
            where: { isActive: true },
            select: {
              role: true,
              gym: {
                select: {
                  id: true,
                  slug: true,
                  name: true,
                  status: true,
                  billingStatus: true,
                  deletedAt: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!row || row.revokedAt || row.expiresAt <= new Date() || !row.user.isActive) {
    return null;
  }

  // Sliding expiry: refresh once we're past the halfway mark.
  if (row.expiresAt.getTime() - Date.now() < ttlMs() / 2) {
    const expiresAt = new Date(Date.now() + ttlMs());
    await prisma.session.update({
      where: { id: row.id },
      data: { expiresAt, lastSeenAt: new Date() },
    });
    row.expiresAt = expiresAt;
  }

  return {
    sessionId: row.id,
    activeGymId: row.activeGymId,
    expiresAt: row.expiresAt,
    user: {
      id: row.user.id,
      email: row.user.email,
      name: row.user.name,
      platformRole: row.user.platformRole,
      emailVerifiedAt: row.user.emailVerifiedAt,
      memberships: row.user.memberships
        .filter((m) => m.gym.deletedAt === null)
        .map((m) => ({
          gymId: m.gym.id,
          gymSlug: m.gym.slug,
          gymName: m.gym.name,
          role: m.role,
          gymStatus: m.gym.status,
          billingStatus: m.gym.billingStatus,
        })),
    },
  };
});

export async function requireUser(): Promise<SessionUser> {
  const session = await getCurrentSession();
  if (!session) throw new UnauthenticatedError();
  return session.user;
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function destroyCurrentSession(): Promise<void> {
  const session = await getCurrentSession();
  if (session) await revokeSessionById(session.sessionId);
  await clearSessionCookie();
}

/** Where should this user land after sign-in? */
export function landingPathFor(user: SessionUser): string {
  const first = user.memberships[0];
  if (first) {
    return first.role === "MEMBER" ? `/${first.gymSlug}/portal` : `/${first.gymSlug}/dashboard`;
  }
  if (user.platformRole === "SUPER_ADMIN") return "/admin";
  return "/register";
}
