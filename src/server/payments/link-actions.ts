"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/server/actions/result";
import { withTenant } from "@/server/auth/rbac";
import {
  completeMockPaymentSchema,
  createPaymentLinkSchema,
} from "@/server/payments/schemas";
import {
  completeMockPaymentLink,
  createPaymentLink,
  type CompleteMockPaymentResult,
  type CreatePaymentLinkResult,
} from "@/server/services/payment-links";

export async function createPaymentLinkAction(
  input: unknown,
): Promise<ActionResult<CreatePaymentLinkResult>> {
  return runAction(async () => {
    const parsed = createPaymentLinkSchema.parse(input);
    const link = await withTenant(parsed.gymSlug, "payment:record", (ctx) =>
      createPaymentLink(ctx, {
        memberId: parsed.memberId,
        subscriptionId: parsed.subscriptionId,
        amountMajor: parsed.amountMajor,
        expiresInHours: parsed.expiresInHours,
      }),
    );
    revalidatePath(`/${parsed.gymSlug}/payments`);
    return link;
  });
}

export async function completeMockPaymentAction(
  shortCode: string,
): Promise<ActionResult<CompleteMockPaymentResult>> {
  return runAction(async () => {
    const parsed = completeMockPaymentSchema.parse({ shortCode });
    const result = await completeMockPaymentLink(parsed.shortCode);
    revalidatePath(`/pay/${parsed.shortCode}`);
    return result;
  });
}
