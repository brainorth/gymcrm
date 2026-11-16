import { Prisma } from "@/generated/prisma/client";
import { toMinorUnits } from "@/lib/money";
import { auditInContext } from "@/server/audit/log";
import type { TenantContext } from "@/server/auth/rbac";
import { NotFoundError, ValidationFailedError } from "@/server/db/errors";
import type { PlanParsedInput } from "@/server/plans/schemas";

export type PlanDTO = {
  id: string;
  name: string;
  description: string | null;
  durationInDays: number;
  priceMinor: number;
  currency: string;
  joiningFeeMinor: number;
  maxFreezeDays: number;
  graceDays: number;
  isActive: boolean;
  sortOrder: number;
};

const PLAN_SELECT = {
  id: true,
  name: true,
  description: true,
  durationInDays: true,
  priceMinor: true,
  currency: true,
  joiningFeeMinor: true,
  maxFreezeDays: true,
  graceDays: true,
  isActive: true,
  sortOrder: true,
} as const;

export async function listPlans(ctx: TenantContext): Promise<PlanDTO[]> {
  return ctx.db.plan.findMany({
    where: { deletedAt: null },
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { priceMinor: "asc" }],
    select: PLAN_SELECT,
  });
}

export async function createPlan(ctx: TenantContext, input: PlanParsedInput): Promise<PlanDTO> {
  const priceMinor = toMinorUnits(input.priceMajor);
  const joiningFeeMinor = toMinorUnits(input.joiningFeeMajor);

  try {
    const plan = await ctx.db.plan.create({
      // tenantDb injects gymId at runtime
      data: {
        name: input.name,
        description: input.description ?? null,
        durationInDays: input.durationInDays,
        priceMinor,
        currency: ctx.gym.currency,
        joiningFeeMinor,
        maxFreezeDays: input.maxFreezeDays,
        graceDays: input.graceDays,
      } as never,
      select: PLAN_SELECT,
    });

    await auditInContext({
      action: "plan.create",
      entityType: "Plan",
      entityId: plan.id,
      after: plan,
    });

    return plan;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ValidationFailedError("A plan with this name already exists.", {
        name: ["A plan with this name already exists."],
      });
    }
    throw error;
  }
}

export async function updatePlan(
  ctx: TenantContext,
  planId: string,
  input: PlanParsedInput,
): Promise<PlanDTO> {
  const existing = await ctx.db.plan.findFirst({
    where: { id: planId, deletedAt: null },
    select: PLAN_SELECT,
  });
  if (!existing) throw new NotFoundError("Plan");

  try {
    const updated = await ctx.db.plan.update({
      where: { id: planId },
      data: {
        name: input.name,
        description: input.description ?? null,
        durationInDays: input.durationInDays,
        priceMinor: toMinorUnits(input.priceMajor),
        joiningFeeMinor: toMinorUnits(input.joiningFeeMajor),
        maxFreezeDays: input.maxFreezeDays,
        graceDays: input.graceDays,
      },
      select: PLAN_SELECT,
    });

    await auditInContext({
      action: "plan.update",
      entityType: "Plan",
      entityId: updated.id,
      before: existing,
      after: updated,
    });

    return updated;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ValidationFailedError("A plan with this name already exists.", {
        name: ["A plan with this name already exists."],
      });
    }
    throw error;
  }
}

export async function setPlanActive(
  ctx: TenantContext,
  planId: string,
  isActive: boolean,
): Promise<PlanDTO> {
  const existing = await ctx.db.plan.findFirst({
    where: { id: planId, deletedAt: null },
    select: PLAN_SELECT,
  });
  if (!existing) throw new NotFoundError("Plan");

  const updated = await ctx.db.plan.update({
    where: { id: planId },
    data: { isActive },
    select: PLAN_SELECT,
  });

  await auditInContext({
    action: isActive ? "plan.activate" : "plan.deactivate",
    entityType: "Plan",
    entityId: updated.id,
    before: { isActive: existing.isActive },
    after: { isActive: updated.isActive },
  });

  return updated;
}
