import { createHash, randomBytes } from "node:crypto";
import type { PaymentLinkStatus } from "@/generated/prisma/client";
import { env } from "@/env";
import { toMinorUnits } from "@/lib/money";
import { auditInContext, writeAudit } from "@/server/audit/log";
import type { TenantContext } from "@/server/auth/rbac";
import { prisma } from "@/server/db/client";
import {
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
  isUniqueViolation,
} from "@/server/db/errors";
import { appUrl } from "@/server/notifications/mailer";
import { verifyRazorpayWebhookSignature } from "@/server/payments/razorpay";

export type CreatePaymentLinkInput = {
  memberId: string;
  subscriptionId?: string;
  amountMajor: number;
  expiresInHours?: number;
};

export type CreatePaymentLinkResult = {
  id: string;
  shortCode: string;
  url: string;
};

export type PublicPaymentLinkDTO = {
  shortCode: string;
  gymName: string;
  gymSlug: string;
  currency: string;
  memberName: string;
  amountMinor: number;
  status: PaymentLinkStatus;
  expiresAt: string | null;
  paidAt: string | null;
};

export type CompleteMockPaymentResult = {
  shortCode: string;
  status: "PAID";
  paymentId: string;
};

export type WebhookProcessResult = {
  status: "PROCESSED" | "ALREADY_PROCESSED" | "IGNORED";
  eventId: string;
  eventType: string;
};

function generateShortCode(): string {
  // 6 random bytes -> 8 URL-safe base64url chars (no padding).
  return randomBytes(6).toString("base64url").slice(0, 8);
}

export async function createPaymentLink(
  ctx: TenantContext,
  input: CreatePaymentLinkInput,
): Promise<CreatePaymentLinkResult> {
  const amountMinor = toMinorUnits(input.amountMajor);
  if (amountMinor <= 0) {
    throw new ValidationFailedError("Amount must be greater than 0.", {
      amountMajor: ["Enter an amount greater than 0."],
    });
  }

  const member = await ctx.db.memberProfile.findFirst({
    where: { id: input.memberId },
    select: { id: true, fullName: true },
  });
  if (!member) throw new NotFoundError("Member");

  if (input.subscriptionId) {
    const subscription = await ctx.db.memberSubscription.findFirst({
      where: { id: input.subscriptionId, memberId: input.memberId },
      select: { id: true },
    });
    if (!subscription) throw new NotFoundError("Subscription");
  }

  const expiresAt =
    input.expiresInHours && input.expiresInHours > 0
      ? new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000)
      : null;

  const provider = env().PAYMENTS_DRIVER === "razorpay" ? "RAZORPAY" : "MANUAL";

  let created: { id: string; shortCode: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const shortCode = generateShortCode();
    try {
      created = await ctx.db.paymentLink.create({
        data: {
          memberId: input.memberId,
          subscriptionId: input.subscriptionId ?? null,
          amountMinor,
          currency: ctx.gym.currency,
          provider,
          shortCode,
          expiresAt,
          createdById: ctx.user.id,
        } as never,
        select: { id: true, shortCode: true },
      });
      break;
    } catch (error) {
      if (!isUniqueViolation(error, ["shortCode"])) throw error;
    }
  }

  if (!created) {
    throw new Error("Could not allocate a unique payment link code.");
  }

  await auditInContext({
    action: "payment_link.create",
    entityType: "PaymentLink",
    entityId: created.id,
    after: {
      shortCode: created.shortCode,
      memberId: input.memberId,
      subscriptionId: input.subscriptionId ?? null,
      amountMinor,
      currency: ctx.gym.currency,
      expiresAt: expiresAt?.toISOString() ?? null,
    },
  });

  return {
    id: created.id,
    shortCode: created.shortCode,
    url: appUrl(`/pay/${created.shortCode}`),
  };
}

/**
 * Public read for `/pay/[shortCode]`. Uses the platform client and projects
 * only display-safe fields (never internal IDs, phones, or emails).
 */
export async function getPublicPaymentLink(
  shortCode: string,
): Promise<PublicPaymentLinkDTO | null> {
  const row = await prisma.paymentLink.findUnique({
    where: { shortCode },
    select: {
      shortCode: true,
      amountMinor: true,
      currency: true,
      status: true,
      expiresAt: true,
      paidAt: true,
      gym: { select: { name: true, slug: true, currency: true } },
      member: { select: { fullName: true } },
    },
  });

  if (!row) return null;

  const isPastExpiry =
    row.status === "CREATED" && row.expiresAt !== null && row.expiresAt.getTime() < Date.now();

  return {
    shortCode: row.shortCode,
    gymName: row.gym.name,
    gymSlug: row.gym.slug,
    currency: row.currency || row.gym.currency,
    memberName: row.member.fullName,
    amountMinor: row.amountMinor,
    status: isPastExpiry ? "EXPIRED" : row.status,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
  };
}

/**
 * Completes a payment link in mock mode. Disabled when `PAYMENTS_DRIVER !== "mock"`.
 */
export async function completeMockPaymentLink(
  shortCode: string,
): Promise<CompleteMockPaymentResult> {
  if (env().PAYMENTS_DRIVER !== "mock") {
    throw new ForbiddenError("Mock payments are disabled when live payments are active.");
  }

  const txResult = await prisma.$transaction(async (tx) => {
    const link = await tx.paymentLink.findUnique({
      where: { shortCode },
      select: {
        id: true,
        gymId: true,
        memberId: true,
        subscriptionId: true,
        amountMinor: true,
        currency: true,
        shortCode: true,
        status: true,
        expiresAt: true,
      },
    });
    if (!link) throw new NotFoundError("Payment link");

    const idempotencyKey = `mock-link-${link.id}`;

    if (link.status === "PAID") {
      const existingPayment = await tx.payment.findUnique({
        where: { gymId_idempotencyKey: { gymId: link.gymId, idempotencyKey } },
        select: { id: true },
      });
      return {
        shortCode: link.shortCode,
        paymentId: existingPayment?.id ?? link.id,
        gymId: link.gymId,
        linkId: link.id,
        amountMinor: link.amountMinor,
        newlyPaid: false,
      };
    }

    if (link.status === "CANCELLED") {
      throw new ValidationFailedError("This payment link has been cancelled.");
    }

    if (link.status === "EXPIRED" || (link.expiresAt && link.expiresAt.getTime() < Date.now())) {
      throw new ValidationFailedError("This payment link has expired.");
    }

    const now = new Date();
    await tx.paymentLink.update({
      where: { id: link.id },
      data: { status: "PAID", paidAt: now },
    });

    const payment = await tx.payment.create({
      data: {
        gymId: link.gymId,
        memberId: link.memberId,
        subscriptionId: link.subscriptionId,
        amountMinor: link.amountMinor,
        currency: link.currency,
        method: "ONLINE",
        status: "SUCCEEDED",
        provider: "MANUAL",
        idempotencyKey,
        paymentDate: now,
        notes: `Mock online payment via link ${link.shortCode}`,
      },
      select: { id: true },
    });

    return {
      shortCode: link.shortCode,
      paymentId: payment.id,
      gymId: link.gymId,
      linkId: link.id,
      amountMinor: link.amountMinor,
      newlyPaid: true,
    };
  });

  if (txResult.newlyPaid) {
    await writeAudit({
      gymId: txResult.gymId,
      actorUserId: null,
      action: "payment.mock_link_complete",
      entityType: "Payment",
      entityId: txResult.paymentId,
      after: {
        shortCode: txResult.shortCode,
        paymentLinkId: txResult.linkId,
        amountMinor: txResult.amountMinor,
      },
    });
  }

  return {
    shortCode: txResult.shortCode,
    status: "PAID",
    paymentId: txResult.paymentId,
  };
}

type RazorpayWebhookPayload = {
  id?: string;
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        amount?: number;
        currency?: string;
        notes?: Record<string, string>;
      };
    };
    payment_link?: {
      entity?: {
        id?: string;
        amount?: number;
        amount_paid?: number;
        currency?: string;
        notes?: Record<string, string>;
      };
    };
  };
};

export async function processRazorpayWebhook(
  rawBody: string,
  signature: string,
  eventIdHeader?: string,
): Promise<WebhookProcessResult> {
  if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
    throw new ForbiddenError("Invalid Razorpay webhook signature.");
  }

  let parsed: RazorpayWebhookPayload;
  try {
    parsed = JSON.parse(rawBody) as RazorpayWebhookPayload;
  } catch {
    throw new ValidationFailedError("Malformed webhook JSON payload.");
  }

  const eventType = parsed.event ?? "unknown";
  const paymentEntity = parsed.payload?.payment?.entity;
  const linkEntity = parsed.payload?.payment_link?.entity;

  const fallbackDigest = createHash("sha256").update(rawBody).digest("hex").slice(0, 16);
  const eventId =
    eventIdHeader?.trim() ||
    parsed.id ||
    `${eventType}:${paymentEntity?.id ?? linkEntity?.id ?? fallbackDigest}`;

  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_eventId: { provider: "RAZORPAY", eventId } },
    select: { id: true, status: true },
  });

  if (existing?.status === "PROCESSED") {
    return { status: "ALREADY_PROCESSED", eventId, eventType };
  }

  const webhookRecord = await prisma.webhookEvent.upsert({
    where: { provider_eventId: { provider: "RAZORPAY", eventId } },
    create: {
      provider: "RAZORPAY",
      eventId,
      eventType,
      payload: parsed as never,
      signatureValid: true,
      status: "RECEIVED",
      attempts: 1,
    },
    update: {
      eventType,
      payload: parsed as never,
      signatureValid: true,
      status: "RECEIVED",
      attempts: { increment: 1 },
      lastError: null,
    },
    select: { id: true },
  });

  try {
    if (eventType !== "payment.captured" && eventType !== "payment_link.paid") {
      await prisma.webhookEvent.update({
        where: { id: webhookRecord.id },
        data: { status: "IGNORED", processedAt: new Date() },
      });
      return { status: "IGNORED", eventId, eventType };
    }

    const notes = {
      ...(linkEntity?.notes ?? {}),
      ...(paymentEntity?.notes ?? {}),
    };

    await prisma.$transaction(async (tx) => {
      const link = await findMatchingPaymentLink(tx, {
        providerLinkId: linkEntity?.id,
        paymentLinkId: notes.paymentLinkId,
        shortCode: notes.shortCode,
      });

      const now = new Date();
      if (link && link.status !== "PAID") {
        await tx.paymentLink.update({
          where: { id: link.id },
          data: { status: "PAID", paidAt: now },
        });
      }

      const gymId = link?.gymId ?? notes.gymId;
      const memberId = link?.memberId ?? notes.memberId;
      const subscriptionId = link?.subscriptionId ?? notes.subscriptionId ?? null;
      const amountMinor =
        paymentEntity?.amount ?? linkEntity?.amount_paid ?? link?.amountMinor ?? 0;
      const currency = paymentEntity?.currency ?? linkEntity?.currency ?? link?.currency ?? "INR";

      if (gymId && memberId && amountMinor > 0) {
        const providerPaymentId = paymentEntity?.id ?? null;
        const idempotencyKey = `rzp-evt-${eventId}`;

        const alreadyRecorded = providerPaymentId
          ? await tx.payment.findUnique({
              where: {
                provider_providerPaymentId: {
                  provider: "RAZORPAY",
                  providerPaymentId,
                },
              },
              select: { id: true },
            })
          : await tx.payment.findUnique({
              where: { gymId_idempotencyKey: { gymId, idempotencyKey } },
              select: { id: true },
            });

        if (!alreadyRecorded) {
          await tx.payment.create({
            data: {
              gymId,
              memberId,
              subscriptionId,
              amountMinor,
              currency,
              method: "ONLINE",
              status: "SUCCEEDED",
              provider: "RAZORPAY",
              providerOrderId: paymentEntity?.order_id ?? null,
              providerPaymentId,
              providerSignature: signature,
              idempotencyKey,
              paymentDate: now,
              notes: link
                ? `Razorpay payment via link ${link.shortCode}`
                : `Razorpay webhook ${eventType}`,
            },
          });
        }
      }

      await tx.webhookEvent.update({
        where: { id: webhookRecord.id },
        data: { status: "PROCESSED", processedAt: now, lastError: null },
      });
    });

    return { status: "PROCESSED", eventId, eventType };
  } catch (error) {
    await prisma.webhookEvent.update({
      where: { id: webhookRecord.id },
      data: {
        status: "FAILED",
        lastError: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
      },
    });
    throw error;
  }
}

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function findMatchingPaymentLink(
  tx: PrismaTx,
  lookup: { providerLinkId?: string; paymentLinkId?: string; shortCode?: string },
) {
  const select = {
    id: true,
    gymId: true,
    memberId: true,
    subscriptionId: true,
    amountMinor: true,
    currency: true,
    shortCode: true,
    status: true,
  } as const;

  if (lookup.paymentLinkId) {
    const byId = await tx.paymentLink.findUnique({ where: { id: lookup.paymentLinkId }, select });
    if (byId) return byId;
  }
  if (lookup.shortCode) {
    const byCode = await tx.paymentLink.findUnique({
      where: { shortCode: lookup.shortCode },
      select,
    });
    if (byCode) return byCode;
  }
  if (lookup.providerLinkId) {
    return tx.paymentLink.findFirst({
      where: { providerLinkId: lookup.providerLinkId },
      select,
    });
  }
  return null;
}
