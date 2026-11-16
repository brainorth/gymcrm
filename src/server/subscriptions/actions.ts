"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/server/actions/result";
import { withTenant } from "@/server/auth/rbac";
import {
  assignSubscriptionSchema,
  cancelSubscriptionSchema,
  freezeSubscriptionSchema,
  recordPaymentSchema,
  resumeSubscriptionSchema,
} from "@/server/subscriptions/schemas";
import {
  assignSubscription,
  cancelSubscription,
  freezeSubscription,
  recordManualPayment,
  resumeSubscription,
  type SubscriptionDTO,
} from "@/server/services/subscriptions";

export async function assignSubscriptionAction(
  input: unknown,
): Promise<ActionResult<SubscriptionDTO>> {
  return runAction(async () => {
    const parsed = assignSubscriptionSchema.parse(input);
    const sub = await withTenant(parsed.gymSlug, "subscription:write", (ctx) =>
      assignSubscription(ctx, parsed),
    );
    revalidatePath(`/${parsed.gymSlug}/subscriptions`);
    revalidatePath(`/${parsed.gymSlug}/members`);
    revalidatePath(`/${parsed.gymSlug}/dashboard`);
    return sub;
  });
}

export async function freezeSubscriptionAction(
  input: unknown,
): Promise<ActionResult<SubscriptionDTO>> {
  return runAction(async () => {
    const parsed = freezeSubscriptionSchema.parse(input);
    const sub = await withTenant(parsed.gymSlug, "subscription:freeze", (ctx) =>
      freezeSubscription(ctx, parsed.subscriptionId, parsed.reason),
    );
    revalidatePath(`/${parsed.gymSlug}/subscriptions`);
    return sub;
  });
}

export async function resumeSubscriptionAction(
  input: unknown,
): Promise<ActionResult<SubscriptionDTO>> {
  return runAction(async () => {
    const parsed = resumeSubscriptionSchema.parse(input);
    const sub = await withTenant(parsed.gymSlug, "subscription:freeze", (ctx) =>
      resumeSubscription(ctx, parsed.subscriptionId),
    );
    revalidatePath(`/${parsed.gymSlug}/subscriptions`);
    return sub;
  });
}

export async function cancelSubscriptionAction(
  input: unknown,
): Promise<ActionResult<SubscriptionDTO>> {
  return runAction(async () => {
    const parsed = cancelSubscriptionSchema.parse(input);
    const sub = await withTenant(parsed.gymSlug, "subscription:write", (ctx) =>
      cancelSubscription(ctx, parsed.subscriptionId, parsed.reason),
    );
    revalidatePath(`/${parsed.gymSlug}/subscriptions`);
    revalidatePath(`/${parsed.gymSlug}/dashboard`);
    return sub;
  });
}

export async function recordPaymentAction(
  input: unknown,
): Promise<ActionResult<SubscriptionDTO | null>> {
  return runAction(async () => {
    const parsed = recordPaymentSchema.parse(input);
    const sub = await withTenant(parsed.gymSlug, "payment:record", (ctx) =>
      recordManualPayment(ctx, parsed),
    );
    revalidatePath(`/${parsed.gymSlug}/subscriptions`);
    revalidatePath(`/${parsed.gymSlug}/dashboard`);
    return sub;
  });
}
