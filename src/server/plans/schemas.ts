import { z } from "zod";

export const planInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Plan name must be at least 2 characters.")
    .max(60, "Plan name is too long."),
  description: z
    .string()
    .trim()
    .max(240, "Description is too long.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  durationInDays: z.coerce
    .number()
    .int("Must be a whole number of days.")
    .min(1, "Duration must be at least 1 day.")
    .max(3650, "Duration cannot exceed 10 years."),
  priceMajor: z.coerce
    .number()
    .min(0, "Price cannot be negative.")
    .max(10_000_000, "Price is too high."),
  joiningFeeMajor: z.coerce
    .number()
    .min(0, "Joining fee cannot be negative.")
    .max(10_000_000, "Joining fee is too high.")
    .default(0),
  maxFreezeDays: z.coerce
    .number()
    .int("Must be a whole number.")
    .min(0, "Cannot be negative.")
    .max(365, "Cannot exceed 365 days.")
    .default(0),
  graceDays: z.coerce
    .number()
    .int("Must be a whole number.")
    .min(0, "Cannot be negative.")
    .max(90, "Cannot exceed 90 days.")
    .default(0),
});

export type PlanFormInput = z.input<typeof planInputSchema>;
export type PlanParsedInput = z.output<typeof planInputSchema>;

export const createPlanSchema = planInputSchema.extend({
  gymSlug: z.string().min(1),
});

export const updatePlanSchema = planInputSchema.extend({
  gymSlug: z.string().min(1),
  planId: z.string().min(1),
});

export const togglePlanActiveSchema = z.object({
  gymSlug: z.string().min(1),
  planId: z.string().min(1),
  isActive: z.boolean(),
});
