import type { BillingStatus, GymStatus, SaasInterval, SaasSubscriptionStatus } from "@/generated/prisma/client";
import { auditInContext, writeAudit } from "@/server/audit/log";
import type { TenantContext } from "@/server/auth/rbac";
import { prisma } from "@/server/db/client";
import { NotFoundError } from "@/server/db/errors";

export type SaasPlanDTO = {
  id: string;
  code: string;
  name: string;
  interval: SaasInterval;
  priceMinor: number;
  currency: string;
  maxMembers: number | null;
  maxStaff: number | null;
  features: unknown;
  sortOrder: number;
};

export type GymSaasSubscriptionDTO = {
  id: string;
  planId: string;
  planCode: string;
  planName: string;
  status: SaasSubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
};

export type GymBillingOverviewDTO = {
  gym: {
    id: string;
    slug: string;
    name: string;
    status: GymStatus;
    billingStatus: BillingStatus;
    trialEndsAt: string | null;
  };
  subscription: GymSaasSubscriptionDTO | null;
  plans: SaasPlanDTO[];
};

export type AdminGymDTO = {
  id: string;
  name: string;
  slug: string;
  status: GymStatus;
  billingStatus: BillingStatus;
  currency: string;
  trialEndsAt: string | null;
  createdAt: string;
  owner: {
    id: string;
    name: string;
    email: string;
  };
  memberCount: number;
  activeSubscriptionCount: number;
  saasPlanName: string | null;
  saasSubscriptionStatus: SaasSubscriptionStatus | null;
};

export async function getGymBillingOverview(ctx: TenantContext): Promise<GymBillingOverviewDTO> {
  const [plans, sub] = await Promise.all([
    prisma.saasPlan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { priceMinor: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        interval: true,
        priceMinor: true,
        currency: true,
        maxMembers: true,
        maxStaff: true,
        features: true,
        sortOrder: true,
      },
    }),
    ctx.db.saasSubscription.findFirst({
      where: { gymId: ctx.gym.id },
      select: {
        id: true,
        planId: true,
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        trialEndsAt: true,
      },
    }),
  ]);

  let subscription: GymSaasSubscriptionDTO | null = null;
  if (sub) {
    const matchedPlan =
      plans.find((p) => p.id === sub.planId) ??
      (await prisma.saasPlan.findUnique({
        where: { id: sub.planId },
        select: { id: true, code: true, name: true },
      }));

    subscription = {
      id: sub.id,
      planId: sub.planId,
      planCode: matchedPlan?.code ?? "unknown",
      planName: matchedPlan?.name ?? "Custom Plan",
      status: sub.status,
      currentPeriodStart: sub.currentPeriodStart ? sub.currentPeriodStart.toISOString() : null,
      currentPeriodEnd: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
      trialEndsAt: sub.trialEndsAt ? sub.trialEndsAt.toISOString() : null,
    };
  }

  return {
    gym: {
      id: ctx.gym.id,
      slug: ctx.gym.slug,
      name: ctx.gym.name,
      status: ctx.gym.status,
      billingStatus: ctx.gym.billingStatus,
      trialEndsAt: ctx.gym.trialEndsAt ? ctx.gym.trialEndsAt.toISOString() : null,
    },
    subscription,
    plans,
  };
}

export async function selectSaasPlan(
  ctx: TenantContext,
  saasPlanId: string,
): Promise<{ subscriptionId: string; billingStatus: BillingStatus }> {
  const plan = await prisma.saasPlan.findUnique({
    where: { id: saasPlanId },
    select: {
      id: true,
      code: true,
      name: true,
      interval: true,
      priceMinor: true,
      isActive: true,
    },
  });

  if (!plan || !plan.isActive) {
    throw new NotFoundError("SaaS plan");
  }

  const now = new Date();
  const periodEnd = new Date(now);
  if (plan.interval === "YEAR") {
    periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
  } else {
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  }

  const nextStatus: BillingStatus = plan.priceMinor === 0 ? "TRIALING" : "ACTIVE";
  const nextSubStatus: SaasSubscriptionStatus = plan.priceMinor === 0 ? "TRIALING" : "ACTIVE";

  const existingSub = await ctx.db.saasSubscription.findFirst({
    where: { gymId: ctx.gym.id },
    select: { id: true, planId: true, status: true },
  });

  const subscription = await prisma.$transaction(async (tx) => {
    const upserted = await tx.saasSubscription.upsert({
      where: { gymId: ctx.gym.id },
      create: {
        gymId: ctx.gym.id,
        planId: plan.id,
        status: nextSubStatus,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        trialEndsAt: nextSubStatus === "TRIALING" ? periodEnd : null,
      },
      update: {
        planId: plan.id,
        status: nextSubStatus,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelledAt: null,
      },
      select: { id: true },
    });

    await tx.gym.update({
      where: { id: ctx.gym.id },
      data: { billingStatus: nextStatus },
    });

    return upserted;
  });

  await auditInContext({
    action: "saas.plan_select",
    entityType: "SaasSubscription",
    entityId: subscription.id,
    before: existingSub
      ? {
          planId: existingSub.planId,
          status: existingSub.status,
          billingStatus: ctx.gym.billingStatus,
        }
      : { billingStatus: ctx.gym.billingStatus },
    after: {
      planId: plan.id,
      planCode: plan.code,
      status: nextSubStatus,
      billingStatus: nextStatus,
    },
  });

  return {
    subscriptionId: subscription.id,
    billingStatus: nextStatus,
  };
}

export async function listAllGymsForAdmin(): Promise<AdminGymDTO[]> {
  const gyms = await prisma.gym.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      billingStatus: true,
      currency: true,
      trialEndsAt: true,
      createdAt: true,
      owner: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      saasSubscription: {
        select: {
          status: true,
          plan: {
            select: { name: true },
          },
        },
      },
      _count: {
        select: {
          memberProfiles: { where: { archivedAt: null } },
          subscriptions: { where: { status: "ACTIVE" } },
        },
      },
    },
  });

  return gyms.map((gym) => ({
    id: gym.id,
    name: gym.name,
    slug: gym.slug,
    status: gym.status,
    billingStatus: gym.billingStatus,
    currency: gym.currency,
    trialEndsAt: gym.trialEndsAt ? gym.trialEndsAt.toISOString() : null,
    createdAt: gym.createdAt.toISOString(),
    owner: gym.owner,
    memberCount: gym._count.memberProfiles,
    activeSubscriptionCount: gym._count.subscriptions,
    saasPlanName: gym.saasSubscription?.plan.name ?? null,
    saasSubscriptionStatus: gym.saasSubscription?.status ?? null,
  }));
}

export async function updateGymForAdmin(
  actorUserId: string,
  gymId: string,
  input: { status: GymStatus; billingStatus: BillingStatus },
): Promise<{ id: string; status: GymStatus; billingStatus: BillingStatus }> {
  const existing = await prisma.gym.findUnique({
    where: { id: gymId },
    select: { id: true, status: true, billingStatus: true },
  });

  if (!existing) {
    throw new NotFoundError("Gym");
  }

  const updated = await prisma.gym.update({
    where: { id: gymId },
    data: {
      status: input.status,
      billingStatus: input.billingStatus,
    },
    select: { id: true, status: true, billingStatus: true },
  });

  await writeAudit({
    gymId,
    actorUserId,
    actorRole: "SUPER_ADMIN",
    action: "admin.gym_update",
    entityType: "Gym",
    entityId: gymId,
    before: { status: existing.status, billingStatus: existing.billingStatus },
    after: { status: updated.status, billingStatus: updated.billingStatus },
  });

  return updated;
}
