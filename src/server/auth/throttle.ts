import { prisma } from "@/server/db/client";
import { RateLimitedError } from "@/server/db/errors";

/**
 * Postgres-backed sliding-window throttle. In-memory counters are useless on
 * serverless (every cold start resets them), and we already have a database.
 *
 * Two keys are checked for login: per-email (credential stuffing on one account)
 * and per-IP (spray across many accounts).
 */
type Policy = { limit: number; windowMs: number; lockMs: number };

export const THROTTLE_POLICIES = {
  loginEmail: { limit: 8, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
  loginIp: { limit: 40, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
  register: { limit: 5, windowMs: 60 * 60_000, lockMs: 60 * 60_000 },
  passwordReset: { limit: 4, windowMs: 60 * 60_000, lockMs: 60 * 60_000 },
} as const satisfies Record<string, Policy>;

export async function assertNotThrottled(key: string, policy: Policy): Promise<void> {
  const row = await prisma.authThrottle.findUnique({ where: { key } });
  if (!row) return;
  if (row.lockedUntil && row.lockedUntil > new Date()) {
    throw new RateLimitedError(
      "Too many attempts. Please wait before trying again.",
      Math.ceil((row.lockedUntil.getTime() - Date.now()) / 1000),
    );
  }
  if (Date.now() - row.windowStartedAt.getTime() > policy.windowMs) return;
  if (row.hits >= policy.limit) {
    throw new RateLimitedError("Too many attempts. Please wait before trying again.", policy.lockMs / 1000);
  }
}

/** Atomic increment; returns true when this hit tripped the lock. */
export async function recordAttempt(key: string, policy: Policy): Promise<void> {
  const now = new Date();
  const row = await prisma.authThrottle.upsert({
    where: { key },
    create: { key, hits: 1, windowStartedAt: now },
    update: { hits: { increment: 1 } },
  });
  const expired = now.getTime() - row.windowStartedAt.getTime() > policy.windowMs;
  if (expired) {
    await prisma.authThrottle.update({
      where: { key },
      data: { hits: 1, windowStartedAt: now, lockedUntil: null },
    });
    return;
  }
  if (row.hits >= policy.limit) {
    await prisma.authThrottle.update({
      where: { key },
      data: { lockedUntil: new Date(now.getTime() + policy.lockMs) },
    });
  }
}

export async function clearAttempts(key: string): Promise<void> {
  await prisma.authThrottle.deleteMany({ where: { key } });
}

export function emailKey(email: string): string {
  return `login:email:${email.trim().toLowerCase()}`;
}

export function ipKey(ip: string | null | undefined): string {
  return `login:ip:${ip ?? "unknown"}`;
}
