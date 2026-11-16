import { z } from "zod";

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

export const refundPaymentSchema = z.object({
  gymSlug: z.string().min(1),
  paymentId: z.string().min(1),
  amountMajor: z.coerce
    .number()
    .positive("Enter a refund amount greater than 0.")
    .max(10_000_000),
  reason: optionalTrimmed(300),
});

export type RefundPaymentFormInput = z.input<typeof refundPaymentSchema>;
export type RefundPaymentParsed = z.output<typeof refundPaymentSchema>;

export const issueInvoiceSchema = z.object({
  gymSlug: z.string().min(1),
  paymentId: z.string().min(1),
});

export type IssueInvoiceParsed = z.output<typeof issueInvoiceSchema>;

export const createPaymentLinkSchema = z.object({
  gymSlug: z.string().min(1),
  memberId: z.string().min(1),
  subscriptionId: optionalTrimmed(64),
  amountMajor: z.coerce
    .number()
    .positive("Enter an amount greater than 0.")
    .max(10_000_000),
  expiresInHours: z.coerce.number().int().positive().max(24 * 90).optional(),
});

export type CreatePaymentLinkParsed = z.output<typeof createPaymentLinkSchema>;

export const completeMockPaymentSchema = z.object({
  shortCode: z.string().trim().min(1).max(32),
});
