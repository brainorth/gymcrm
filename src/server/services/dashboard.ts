import { addDays, gymLocalDate, toInputValue } from "@/lib/dates";
import { can, type TenantContext } from "@/server/auth/rbac";

export type ExpiringSubscriptionItem = {
  id: string;
  memberName: string;
  memberPhone: string;
  planName: string;
  effectiveEndDate: string;
  daysLeft: number;
};

export type DashboardSummary = {
  activeMembers: number;
  activeSubscriptions: number;
  checkInsToday: number;
  expiringSoon: ExpiringSubscriptionItem[];
  revenue: {
    todayMinor: number;
    monthMinor: number;
  } | null;
};

type ExpiringRow = {
  id: string;
  effectiveEndDate: Date;
  member: { fullName: string; phone: string };
  plan: { name: string };
};

export async function getDashboardSummary(ctx: TenantContext): Promise<DashboardSummary> {
  const now = new Date();
  const today = gymLocalDate(now, ctx.gym.timezone);
  const sevenDaysOut = addDays(today, 7);
  const canSeeAnalytics = ctx.role === "SUPER_ADMIN" || can(ctx.role, "analytics:read");

  // Start of today and start of current month (UTC-approximated; good for summary cards).
  const startOfToday = new Date(today.getTime());
  const startOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  const [activeMembers, activeSubscriptions, checkInsToday, expiringRows, todayAgg, monthAgg] =
    await Promise.all([
      ctx.db.memberProfile.count({ where: { status: "ACTIVE" } }),
      ctx.db.memberSubscription.count({
        where: { status: "ACTIVE", effectiveEndDate: { gte: today } },
      }),
      ctx.db.attendance.count({ where: { localDate: today } }),
      ctx.db.memberSubscription.findMany({
        where: {
          status: "ACTIVE",
          effectiveEndDate: { gte: today, lte: sevenDaysOut },
        },
        orderBy: { effectiveEndDate: "asc" },
        take: 10,
        select: {
          id: true,
          effectiveEndDate: true,
          member: { select: { fullName: true, phone: true } },
          plan: { select: { name: true } },
        },
      }),
      canSeeAnalytics
        ? ctx.db.payment.aggregate({
            where: { status: "SUCCEEDED", paymentDate: { gte: startOfToday } },
            _sum: { amountMinor: true, refundedMinor: true },
          })
        : Promise.resolve(null),
      canSeeAnalytics
        ? ctx.db.payment.aggregate({
            where: { status: "SUCCEEDED", paymentDate: { gte: startOfMonth } },
            _sum: { amountMinor: true, refundedMinor: true },
          })
        : Promise.resolve(null),
    ]);

  const expiringSoon: ExpiringSubscriptionItem[] = (expiringRows as unknown as ExpiringRow[]).map(
    (row) => {
      const daysLeft = Math.max(
        0,
        Math.round((row.effectiveEndDate.getTime() - today.getTime()) / 86_400_000),
      );
      return {
        id: row.id,
        memberName: row.member.fullName,
        memberPhone: row.member.phone,
        planName: row.plan.name,
        effectiveEndDate: toInputValue(row.effectiveEndDate),
        daysLeft,
      };
    },
  );

  const revenue = canSeeAnalytics
    ? {
        todayMinor: Math.max(
          0,
          (todayAgg?._sum.amountMinor ?? 0) - (todayAgg?._sum.refundedMinor ?? 0),
        ),
        monthMinor: Math.max(
          0,
          (monthAgg?._sum.amountMinor ?? 0) - (monthAgg?._sum.refundedMinor ?? 0),
        ),
      }
    : null;

  return {
    activeMembers,
    activeSubscriptions,
    checkInsToday,
    expiringSoon,
    revenue,
  };
}
