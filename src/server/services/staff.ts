import { auditInContext } from "@/server/audit/log";
import type { TenantContext } from "@/server/auth/rbac";
import { newOpaqueToken, tokenFingerprint } from "@/server/auth/tokens";
import { prisma } from "@/server/db/client";
import { ForbiddenError, NotFoundError, ValidationFailedError } from "@/server/db/errors";
import { appUrl, sendEmail } from "@/server/notifications/mailer";
import type {
  GymSettingsParsedInput,
  InviteStaffParsedInput,
  StaffRole,
} from "@/server/staff/schemas";

export type StaffDTO = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: StaffRole;
  isActive: boolean;
  joinedAt: string;
};

export type GymSettingsDTO = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
};

const INVITE_TTL_MS = 7 * 86_400_000;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function getGymOwnerId(gymId: string): Promise<string> {
  const gym = await prisma.gym.findUnique({
    where: { id: gymId },
    select: { ownerId: true },
  });
  if (!gym) throw new NotFoundError("Gym");
  return gym.ownerId;
}

async function sendStaffInviteEmail(
  user: { name: string; email: string },
  gymName: string,
  role: StaffRole,
  rawToken: string,
): Promise<void> {
  const inviteUrl = appUrl(`/reset-password?token=${rawToken}`);
  const roleLabel = role.replace("_", " ");
  await sendEmail({
    to: user.email,
    subject: `You're invited to ${gymName}`,
    text: `Hi ${user.name}, you have been invited to join ${gymName} as ${roleLabel}. Set your password to get started: ${inviteUrl}`,
    html: `<p>Hi ${escapeHtml(user.name)},</p><p>You have been invited to join <strong>${escapeHtml(gymName)}</strong> as <strong>${escapeHtml(roleLabel)}</strong>.</p><p><a href="${escapeHtml(inviteUrl)}">Accept invite and set your password</a></p>`,
  });
}

const MEMBERSHIP_SELECT = {
  id: true,
  userId: true,
  role: true,
  isActive: true,
  joinedAt: true,
} as const;

type MembershipRow = {
  id: string;
  userId: string;
  role: string;
  isActive: boolean;
  joinedAt: Date;
};

function toStaffDTO(
  membership: MembershipRow,
  user: { id: string; name: string; email: string },
): StaffDTO {
  return {
    membershipId: membership.id,
    userId: membership.userId,
    name: user.name,
    email: user.email,
    role: membership.role as StaffRole,
    isActive: membership.isActive,
    joinedAt: membership.joinedAt.toISOString(),
  };
}

export async function listStaff(ctx: TenantContext): Promise<StaffDTO[]> {
  const memberships = (await ctx.db.gymMembership.findMany({
    where: { role: { not: "MEMBER" } },
    orderBy: [{ joinedAt: "asc" }],
    select: MEMBERSHIP_SELECT,
  })) as unknown as MembershipRow[];

  if (memberships.length === 0) return [];

  const userIds = Array.from(new Set(memberships.map((m) => m.userId)));
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const out: StaffDTO[] = [];
  for (const membership of memberships) {
    const user = userById.get(membership.userId);
    if (!user) continue;
    out.push(toStaffDTO(membership, user));
  }
  return out;
}

export async function addOrInviteStaff(
  ctx: TenantContext,
  input: InviteStaffParsedInput,
): Promise<{ staff: StaffDTO; invited: boolean }> {
  const ownerId = await getGymOwnerId(ctx.gym.id);
  if (input.role === "GYM_OWNER" && ctx.user.id !== ownerId && ctx.role !== "SUPER_ADMIN") {
    throw new ForbiddenError("Only the primary gym owner can assign the owner role.");
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, name: true, email: true },
  });

  if (existingUser) {
    const existingMembership = (await ctx.db.gymMembership.findFirst({
      where: { userId: existingUser.id },
      select: MEMBERSHIP_SELECT,
    })) as unknown as MembershipRow | null;

    if (existingMembership && existingMembership.role !== "MEMBER" && existingMembership.isActive) {
      throw new ValidationFailedError("This user is already on your staff.");
    }

    const rawToken = newOpaqueToken();
    const membership = await prisma.$transaction(async (tx) => {
      const m = existingMembership
        ? await tx.gymMembership.update({
            where: { id: existingMembership.id },
            data: {
              role: input.role,
              isActive: false,
              invitedBy: ctx.user.id,
            },
            select: MEMBERSHIP_SELECT,
          })
        : await tx.gymMembership.create({
            data: {
              userId: existingUser.id,
              gymId: ctx.gym.id,
              role: input.role,
              isActive: false,
              invitedBy: ctx.user.id,
            },
            select: MEMBERSHIP_SELECT,
          });

      await tx.verificationToken.create({
        data: {
          purpose: "STAFF_INVITE",
          tokenHash: tokenFingerprint(rawToken),
          email: existingUser.email,
          userId: existingUser.id,
          gymId: ctx.gym.id,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      });

      return m as unknown as MembershipRow;
    });

    await sendStaffInviteEmail(existingUser, ctx.gym.name, input.role, rawToken);

    const staff = toStaffDTO(membership, existingUser);
    await auditInContext({
      action: "staff.add",
      entityType: "GymMembership",
      entityId: membership.id,
      after: {
        userId: existingUser.id,
        email: existingUser.email,
        role: input.role,
        invited: true,
      },
    });
    return { staff, invited: true };
  }

  const rawToken = newOpaqueToken();
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: null,
      },
      select: { id: true, name: true, email: true },
    });

    const membership = await tx.gymMembership.create({
      data: {
        userId: user.id,
        gymId: ctx.gym.id,
        role: input.role,
        invitedBy: ctx.user.id,
      },
      select: MEMBERSHIP_SELECT,
    });

    await tx.verificationToken.create({
      data: {
        purpose: "STAFF_INVITE",
        tokenHash: tokenFingerprint(rawToken),
        email: user.email,
        userId: user.id,
        gymId: ctx.gym.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    return { user, membership };
  });

  await sendStaffInviteEmail(created.user, ctx.gym.name, input.role, rawToken);

  const staff = toStaffDTO(created.membership, created.user);
  await auditInContext({
    action: "staff.add",
    entityType: "GymMembership",
    entityId: created.membership.id,
    after: {
      userId: created.user.id,
      email: created.user.email,
      role: input.role,
      invited: true,
    },
  });

  return { staff, invited: true };
}

export async function updateStaffRole(
  ctx: TenantContext,
  membershipId: string,
  role: StaffRole,
): Promise<StaffDTO> {
  const existing = (await ctx.db.gymMembership.findFirst({
    where: { id: membershipId, role: { not: "MEMBER" } },
    select: MEMBERSHIP_SELECT,
  })) as unknown as MembershipRow | null;
  if (!existing) throw new NotFoundError("Staff member");

  const ownerId = await getGymOwnerId(ctx.gym.id);
  if (existing.userId === ownerId && ctx.user.id !== ownerId) {
    throw new ForbiddenError("Only the primary gym owner can change their own role.");
  }

  if (existing.userId === ctx.user.id && existing.role === "GYM_OWNER" && role !== "GYM_OWNER") {
    const ownerCount = await ctx.db.gymMembership.count({
      where: { role: "GYM_OWNER", isActive: true },
    });
    if (ownerCount <= 1) {
      throw new ValidationFailedError(
        "You are the only owner of this gym. Assign another owner before changing your role.",
      );
    }
  }

  const updated = (await ctx.db.gymMembership.update({
    where: { id: membershipId },
    data: { role },
    select: MEMBERSHIP_SELECT,
  })) as unknown as MembershipRow;

  const user = await prisma.user.findUnique({
    where: { id: updated.userId },
    select: { id: true, name: true, email: true },
  });
  if (!user) throw new NotFoundError("User");

  await auditInContext({
    action: "staff.role_change",
    entityType: "GymMembership",
    entityId: membershipId,
    before: { role: existing.role },
    after: { role: updated.role },
  });

  return toStaffDTO(updated, user);
}

export async function removeStaff(
  ctx: TenantContext,
  membershipId: string,
): Promise<{ membershipId: string }> {
  const existing = (await ctx.db.gymMembership.findFirst({
    where: { id: membershipId, role: { not: "MEMBER" } },
    select: MEMBERSHIP_SELECT,
  })) as unknown as MembershipRow | null;
  if (!existing) throw new NotFoundError("Staff member");

  const ownerId = await getGymOwnerId(ctx.gym.id);
  if (existing.userId === ownerId && ctx.user.id !== ownerId) {
    throw new ForbiddenError("The primary gym owner cannot be removed.");
  }

  if (existing.userId === ctx.user.id) {
    throw new ValidationFailedError("You cannot remove your own staff access.");
  }

  await ctx.db.gymMembership.delete({
    where: { id: membershipId },
  });

  await auditInContext({
    action: "staff.remove",
    entityType: "GymMembership",
    entityId: membershipId,
    before: { userId: existing.userId, role: existing.role },
  });

  return { membershipId };
}

export async function updateGymSettings(
  ctx: TenantContext,
  input: GymSettingsParsedInput,
): Promise<GymSettingsDTO> {
  const updated = (await ctx.db.gym.update({
    where: { id: ctx.gym.id },
    data: {
      name: input.name,
      timezone: input.timezone,
      currency: input.currency,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      currency: true,
    },
  })) as unknown as GymSettingsDTO;

  await auditInContext({
    action: "gym.settings_update",
    entityType: "Gym",
    entityId: ctx.gym.id,
    before: {
      name: ctx.gym.name,
      timezone: ctx.gym.timezone,
      currency: ctx.gym.currency,
    },
    after: {
      name: updated.name,
      timezone: updated.timezone,
      currency: updated.currency,
    },
  });

  return updated;
}
