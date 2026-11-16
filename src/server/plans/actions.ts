"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/server/actions/result";
import { withTenant } from "@/server/auth/rbac";
import {
  createPlanSchema,
  togglePlanActiveSchema,
  updatePlanSchema,
} from "@/server/plans/schemas";
import {
  createPlan,
  setPlanActive,
  updatePlan,
  type PlanDTO,
} from "@/server/services/plans";

export async function createPlanAction(input: unknown): Promise<ActionResult<PlanDTO>> {
  return runAction(async () => {
    const parsed = createPlanSchema.parse(input);
    const plan = await withTenant(parsed.gymSlug, "plan:write", (ctx) =>
      createPlan(ctx, parsed),
    );
    revalidatePath(`/${parsed.gymSlug}/plans`);
    return plan;
  });
}

export async function updatePlanAction(input: unknown): Promise<ActionResult<PlanDTO>> {
  return runAction(async () => {
    const parsed = updatePlanSchema.parse(input);
    const plan = await withTenant(parsed.gymSlug, "plan:write", (ctx) =>
      updatePlan(ctx, parsed.planId, parsed),
    );
    revalidatePath(`/${parsed.gymSlug}/plans`);
    return plan;
  });
}

export async function togglePlanActiveAction(input: unknown): Promise<ActionResult<PlanDTO>> {
  return runAction(async () => {
    const parsed = togglePlanActiveSchema.parse(input);
    const plan = await withTenant(parsed.gymSlug, "plan:write", (ctx) =>
      setPlanActive(ctx, parsed.planId, parsed.isActive),
    );
    revalidatePath(`/${parsed.gymSlug}/plans`);
    return plan;
  });
}
