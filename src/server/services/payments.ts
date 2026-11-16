import type { PaymentMethod, PaymentStatus } from "@/generated/prisma/client";
import { fiscalYearFor, toInputValue } from "@/lib/dates";
import { toMinorUnits } from "@/lib/money";
import { auditInContext } from "@/server/audit/log";
import type { TenantContext } from "@/server/auth/rbac";
import { NotFoundError, ValidationFailedError } from "@/server/db/errors";

export type PaymentDTO = {
  id: string;
  memberId: string;
  memberName: string;
  memberCode: string;
  memberPhone: string;
  subscriptionId: string | null;
  planName: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  amountMinor: number;
  refundedMinor: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  paymentDate: string;
  notes: string | null;
};

type PaymentRow = {
  id: string;
  memberId: string;
  subscriptionId: string | null;
  invoiceId: string | null;
  amountMinor: number;
  refundedMinor: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  paymentDate: Date;
  notes: string | null;
  member: { fullName: string; memberCode: string; phone: string };
  subscription: { plan: { name: string } } | null;
  invoice: { number: string } | null;
};

const PAYMENT_SELECT = {
  id: true,
  memberId: true,
  subscriptionId: true,
  invoiceId: true,
  amountMinor: true,
  refundedMinor: true,
  currency: true,
  method: true,
  status: true,
  paymentDate: true,
  notes: true,
  member: { select: { fullName: true, memberCode: true, phone: true } },
  subscription: { select: { plan: { select: { name: true } } } },
  invoice: { select: { number: true } },
} as const;

function toDTO(row: PaymentRow): PaymentDTO {
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: row.member.fullName,
    memberCode: row.member.memberCode,
    memberPhone: row.member.phone,
    subscriptionId: row.subscriptionId,
    planName: row.subscription?.plan.name ?? null,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoice?.number ?? null,
    amountMinor: row.amountMinor,
    refundedMinor: row.refundedMinor,
    currency: row.currency,
    method: row.method,
    status: row.status,
    paymentDate: toInputValue(row.paymentDate),
    notes: row.notes,
  };
}

export async function listPayments(ctx: TenantContext): Promise<PaymentDTO[]> {
  const rows = await ctx.db.payment.findMany({
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: PAYMENT_SELECT,
  });
  return (rows as unknown as PaymentRow[]).map(toDTO);
}

export async function refundPayment(
  ctx: TenantContext,
  paymentId: string,
  amountMajor: number,
  reason?: string,
): Promise<PaymentDTO> {
  const amountMinor = toMinorUnits(amountMajor);
  if (amountMinor <= 0) {
    throw new ValidationFailedError("Refund amount must be greater than 0.", {
      amountMajor: ["Enter an amount greater than 0."],
    });
  }

  const existing = (await ctx.db.payment.findFirst({
    where: { id: paymentId },
    select: PAYMENT_SELECT,
  })) as unknown as PaymentRow | null;
  if (!existing) throw new NotFoundError("Payment");

  if (existing.status !== "SUCCEEDED") {
    throw new ValidationFailedError("Only succeeded payments can be refunded.");
  }

  const remainingMinor = existing.amountMinor - existing.refundedMinor;
  if (amountMinor > remainingMinor) {
    throw new ValidationFailedError("Refund amount exceeds remaining refundable balance.", {
      amountMajor: ["Amount exceeds remaining refundable balance."],
    });
  }

  const nextRefundedMinor = existing.refundedMinor + amountMinor;
  const nextStatus: PaymentStatus =
    nextRefundedMinor >= existing.amountMinor ? "REFUNDED" : "SUCCEEDED";

  const updated = (await ctx.db.payment.update({
    where: { id: paymentId },
    data: {
      refundedMinor: nextRefundedMinor,
      status: nextStatus,
    },
    select: PAYMENT_SELECT,
  })) as unknown as PaymentRow;

  const dto = toDTO(updated);
  await auditInContext({
    action: "payment.refund",
    entityType: "Payment",
    entityId: dto.id,
    before: {
      refundedMinor: existing.refundedMinor,
      status: existing.status,
    },
    after: {
      refundedMinor: dto.refundedMinor,
      status: dto.status,
      refundAmountMinor: amountMinor,
      reason,
    },
  });
  return dto;
}

export async function issueInvoiceForPayment(
  ctx: TenantContext,
  paymentId: string,
): Promise<PaymentDTO> {
  const result = await ctx.db.$transaction(async (tx) => {
    const payment = (await tx.payment.findFirst({
      where: { id: paymentId },
      select: PAYMENT_SELECT,
    })) as unknown as PaymentRow | null;
    if (!payment) throw new NotFoundError("Payment");

    if (payment.invoiceId) {
      return { row: payment, createdInvoiceNumber: null as string | null };
    }

    const now = new Date();
    const fiscalYear = fiscalYearFor(now);

    const counter = await tx.invoiceCounter.upsert({
      where: { gymId_fiscalYear: { gymId: ctx.gym.id, fiscalYear } },
      create: {
        fiscalYear,
        lastSequence: 1,
      } as never,
      update: {
        lastSequence: { increment: 1 },
      },
      select: { lastSequence: true, prefix: true },
    });

    const invoiceNumber = `${counter.prefix}-${fiscalYear}-${String(counter.lastSequence).padStart(4, "0")}`;

    const invoice = await tx.invoice.create({
      data: {
        memberId: payment.memberId,
        subscriptionId: payment.subscriptionId,
        number: invoiceNumber,
        sequence: counter.lastSequence,
        fiscalYear,
        status: "ISSUED",
        currency: payment.currency,
        subtotalMinor: payment.amountMinor,
        totalMinor: payment.amountMinor,
        paidMinor: payment.amountMinor,
        issuedAt: now,
        notes: payment.notes,
      } as never,
      select: { id: true, number: true },
    });

    const itemLabel = payment.subscription?.plan.name
      ? `${payment.subscription.plan.name} membership`
      : "Gym payment";

    await tx.invoiceItem.create({
      data: {
        invoiceId: invoice.id,
        label: itemLabel,
        quantity: 1,
        unitPriceMinor: payment.amountMinor,
        totalMinor: payment.amountMinor,
      } as never,
      select: { id: true },
    });

    const updated = (await tx.payment.update({
      where: { id: payment.id },
      data: { invoiceId: invoice.id },
      select: PAYMENT_SELECT,
    })) as unknown as PaymentRow;

    return { row: updated, createdInvoiceNumber: invoice.number };
  });

  const dto = toDTO(result.row);
  if (result.createdInvoiceNumber) {
    await auditInContext({
      action: "invoice.issue",
      entityType: "Invoice",
      entityId: dto.invoiceId ?? dto.id,
      after: {
        invoiceNumber: result.createdInvoiceNumber,
        paymentId: dto.id,
        amountMinor: dto.amountMinor,
      },
    });
  }
  return dto;
}
