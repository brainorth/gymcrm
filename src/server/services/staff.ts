import { auditInContext } from "@/server/audit/log";
import type { TenantContext } from "@/server/auth/rbac";
import { newOpaqueToken, tokenFingerprint } from "@/server/auth/tokens";
import { prisma } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationFailedError } from "@/server/db/errors";
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
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, name: true, email: true },
  });

  if (existingUser) {
    const existingMembership = (await ctx.db.gymMembership.findFirst({
      where: { userId: existingUser.id },
      select: MEMBERSHIP_SELECT,
    })) as unknown as MembershipRow | null;

    if (existingMembership && existingMembership.role !== "MEMBER") {
      throw new ConflictError("This user is already a staff member at this gym.");
    }

    const membership = existingMembership
      ? ((await ctx.db.gymMembership.update({
          where: { id: existingMembership.id },
          data: {
            role: input.role,
            isActive: true,
            invitedBy: ctx.user.id,
          },
          select: MEMBERSHIP_SELECT,
        })) as unknown as MembershipRow)
      : ((await ctx.db.gymMembership.create({
          // tenantDb injects gymId at runtime
          data: {
            userId: existingUser.id,
            role: input.role,
            invitedBy: ctx.user.id,
          } as never,
          select: MEMBERSHIP_SELECT,
        })) as unknown as MembershipRow);

    const staff = toStaffDTO(membership, existingUser);
    await auditInContext({
      action: "staff.add",
      entityType: "GymMembership",
      entityId: membership.id,
      after: {
        userId: existingUser.id,
        email: existingUser.email,
        role: input.role,
        invited: false,
      },
    });
    return { staff, invited: false };
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

  const link = appUrl(`/reset-password?token=${rawToken}`);
  await sendEmail({
    to: created.user.email,
    subject: `You're invited to ${ctx.gym.name}`,
    text: `Hi ${created.user.name}, you have been invited to join ${ctx.gym.name} as ${input.role.replace("_", " ")}. Set your password to get started: ${link}`,
    html: `<p>Hi ${created.user.name},</p><p>You have been invited to join <strong>${ctx.gym.name}</strong> as <strong>${input.role.replace("_", " ")}</strong>.</p><p><a href="${link}">Accept invite and set your password</a></p>`,
  });

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
