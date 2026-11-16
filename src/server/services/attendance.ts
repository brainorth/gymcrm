import { Prisma, type AttendanceSource } from "@/generated/prisma/client";
import { dateFromInput, gymLocalDate, localDateString } from "@/lib/dates";
import { auditInContext } from "@/server/audit/log";
import type { TenantContext } from "@/server/auth/rbac";
import { NotFoundError, ValidationFailedError } from "@/server/db/errors";

export type AttendanceDTO = {
  id: string;
  memberId: string;
  memberName: string;
  memberCode: string;
  memberPhone: string;
  subscriptionId: string | null;
  planName: string | null;
  checkInTime: string;
  checkOutTime: string | null;
  localDate: string;
  source: AttendanceSource;
};

type AttendanceRow = {
  id: string;
  memberId: string;
  subscriptionId: string | null;
  checkInTime: Date;
  checkOutTime: Date | null;
  localDate: Date;
  source: AttendanceSource;
  member: { fullName: string; memberCode: string; phone: string };
  subscription: { plan: { name: string } } | null;
};

const ATTENDANCE_SELECT = {
  id: true,
  memberId: true,
  subscriptionId: true,
  checkInTime: true,
  checkOutTime: true,
  localDate: true,
  source: true,
  member: { select: { fullName: true, memberCode: true, phone: true } },
  subscription: { select: { plan: { select: { name: true } } } },
} as const;

function toDTO(row: AttendanceRow): AttendanceDTO {
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: row.member.fullName,
    memberCode: row.member.memberCode,
    memberPhone: row.member.phone,
    subscriptionId: row.subscriptionId,
    planName: row.subscription?.plan.name ?? null,
    checkInTime: row.checkInTime.toISOString(),
    checkOutTime: row.checkOutTime ? row.checkOutTime.toISOString() : null,
    localDate: row.localDate.toISOString().slice(0, 10),
    source: row.source,
  };
}

export async function listAttendanceByDate(
  ctx: TenantContext,
  dateIso?: string,
): Promise<AttendanceDTO[]> {
  const targetDate = dateIso
    ? dateFromInput(dateIso)
    : gymLocalDate(new Date(), ctx.gym.timezone);

  const rows = await ctx.db.attendance.findMany({
    where: { localDate: targetDate },
    orderBy: { checkInTime: "desc" },
    take: 500,
    select: ATTENDANCE_SELECT,
  });

  return (rows as unknown as AttendanceRow[]).map(toDTO);
}

export async function checkInMember(
  ctx: TenantContext,
  memberId: string,
  source: AttendanceSource = "MANUAL",
): Promise<AttendanceDTO> {
  const now = new Date();
  const today = gymLocalDate(now, ctx.gym.timezone);

  const member = await ctx.db.memberProfile.findFirst({
    where: { id: memberId },
    select: { id: true, status: true },
  });
  if (!member) throw new NotFoundError("Member");
  if (member.status === "ARCHIVED") {
    throw new ValidationFailedError("Archived members cannot check in.");
  }

  // Link to active, non-expired, non-frozen subscription if one exists.
  const activeSub = await ctx.db.memberSubscription.findFirst({
    where: {
      memberId: member.id,
      status: "ACTIVE",
      effectiveEndDate: { gte: today },
      freezes: { none: { endDate: null } },
    },
    orderBy: { effectiveEndDate: "desc" },
    select: { id: true },
  });

  if (!activeSub) {
    const frozenSub = await ctx.db.memberSubscription.findFirst({
      where: {
        memberId: member.id,
        status: "ACTIVE",
        effectiveEndDate: { gte: today },
        freezes: { some: { endDate: null } },
      },
      select: { id: true },
    });
    if (frozenSub) {
      throw new ValidationFailedError(
        "This membership is currently frozen. Resume it before checking in.",
      );
    }
  }

  try {
    const created = (await ctx.db.attendance.create({
      // tenantDb injects gymId at runtime
      data: {
        memberId: member.id,
        subscriptionId: activeSub?.id ?? null,
        checkInTime: now,
        localDate: today,
        source,
        verifiedByUserId: ctx.user.id,
      } as never,
      select: ATTENDANCE_SELECT,
    })) as unknown as AttendanceRow;

    const dto = toDTO(created);
    await auditInContext({
      action: "attendance.checkin",
      entityType: "Attendance",
      entityId: dto.id,
      after: { memberId: dto.memberId, localDate: dto.localDate, source: dto.source },
    });
    return dto;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ValidationFailedError(
        `Already checked in today (${localDateString(now, ctx.gym.timezone)}).`,
      );
    }
    throw error;
  }
}

export async function checkOutAttendance(
  ctx: TenantContext,
  attendanceId: string,
): Promise<AttendanceDTO> {
  const existing = await ctx.db.attendance.findFirst({
    where: { id: attendanceId },
    select: { id: true, checkOutTime: true },
  });
  if (!existing) throw new NotFoundError("Attendance record");
  if (existing.checkOutTime) {
    throw new ValidationFailedError("Member has already checked out.");
  }

  const updated = (await ctx.db.attendance.update({
    where: { id: attendanceId },
    data: { checkOutTime: new Date() },
    select: ATTENDANCE_SELECT,
  })) as unknown as AttendanceRow;

  const dto = toDTO(updated);
  await auditInContext({
    action: "attendance.checkout",
    entityType: "Attendance",
    entityId: dto.id,
    after: { checkOutTime: dto.checkOutTime },
  });
  return dto;
}
