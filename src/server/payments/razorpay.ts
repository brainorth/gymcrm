import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { PaymentsNotConfiguredError } from "@/server/db/errors";

export type CreateRazorpayOrderInput = {
  amountMinor: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
};

export type RazorpayOrderResult = {
  id: string;
  amount: number;
  currency: string;
};

/**
 * Creates a Razorpay Order. In `mock` mode, returns a deterministic-shape mock
 * order without making any network call so local dev and tests run offline.
 */
export async function createRazorpayOrder(
  input: CreateRazorpayOrderInput,
): Promise<RazorpayOrderResult> {
  const { PAYMENTS_DRIVER, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = env();

  if (PAYMENTS_DRIVER === "mock") {
    return {
      id: `order_mock_${randomUUID().slice(0, 12)}`,
      amount: input.amountMinor,
      currency: input.currency,
    };
  }

  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    throw new PaymentsNotConfiguredError("Razorpay");
  }

  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes ?? {},
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Razorpay order creation failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { id: string; amount: number; currency: string };
  return {
    id: data.id,
    amount: data.amount,
    currency: data.currency,
  };
}

/**
 * Verifies the `x-razorpay-signature` header against the raw request body
 * using HMAC-SHA256 and constant-time comparison.
 */
export function verifyRazorpayWebhookSignature(rawBody: string, signature: string): boolean {
  const { RAZORPAY_WEBHOOK_SECRET } = env();
  if (!RAZORPAY_WEBHOOK_SECRET || !signature) return false;

  const expectedHex = createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody, "utf8")
    .digest("hex");

  const expectedBuf = Buffer.from(expectedHex, "utf8");
  const providedBuf = Buffer.from(signature.trim(), "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}
