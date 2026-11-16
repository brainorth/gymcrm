import type { PaymentMethod, SubscriptionStatus } from "@/generated/prisma/client";
import { addDays, daysBetween, gymLocalDate, toInputValue } from "@/lib/dates";
import { toMinorUnits } from "@/lib/money";
import { auditInContext } from "@/server/audit/log";
import type { TenantContext } from "@/server/auth/rbac";
import { NotFoundError, ValidationFailedError } from "@/server/db/errors";
import type {
  AssignSubscriptionParsed,
  RecordPaymentParsed,
} from "@/server/subscriptions/schemas";

export type SubscriptionDTO = {
  id: string;
  memberId: string;
  memberName: string;
  memberCode: string;
  memberPhone: string;
  planId: string;
  planName: string;
  maxFreezeDays: number;
  startDate: string;
  endDate: string;
  effectiveEndDate: string;
  status: SubscriptionStatus;
  priceMinor: number;
  paidMinor: number;
  currency: string;
  freezeDaysUsed: number;
  isFrozen: boolean;
  frozenSince: string | null;
  notes: string | null;
};

type SubRow = {
  id: string;
  memberId: string;
  planId: string;
  startDate: Date;
  endDate: Date;
  effectiveEndDate: Date;
  status: SubscriptionStatus;
  priceMinor: number;
  currency: string;
  freezeDaysUsed: number;
  notes: string | null;
  member: { fullName: string; memberCode: string; phone: string };
  plan: { name: string; maxFreezeDays: number };
  freezes: Array<{ startDate: Date }>;
  payments: Array<{ amountMinor: number; refundedMinor: number; status: string }>;
};

const SUB_SELECT = {
  id: true,
  memberId: true,
  planId: true,
  startDate: true,
  endDate: true,
  effectiveEndDate: true,
  status: true,
  priceMinor: true,
  currency: true,
  freezeDaysUsed: true,
  notes: true,
  member: { select: { fullName: true, memberCode: true, phone: true } },
  plan: { select: { name: true, maxFreezeDays: true } },
  freezes: {
    where: { endDate: null },
    take: 1,
    select: { startDate: true },
  },
  payments: {
    where: { status: "SUCCEEDED" as const },
    select: { amountMinor: true, refundedMinor: true, status: true },
  },
} as const;

function toDTO(row: SubRow): SubscriptionDTO {
  const paidMinor = row.payments.reduce(
    (sum, p) => sum + Math.max(0, p.amountMinor - p.refundedMinor),
    0,
  );
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: row.member.fullName,
    memberCode: row.member.memberCode,
    memberPhone: row.member.phone,
    planId: row.planId,
    planName: row.plan.name,
    maxFreezeDays: row.plan.maxFreezeDays,
    startDate: toInputValue(row.startDate),
    endDate: toInputValue(row.endDate),
    effectiveEndDate: toInputValue(row.effectiveEndDate),
    status: row.status,
    priceMinor: row.priceMinor,
    paidMinor,
    currency: row.currency,
    freezeDaysUsed: row.freezeDaysUsed,
    isFrozen: row.freezes.length > 0,
    frozenSince: row.freezes[0] ? toInputValue(row.freezes[0].startDate) : null,
    notes: row.notes,
  };
}

export async function listSubscriptions(ctx: TenantContext): Promise<SubscriptionDTO[]> {
  const rows = await ctx.db.memberSubscription.findMany({
    orderBy: [{ status: "asc" }, { effectiveEndDate: "asc" }, { createdAt: "desc" }],
    take: 200,
    select: SUB_SELECT,
  });
  return (rows as unknown as SubRow[]).map(toDTO);
}

export async function assignSubscription(
  ctx: TenantContext,
  input: AssignSubscriptionParsed,
): Promise<SubscriptionDTO> {
  const created = await ctx.db.$transaction(async (tx) => {
    const member = await tx.memberProfile.findFirst({
      where: { id: input.memberId },
      select: { id: true, status: true },
    });
    if (!member) throw new NotFoundError("Member");
    if (member.status === "ARCHIVED") {
      throw new ValidationFailedError("Cannot assign a plan to an archived member.", {
        memberId: ["Restore this member before assigning a plan."],
      });
    }

    const plan = await tx.plan.findFirst({
      where: { id: input.planId, deletedAt: null },
      select: {
        id: true,
        name: true,
        durationInDays: true,
        priceMinor: true,
        joiningFeeMinor: true,
        currency: true,
        isActive: true,
      },
    });
    if (!plan) throw new NotFoundError("Plan");
    if (!plan.isActive) {
      throw new ValidationFailedError("This plan is paused.", {
        planId: ["Select an active plan."],
      });
    }

    const startDate = input.startDate
      ? new Date(`${input.startDate}T00:00:00.000Z`)
      : gymLocalDate(new Date(), ctx.gym.timezone);
    const endDate = addDays(startDate, plan.durationInDays);
    const totalMinor = plan.priceMinor + plan.joiningFeeMinor;

    const sub = await tx.memberSubscription.create({
      data: {
        memberId: member.id,
        planId: plan.id,
        startDate,
        endDate,
        effectiveEndDate: endDate,
        status: "ACTIVE",
        priceMinor: totalMinor,
        currency: plan.currency,
        notes: input.notes ?? null,
        createdById: ctx.user.id,
      } as never,
      select: { id: true },
    });

    if (input.paymentMethod !== "NONE") {
      const paidMinor =
        input.paidMajor !== undefined ? toMinorUnits(input.paidMajor) : totalMinor;
      if (paidMinor > 0) {
        await tx.payment.create({
          data: {
            memberId: member.id,
            subscriptionId: sub.id,
            amountMinor: paidMinor,
            currency: plan.currency,
            method: input.paymentMethod as PaymentMethod,
            status: "SUCCEEDED",
            provider: "MANUAL",
            recordedById: ctx.user.id,
            notes: `Initial payment for ${plan.name}`,
          } as never,
        });
      }
    }

    const full = await tx.memberSubscription.findUniqueOrThrow({
      where: { id: sub.id },
      select: SUB_SELECT,
    });
    return full as unknown as SubRow;
  });

  const dto = toDTO(created);
  await auditInContext({
    action: "subscription.create",
    entityType: "MemberSubscription",
    entityId: dto.id,
    after: dto,
  });
  return dto;
}

export async function freezeSubscription(
  ctx: TenantContext,
  subscriptionId: string,
  reason?: string,
): Promise<SubscriptionDTO> {
  const today = gymLocalDate(new Date(), ctx.gym.timezone);

  const updated = await ctx.db.$transaction(async (tx) => {
    const sub = await tx.memberSubscription.findFirst({
      where: { id: subscriptionId },
      select: {
        id: true,
        status: true,
        effectiveEndDate: true,
        freezeDaysUsed: true,
        plan: { select: { maxFreezeDays: true } },
        freezes: { where: { endDate: null }, select: { id: true } },
      },
    });
    if (!sub) throw new NotFoundError("Subscription");
    if (sub.status !== "ACTIVE") {
      throw new ValidationFailedError("Only active subscriptions can be frozen.");
    }
    if (sub.effectiveEndDate < today) {
      throw new ValidationFailedError("Expired subscriptions cannot be frozen.");
    }
    if (sub.plan.maxFreezeDays <= 0) {
      throw new ValidationFailedError("This plan does not allow freezing.");
    }
    if (sub.freezes.length > 0) {
      throw new ValidationFailedError("This subscription is already frozen.");
    }
    if (sub.freezeDaysUsed >= sub.plan.maxFreezeDays) {
      throw new ValidationFailedError("Maximum freeze days already used for this subscription.");
    }

    await tx.subscriptionFreeze.create({
      data: {
        subscriptionId: sub.id,
        startDate: today,
        reason: reason ?? null,
        createdById: ctx.user.id,
      } as never,
    });

    const full = await tx.memberSubscription.findUniqueOrThrow({
      where: { id: sub.id },
      select: SUB_SELECT,
    });
    return full as unknown as SubRow;
  });

  const dto = toDTO(updated);
  await auditInContext({
    action: "subscription.freeze",
    entityType: "MemberSubscription",
    entityId: dto.id,
    after: { frozenSince: dto.frozenSince, reason },
  });
  return dto;
}

export async function resumeSubscription(
  ctx: TenantContext,
  subscriptionId: string,
): Promise<SubscriptionDTO> {
  const today = gymLocalDate(new Date(), ctx.gym.timezone);

  const updated = await ctx.db.$transaction(async (tx) => {
    const sub = await tx.memberSubscription.findFirst({
      where: { id: subscriptionId },
      select: {
        id: true,
        status: true,
        effectiveEndDate: true,
        freezeDaysUsed: true,
        plan: { select: { maxFreezeDays: true } },
        freezes: { where: { endDate: null }, take: 1, select: { id: true, startDate: true } },
      },
    });
    if (!sub) throw new NotFoundError("Subscription");
    if (sub.status !== "ACTIVE") {
      throw new ValidationFailedError("Only active subscriptions can be resumed.");
    }
    const openFreeze = sub.freezes[0];
    if (!openFreeze) {
      throw new ValidationFailedError("This subscription is not currently frozen.");
    }

    const elapsed = Math.max(0, daysBetween(openFreeze.startDate, today));
    const remainingAllowance = Math.max(0, sub.plan.maxFreezeDays - sub.freezeDaysUsed);
    const creditedDays = Math.min(elapsed, remainingAllowance);

    await tx.subscriptionFreeze.update({
      where: { id: openFreeze.id },
      data: {
        endDate: today,
        days: creditedDays,
        resumedById: ctx.user.id,
      },
    });

    if (creditedDays > 0) {
      await tx.memberSubscription.update({
        where: { id: sub.id },
        data: {
          freezeDaysUsed: { increment: creditedDays },
          effectiveEndDate: addDays(sub.effectiveEndDate, creditedDays),
        },
      });
    }

    const full = await tx.memberSubscription.findUniqueOrThrow({
      where: { id: sub.id },
      select: SUB_SELECT,
    });
    return full as unknown as SubRow;
  });

  const dto = toDTO(updated);
  await auditInContext({
    action: "subscription.resume",
    entityType: "MemberSubscription",
    entityId: dto.id,
    after: { effectiveEndDate: dto.effectiveEndDate, freezeDaysUsed: dto.freezeDaysUsed },
  });
  return dto;
}

export async function cancelSubscription(
  ctx: TenantContext,
  subscriptionId: string,
  reason?: string,
): Promise<SubscriptionDTO> {
  const existing = await ctx.db.memberSubscription.findFirst({
    where: { id: subscriptionId },
    select: { id: true, status: true },
  });
  if (!existing) throw new NotFoundError("Subscription");

  const updated = (await ctx.db.memberSubscription.update({
    where: { id: subscriptionId },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelReason: reason ?? null,
    },
    select: SUB_SELECT,
  })) as unknown as SubRow;

  const dto = toDTO(updated);
  await auditInContext({
    action: "subscription.cancel",
    entityType: "MemberSubscription",
    entityId: dto.id,
    before: { status: existing.status },
    after: { status: dto.status, reason },
  });
  return dto;
}

export async function recordManualPayment(
  ctx: TenantContext,
  input: RecordPaymentParsed,
): Promise<SubscriptionDTO | null> {
  const amountMinor = toMinorUnits(input.amountMajor);

  const member = await ctx.db.memberProfile.findFirst({
    where: { id: input.memberId },
    select: { id: true },
  });
  if (!member) throw new NotFoundError("Member");

  if (input.subscriptionId) {
    const subscription = await ctx.db.memberSubscription.findFirst({
      where: { id: input.subscriptionId, memberId: member.id },
      select: { id: true },
    });
    if (!subscription) throw new NotFoundError("Subscription");
  }

  const payment = await ctx.db.payment.create({
    data: {
      memberId: member.id,
      subscriptionId: input.subscriptionId ?? null,
      amountMinor,
      currency: ctx.gym.currency,
      method: input.method as PaymentMethod,
      status: "SUCCEEDED",
      provider: "MANUAL",
      recordedById: ctx.user.id,
      notes: input.notes ?? null,
    } as never,
    select: { id: true, amountMinor: true, method: true, subscriptionId: true },
  });

  await auditInContext({
    action: "payment.record",
    entityType: "Payment",
    entityId: payment.id,
    after: payment,
  });

  if (!input.subscriptionId) return null;
  const sub = await ctx.db.memberSubscription.findFirst({
    where: { id: input.subscriptionId },
    select: SUB_SELECT,
  });
  return sub ? toDTO(sub as unknown as SubRow) : null;
}
