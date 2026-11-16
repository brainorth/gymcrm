"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { runAction, type ActionResult } from "@/server/actions/result";
import { auditInContext, writeAudit } from "@/server/audit/log";
import { hashPassword } from "@/server/auth/password";
import { withTenant } from "@/server/auth/rbac";
import { passwordSchema } from "@/server/auth/schemas";
import { createSession, setSessionCookie } from "@/server/auth/session";
import { newOpaqueToken, tokenFingerprint } from "@/server/auth/tokens";
import { prisma } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationFailedError } from "@/server/db/errors";
import { appUrl, escapeHtml, sendEmail } from "@/server/notifications/mailer";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const inviteMemberSchema = z.object({
  gymSlug: z.string().trim().min(1),
  memberId: z.string().trim().min(1),
});

const acceptMemberInviteSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

type InvitePayload = {
  memberId?: unknown;
  gymId?: unknown;
};

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
    userAgent: h.get("user-agent") || null,
  };
}

export async function inviteMemberAction(
  input: unknown,
): Promise<ActionResult<{ sent: true; email: string }>> {
  return runAction(async () => {
    const parsed = inviteMemberSchema.parse(input);

    const result = await withTenant(parsed.gymSlug, "member:write", async (ctx) => {
      const member = await ctx.db.memberProfile.findUnique({
        where: { id: parsed.memberId },
        select: { id: true, fullName: true, email: true, userId: true },
      });

      if (!member) {
        throw new NotFoundError("Member");
      }
      if (!member.email) {
        throw new ValidationFailedError("Member does not have an email address.", {
          email: ["Add an email address before sending an invite."],
        });
      }
      if (member.userId) {
        throw new ConflictError("This member has already claimed their account.");
      }

      const email = member.email.trim().toLowerCase();
      const rawToken = newOpaqueToken();
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

      await prisma.$transaction([
        prisma.verificationToken.updateMany({
          where: {
            email,
            gymId: ctx.gym.id,
            purpose: "MEMBER_INVITE",
            consumedAt: null,
          },
          data: { consumedAt: new Date() },
        }),
        prisma.verificationToken.create({
          data: {
            purpose: "MEMBER_INVITE",
            tokenHash: tokenFingerprint(rawToken),
            email,
            gymId: ctx.gym.id,
            payload: { memberId: member.id, gymId: ctx.gym.id },
            expiresAt,
          },
        }),
      ]);

      const link = appUrl(`/invite?token=${rawToken}`);
      await sendEmail({
        to: email,
        subject: `Claim your ${ctx.gym.name} member portal`,
        text: `Hi ${member.fullName}, claim your ${ctx.gym.name} member account: ${link} (valid for 7 days).`,
        html: `<p>Hi ${escapeHtml(member.fullName)},</p><p>You've been invited to the <strong>${escapeHtml(ctx.gym.name)}</strong> member portal.</p><p><a href="${escapeHtml(link)}">Set your password and claim your account</a> — this link is valid for 7 days.</p>`,
      });

      await auditInContext({
        action: "member.invite",
        entityType: "MemberProfile",
        entityId: member.id,
        after: { email },
      });

      return { sent: true as const, email };
    });

    revalidatePath(`/${parsed.gymSlug}/members`);
    return result;
  });
}

export async function acceptMemberInviteAction(
  input: unknown,
): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const data = acceptMemberInviteSchema.parse(input);
    const meta = await requestMeta();

    const row = await prisma.verificationToken.findUnique({
      where: { tokenHash: tokenFingerprint(data.token) },
    });

    const payload = (row?.payload ?? {}) as InvitePayload;
    const memberId = typeof payload.memberId === "string" ? payload.memberId : null;
    const gymId = typeof payload.gymId === "string" ? payload.gymId : row?.gymId ?? null;

    if (
      !row ||
      row.purpose !== "MEMBER_INVITE" ||
      row.consumedAt ||
      row.expiresAt <= new Date() ||
      !memberId ||
      !gymId
    ) {
      throw new ValidationFailedError("This invite link is invalid or has expired.");
    }

    const passwordHash = await hashPassword(data.password);

    const claimed = await prisma.$transaction(async (tx) => {
      const gym = await tx.gym.findUnique({
        where: { id: gymId },
        select: { id: true, slug: true, deletedAt: true },
      });
      if (!gym || gym.deletedAt) {
        throw new ValidationFailedError("This gym is no longer active.");
      }

      const member = await tx.memberProfile.findFirst({
        where: { id: memberId, gymId: gym.id },
        select: { id: true, fullName: true, userId: true },
      });
      if (!member) {
        throw new ValidationFailedError("This invite link is no longer valid.");
      }
      if (member.userId) {
        throw new ConflictError("This member account has already been claimed.");
      }

      const existingUser = await tx.user.findUnique({
        where: { email: row.email },
        select: { id: true, passwordHash: true, emailVerifiedAt: true, isActive: true },
      });
      if (existingUser && !existingUser.isActive) {
        throw new ValidationFailedError("This account has been disabled.");
      }

      const user = existingUser
        ? await tx.user.update({
            where: { id: existingUser.id },
            data: {
              emailVerifiedAt: existingUser.emailVerifiedAt ?? new Date(),
              ...(existingUser.passwordHash ? {} : { passwordHash }),
            },
            select: { id: true },
          })
        : await tx.user.create({
            data: {
              email: row.email,
              name: member.fullName,
              passwordHash,
              emailVerifiedAt: new Date(),
            },
            select: { id: true },
          });

      await tx.memberProfile.update({
        where: { id: member.id },
        data: { userId: user.id },
      });

      await tx.gymMembership.upsert({
        where: { userId_gymId: { userId: user.id, gymId: gym.id } },
        create: {
          userId: user.id,
          gymId: gym.id,
          role: "MEMBER",
          isActive: true,
        },
        update: {
          isActive: true,
        },
      });

      await tx.verificationToken.update({
        where: { id: row.id },
        data: { consumedAt: new Date(), userId: user.id },
      });

      return { userId: user.id, gymId: gym.id, gymSlug: gym.slug, memberId: member.id };
    });

    const { token, expiresAt } = await createSession({
      userId: claimed.userId,
      activeGymId: claimed.gymId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await setSessionCookie(token, expiresAt);

    await writeAudit({
      gymId: claimed.gymId,
      actorUserId: claimed.userId,
      actorRole: "MEMBER",
      action: "member.invite_accept",
      entityType: "MemberProfile",
      entityId: claimed.memberId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { redirectTo: `/${claimed.gymSlug}/portal` };
  });
}
