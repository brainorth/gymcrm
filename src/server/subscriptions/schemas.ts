import { z } from "zod";

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

export const assignSubscriptionSchema = z.object({
  gymSlug: z.string().min(1),
  memberId: z.string().min(1, "Select a member."),
  planId: z.string().min(1, "Select a plan."),
  startDate: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use YYYY-MM-DD format."),
  paymentMethod: z
    .enum(["CASH", "UPI", "CARD", "BANK_TRANSFER", "OTHER", "NONE"])
    .default("UPI"),
  paidMajor: z.coerce.number().min(0, "Amount cannot be negative.").max(10_000_000).optional(),
  notes: optionalTrimmed(300),
});

export type AssignSubscriptionFormInput = z.input<typeof assignSubscriptionSchema>;
export type AssignSubscriptionParsed = z.output<typeof assignSubscriptionSchema>;

export const freezeSubscriptionSchema = z.object({
  gymSlug: z.string().min(1),
  subscriptionId: z.string().min(1),
  reason: optionalTrimmed(200),
});

export const resumeSubscriptionSchema = z.object({
  gymSlug: z.string().min(1),
  subscriptionId: z.string().min(1),
});

export const cancelSubscriptionSchema = z.object({
  gymSlug: z.string().min(1),
  subscriptionId: z.string().min(1),
  reason: optionalTrimmed(200),
});

export const recordPaymentSchema = z.object({
  gymSlug: z.string().min(1),
  memberId: z.string().min(1),
  subscriptionId: z.string().min(1).optional(),
  amountMajor: z.coerce
    .number()
    .positive("Enter an amount greater than 0.")
    .max(10_000_000),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER", "OTHER"]).default("UPI"),
  notes: optionalTrimmed(300),
});

export type RecordPaymentFormInput = z.input<typeof recordPaymentSchema>;
export type RecordPaymentParsed = z.output<typeof recordPaymentSchema>;
