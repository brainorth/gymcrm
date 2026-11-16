"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { BillingStatus, GymStatus } from "@/generated/prisma/client";
import { runAction, type ActionResult } from "@/server/actions/result";
import { withTenant } from "@/server/auth/rbac";
import { getCurrentSession } from "@/server/auth/session";
import { ForbiddenError, UnauthenticatedError } from "@/server/db/errors";
import { selectSaasPlan, updateGymForAdmin } from "@/server/services/saas";

const selectSaasPlanSchema = z.object({
  gymSlug: z.string().trim().min(1),
  saasPlanId: z.string().trim().min(1),
});

const adminUpdateGymSchema = z.object({
  gymId: z.string().trim().min(1),
  status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]),
  billingStatus: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED", "UNPAID"]),
});

export async function selectSaasPlanAction(
  input: unknown,
): Promise<ActionResult<{ subscriptionId: string; billingStatus: BillingStatus }>> {
  return runAction(async () => {
    const parsed = selectSaasPlanSchema.parse(input);
    const result = await withTenant(parsed.gymSlug, "billing:saas", (ctx) =>
      selectSaasPlan(ctx, parsed.saasPlanId),
    );
    revalidatePath(`/${parsed.gymSlug}/billing`);
    revalidatePath(`/${parsed.gymSlug}/dashboard`);
    return result;
  });
}

export async function adminUpdateGymAction(
  input: unknown,
): Promise<ActionResult<{ id: string; status: GymStatus; billingStatus: BillingStatus }>> {
  return runAction(async () => {
    const session = await getCurrentSession();
    if (!session) throw new UnauthenticatedError();
    if (session.user.platformRole !== "SUPER_ADMIN") {
      throw new ForbiddenError("Platform administrators only.");
    }

    const parsed = adminUpdateGymSchema.parse(input);
    const updated = await updateGymForAdmin(session.user.id, parsed.gymId, {
      status: parsed.status,
      billingStatus: parsed.billingStatus,
    });
    revalidatePath("/admin");
    return updated;
  });
}
