import { Prisma, type MemberStatus } from "@/generated/prisma/client";
import { dateFromInput, toInputValue } from "@/lib/dates";
import { auditInContext } from "@/server/audit/log";
import type { TenantContext } from "@/server/auth/rbac";
import { NotFoundError, ValidationFailedError } from "@/server/db/errors";
import type { MemberParsedInput } from "@/server/members/schemas";

export type MemberDTO = {
  id: string;
  memberCode: string;
  fullName: string;
  phone: string;
  email: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  status: MemberStatus;
  notes: string | null;
  joinedAt: string;
  activeSubscriptionEndDate: string | null;
};

const MEMBER_SELECT = {
  id: true,
  memberCode: true,
  fullName: true,
  phone: true,
  email: true,
  dateOfBirth: true,
  gender: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  emergencyContactRelation: true,
  status: true,
  notes: true,
  joinedAt: true,
  subscriptions: {
    where: { status: "ACTIVE" as const },
    orderBy: { effectiveEndDate: "desc" as const },
    take: 1,
    select: { effectiveEndDate: true },
  },
} as const;

type MemberRow = {
  id: string;
  memberCode: string;
  fullName: string;
  phone: string;
  email: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  status: MemberStatus;
  notes: string | null;
  joinedAt: Date;
  subscriptions: Array<{ effectiveEndDate: Date }>;
};

function toDTO(row: MemberRow): MemberDTO {
  return {
    id: row.id,
    memberCode: row.memberCode,
    fullName: row.fullName,
    phone: row.phone,
    email: row.email,
    dateOfBirth: row.dateOfBirth ? toInputValue(row.dateOfBirth) : null,
    gender: row.gender,
    emergencyContactName: row.emergencyContactName,
    emergencyContactPhone: row.emergencyContactPhone,
    emergencyContactRelation: row.emergencyContactRelation,
    status: row.status,
    notes: row.notes,
    joinedAt: row.joinedAt.toISOString(),
    activeSubscriptionEndDate: row.subscriptions[0]
      ? toInputValue(row.subscriptions[0].effectiveEndDate)
      : null,
  };
}

async function nextMemberCode(ctx: TenantContext): Promise<string> {
  const prefix =
    ctx.gym.slug
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 4)
      .toUpperCase() || "GYM";
  const count = await ctx.db.memberProfile.count();
  return `${prefix}-${String(count + 1).padStart(5, "0")}`;
}

export async function listMembers(
  ctx: TenantContext,
  opts?: { search?: string; status?: MemberStatus | "ALL" },
): Promise<MemberDTO[]> {
  const q = opts?.search?.trim();
  const statusFilter = opts?.status && opts.status !== "ALL" ? opts.status : undefined;

  const rows = await ctx.db.memberProfile.findMany({
    where: {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(q
        ? {
            OR: [
              { fullName: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              { memberCode: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ joinedAt: "desc" }],
    take: 200,
    select: MEMBER_SELECT,
  });

  return (rows as unknown as MemberRow[]).map(toDTO);
}

export async function createMember(
  ctx: TenantContext,
  input: MemberParsedInput,
): Promise<MemberDTO> {
  const baseCode = await nextMemberCode(ctx);

  for (let attempt = 0; attempt < 3; attempt++) {
    const memberCode =
      attempt === 0 ? baseCode : `${baseCode}-${Math.floor(100 + Math.random() * 900)}`;
    try {
      const created = (await ctx.db.memberProfile.create({
        // tenantDb injects gymId at runtime
        data: {
          memberCode,
          fullName: input.fullName,
          phone: input.phone,
          email: input.email ?? null,
          dateOfBirth: input.dateOfBirth ? dateFromInput(input.dateOfBirth) : null,
          gender: input.gender ?? null,
          emergencyContactName: input.emergencyContactName ?? null,
          emergencyContactPhone: input.emergencyContactPhone ?? null,
          emergencyContactRelation: input.emergencyContactRelation ?? null,
          notes: input.notes ?? null,
        } as never,
        select: MEMBER_SELECT,
      })) as unknown as MemberRow;

      const dto = toDTO(created);
      await auditInContext({
        action: "member.create",
        entityType: "MemberProfile",
        entityId: dto.id,
        after: dto,
      });
      return dto;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Retry if memberCode collided; otherwise surface field error.
        const target = String((error.meta as { target?: unknown } | undefined)?.target ?? "");
        if (target.includes("memberCode")) continue;
        throw new ValidationFailedError("A member with these details already exists.");
      }
      throw error;
    }
  }

  throw new ValidationFailedError("Could not generate a unique member ID. Please try again.");
}

export async function updateMember(
  ctx: TenantContext,
  memberId: string,
  input: MemberParsedInput,
): Promise<MemberDTO> {
  const existing = (await ctx.db.memberProfile.findFirst({
    where: { id: memberId },
    select: MEMBER_SELECT,
  })) as unknown as MemberRow | null;
  if (!existing) throw new NotFoundError("Member");

  const updated = (await ctx.db.memberProfile.update({
    where: { id: memberId },
    data: {
      fullName: input.fullName,
      phone: input.phone,
      email: input.email ?? null,
      dateOfBirth: input.dateOfBirth ? dateFromInput(input.dateOfBirth) : null,
      gender: input.gender ?? null,
      emergencyContactName: input.emergencyContactName ?? null,
      emergencyContactPhone: input.emergencyContactPhone ?? null,
      emergencyContactRelation: input.emergencyContactRelation ?? null,
      notes: input.notes ?? null,
    },
    select: MEMBER_SELECT,
  })) as unknown as MemberRow;

  const dto = toDTO(updated);
  await auditInContext({
    action: "member.update",
    entityType: "MemberProfile",
    entityId: dto.id,
    before: toDTO(existing),
    after: dto,
  });
  return dto;
}

export async function setMemberStatus(
  ctx: TenantContext,
  memberId: string,
  status: MemberStatus,
): Promise<MemberDTO> {
  const existing = (await ctx.db.memberProfile.findFirst({
    where: { id: memberId },
    select: MEMBER_SELECT,
  })) as unknown as MemberRow | null;
  if (!existing) throw new NotFoundError("Member");

  const updated = (await ctx.db.memberProfile.update({
    where: { id: memberId },
    data: {
      status,
      archivedAt: status === "ARCHIVED" ? new Date() : null,
    },
    select: MEMBER_SELECT,
  })) as unknown as MemberRow;

  const dto = toDTO(updated);
  await auditInContext({
    action: `member.status.${status.toLowerCase()}`,
    entityType: "MemberProfile",
    entityId: dto.id,
    before: { status: existing.status },
    after: { status: dto.status },
  });
  return dto;
}
