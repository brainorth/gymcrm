"use server";

import { headers } from "next/headers";
import { prisma } from "@/server/db/client";
import { ConflictError, ValidationFailedError, isUniqueViolation } from "@/server/db/errors";
import { writeAudit } from "@/server/audit/log";
import { appUrl, escapeHtml, sendEmail } from "@/server/notifications/mailer";
import { isSlugAvailable } from "@/server/tenancy/resolve";
import { newOpaqueToken, tokenFingerprint } from "./tokens";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import {
  clearSessionCookie,
  createSession,
  destroyCurrentSession,
  getCurrentSession,
  landingPathFor,
  requireUser,
  revokeAllSessionsForUser,
  setSessionCookie,
} from "./session";
import {
  assertNotThrottled,
  clearAttempts,
  emailKey,
  ipKey,
  recordAttempt,
  THROTTLE_POLICIES,
} from "./throttle";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerGymSchema,
  resetPasswordSchema,
  slugSchema,
  switchGymSchema,
} from "./schemas";
import { runAction, type ActionResult } from "@/server/actions/result";

const TRIAL_DAYS = 14;

async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const realIp = h.get("x-real-ip")?.trim() || h.get("cf-connecting-ip")?.trim();
  const forwardedIp = h
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .pop();
  return {
    ip: realIp || forwardedIp || null,
    userAgent: h.get("user-agent"),
  };
}

/** Public: live slug availability while the owner types. */
export async function checkSlugAvailability(input: string): Promise<ActionResult<{ available: boolean }>> {
  return runAction(async () => {
    const slug = slugSchema.parse(input);
    return { available: await isSlugAvailable(slug) };
  });
}

/**
 * Gym onboarding step 1: claim a slug + create the owner account + start a trial.
 * Everything happens in ONE transaction so a taken slug cannot leave an orphan
 * user behind. Billing details are collected later by the SaaS billing module.
 */
export async function registerGym(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const data = registerGymSchema.parse(input);
    const meta = await requestMeta();
    await assertNotThrottled(`register:${meta.ip ?? "unknown"}`, THROTTLE_POLICIES.register);
    await recordAttempt(`register:${meta.ip ?? "unknown"}`, THROTTLE_POLICIES.register);

    const existing = await prisma.user.findUnique({
      where: { email: data.email },
      select: { id: true },
    });
    if (existing) {
      throw new ValidationFailedError("That email already has an account.", {
        email: ["Sign in instead, then add a gym from your dashboard."],
      });
    }

    const passwordHash = await hashPassword(data.password);
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);

    let created: { userId: string; gymId: string; slug: string };
    try {
      created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: data.email,
            name: data.ownerName,
            phone: data.phone ?? null,
            passwordHash,
          },
          select: { id: true },
        });
        const gym = await tx.gym.create({
          data: {
            name: data.gymName,
            slug: data.slug,
            ownerId: user.id,
            timezone: data.timezone,
            currency: data.currency,
            qrSecret: newOpaqueToken(32),
            billingStatus: "TRIALING",
            trialEndsAt,
          },
          select: { id: true, slug: true },
        });
        await tx.gymMembership.create({
          data: { userId: user.id, gymId: gym.id, role: "GYM_OWNER" },
        });
        const starter = await tx.saasPlan.findFirst({
          where: { code: "starter", isActive: true },
          select: { id: true },
        });
        if (starter) {
          await tx.saasSubscription.create({
            data: {
              gymId: gym.id,
              planId: starter.id,
              status: "TRIALING",
              trialEndsAt,
            },
          });
        }
        await tx.auditLog.create({
          data: {
            gymId: gym.id,
            actorUserId: user.id,
            actorRole: "GYM_OWNER",
            action: "gym.register",
            entityType: "Gym",
            entityId: gym.id,
            after: { name: data.gymName, slug: gym.slug, trialEndsAt },
            ip: meta.ip,
            userAgent: meta.userAgent?.slice(0, 400),
          },
        });
        return { userId: user.id, gymId: gym.id, slug: gym.slug };
      });
    } catch (error) {
      if (isUniqueViolation(error, ["slug"])) {
        throw new ValidationFailedError("That gym URL was just taken.", {
          slug: ["Pick another URL."],
        });
      }
      if (isUniqueViolation(error, ["email"])) {
        throw new ValidationFailedError("That email already has an account.", {
          email: ["Sign in instead."],
        });
      }
      throw error;
    }

    const { token, expiresAt } = await createSession({
      userId: created.userId,
      activeGymId: created.gymId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await setSessionCookie(token, expiresAt);
    return { redirectTo: `/${created.slug}/dashboard` };
  });
}

export async function login(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const data = loginSchema.parse(input);
    const meta = await requestMeta();
    const eKey = emailKey(data.email);
    const iKey = ipKey(meta.ip);
    await assertNotThrottled(eKey, THROTTLE_POLICIES.loginEmail);
    await assertNotThrottled(iKey, THROTTLE_POLICIES.loginIp);

    const user = await prisma.user.findUnique({
      where: { email: data.email },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        isActive: true,
        platformRole: true,
        emailVerifiedAt: true,
        memberships: {
          where: { isActive: true },
          select: {
            role: true,
            gym: {
              select: { id: true, slug: true, name: true, status: true, billingStatus: true, deletedAt: true },
            },
          },
        },
      },
    });

    const passwordOk = await verifyPassword(user?.passwordHash, data.password);
    if (!user || !passwordOk) {
      await recordAttempt(eKey, THROTTLE_POLICIES.loginEmail);
      await recordAttempt(iKey, THROTTLE_POLICIES.loginIp);
      // Same message either way: no account enumeration.
      throw new ValidationFailedError("Email or password is incorrect.");
    }
    if (!user.isActive) {
      throw new ValidationFailedError("This account has been disabled. Contact support.");
    }

    await clearAttempts(eKey);
    if (user.passwordHash && needsRehash(user.passwordHash)) {
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(data.password) },
      });
    }

    const memberships = user.memberships
      .filter((m) => m.gym.deletedAt === null)
      .map((m) => ({
        gymId: m.gym.id,
        gymSlug: m.gym.slug,
        gymName: m.gym.name,
        role: m.role,
        gymStatus: m.gym.status,
        billingStatus: m.gym.billingStatus,
      }));

    const { token, expiresAt } = await createSession({
      userId: user.id,
      activeGymId: memberships[0]?.gymId ?? null,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await setSessionCookie(token, expiresAt);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const redirectTo =
      data.next ??
      landingPathFor({
        id: user.id,
        email: user.email,
        name: user.name,
        platformRole: user.platformRole,
        emailVerifiedAt: user.emailVerifiedAt,
        memberships,
      });
    return { redirectTo };
  });
}

export async function logout(): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    await destroyCurrentSession();
    return { redirectTo: "/login" };
  });
}

export async function logoutEverywhere(): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const user = await requireUser();
    await revokeAllSessionsForUser(user.id);
    await clearSessionCookie();
    return { redirectTo: "/login" };
  });
}

/** Tenant switcher. Membership is re-verified here AND on every later request. */
export async function switchGym(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const { gymSlug } = switchGymSchema.parse(input);
    const session = await getCurrentSession();
    if (!session) throw new ValidationFailedError("Your session expired. Sign in again.");
    const membership = session.user.memberships.find((m) => m.gymSlug === gymSlug);
    if (!membership) throw new ConflictError("You are not a member of that gym.");
    await prisma.session.update({
      where: { id: session.sessionId },
      data: { activeGymId: membership.gymId },
    });
    return {
      redirectTo:
        membership.role === "MEMBER" ? `/${gymSlug}/portal` : `/${gymSlug}/dashboard`,
    };
  });
}

export async function requestPasswordReset(input: unknown): Promise<ActionResult<{ sent: true }>> {
  return runAction(async () => {
    const { email } = forgotPasswordSchema.parse(input);
    const key = `reset:${email}`;
    await assertNotThrottled(key, THROTTLE_POLICIES.passwordReset);
    await recordAttempt(key, THROTTLE_POLICIES.passwordReset);

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
    if (user) {
      const token = newOpaqueToken();
      await prisma.$transaction([
        prisma.verificationToken.updateMany({
          where: { email, purpose: "PASSWORD_RESET", consumedAt: null },
          data: { consumedAt: new Date() },
        }),
        prisma.verificationToken.create({
          data: {
            purpose: "PASSWORD_RESET",
            tokenHash: tokenFingerprint(token),
            email,
            userId: user.id,
            expiresAt: new Date(Date.now() + 60 * 60_000),
          },
        }),
      ]);
      const link = appUrl(`/reset-password?token=${token}`);
      await sendEmail({
        to: email,
        subject: "Reset your password",
        text: `Hi ${user.name}, reset your password: ${link} (valid for 1 hour). Ignore this if you did not ask.`,
        html: `<p>Hi ${escapeHtml(user.name)},</p><p><a href="${escapeHtml(link)}">Reset your password</a> — valid for 1 hour.</p><p>If you didn't request this, ignore this email.</p>`,
      });
    }
    // Always the same answer, whether or not the account exists.
    return { sent: true };
  });
}

export async function resetPassword(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const data = resetPasswordSchema.parse(input);
    const row = await prisma.verificationToken.findFirst({
      where: {
        tokenHash: tokenFingerprint(data.token),
        purpose: { in: ["PASSWORD_RESET", "STAFF_INVITE"] },
      },
    });
    if (
      !row ||
      row.consumedAt ||
      row.expiresAt <= new Date() ||
      !row.userId
    ) {
      throw new ValidationFailedError("This reset link is invalid or has expired.");
    }
    const passwordHash = await hashPassword(data.password);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: row.userId },
        data: { passwordHash, emailVerifiedAt: new Date() },
      }),
      prisma.verificationToken.update({
        where: { id: row.id },
        data: { consumedAt: new Date() },
      }),
    ]);
    // A password reset must kill every existing session.
    await revokeAllSessionsForUser(row.userId);
    await writeAudit({
      gymId: null,
      actorUserId: row.userId,
      action: "auth.password_reset",
      entityType: "User",
      entityId: row.userId,
    });
    return { redirectTo: "/login?reset=1" };
  });
}

export async function changePassword(input: unknown): Promise<ActionResult<{ changed: true }>> {
  return runAction(async () => {
    const data = changePasswordSchema.parse(input);
    const session = await getCurrentSession();
    const user = await requireUser();
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!(await verifyPassword(row?.passwordHash, data.currentPassword))) {
      throw new ValidationFailedError("Your current password is incorrect.", {
        currentPassword: ["Incorrect password."],
      });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(data.newPassword) },
    });
    await prisma.session.updateMany({
      where: { userId: user.id, id: { not: session?.sessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAudit({
      gymId: null,
      actorUserId: user.id,
      action: "auth.password_change",
      entityType: "User",
      entityId: user.id,
    });
    return { changed: true };
  });
}
