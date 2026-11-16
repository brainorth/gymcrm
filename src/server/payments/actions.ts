"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/server/actions/result";
import { withTenant } from "@/server/auth/rbac";
import { issueInvoiceSchema, refundPaymentSchema } from "@/server/payments/schemas";
import {
  issueInvoiceForPayment,
  refundPayment,
  type PaymentDTO,
} from "@/server/services/payments";

export async function refundPaymentAction(input: unknown): Promise<ActionResult<PaymentDTO>> {
  return runAction(async () => {
    const parsed = refundPaymentSchema.parse(input);
    const payment = await withTenant(parsed.gymSlug, "payment:refund", (ctx) =>
      refundPayment(ctx, parsed.paymentId, parsed.amountMajor, parsed.reason),
    );
    revalidatePath(`/${parsed.gymSlug}/payments`);
    revalidatePath(`/${parsed.gymSlug}/subscriptions`);
    revalidatePath(`/${parsed.gymSlug}/dashboard`);
    return payment;
  });
}

export async function issueInvoiceAction(input: unknown): Promise<ActionResult<PaymentDTO>> {
  return runAction(async () => {
    const parsed = issueInvoiceSchema.parse(input);
    const payment = await withTenant(parsed.gymSlug, "invoice:write", (ctx) =>
      issueInvoiceForPayment(ctx, parsed.paymentId),
    );
    revalidatePath(`/${parsed.gymSlug}/payments`);
    return payment;
  });
}
