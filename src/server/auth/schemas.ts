import { z } from "zod";
import { isValidSlug, normalizeSlug } from "@/lib/routing";

/** Every form and every server action payload is parsed by one of these. */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address.").max(254));

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(200, "That password is too long.")
  .refine((v) => !/^\s|\s$/.test(v), "Password cannot start or end with a space.")
  .refine(
    (v) => !["password123", "1234567890", "qwertyuiop", "letmein123"].includes(v.toLowerCase()),
    "That password is too common.",
  );

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "At least 3 characters.")
  .max(30, "At most 30 characters.")
  .transform(normalizeSlug)
  .refine(isValidSlug, "That URL is reserved or invalid. Use letters, numbers and hyphens.");

export const phoneSchema = z
  .string()
  .trim()
  .min(8, "Enter a valid phone number.")
  .max(20)
  .regex(/^\+?[0-9][0-9\s-]{7,18}$/, "Digits, spaces, hyphens and a leading + only.")
  .transform((v) => v.replace(/[\s-]/g, ""));

export const timezoneSchema = z.string().min(1).max(64).default("Asia/Kolkata");
export const currencySchema = z.string().length(3).toUpperCase().default("INR");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(200),
  next: z
    .string()
    .max(300)
    .optional()
    .transform((v) => (v && v.startsWith("/") && !v.startsWith("//") ? v : undefined)),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerGymSchema = z.object({
  gymName: z.string().trim().min(2, "Enter your gym's name.").max(80),
  slug: slugSchema,
  ownerName: z.string().trim().min(2, "Enter your name.").max(80),
  email: emailSchema,
  phone: phoneSchema.optional(),
  password: passwordSchema,
  timezone: timezoneSchema,
  currency: currencySchema,
  acceptTerms: z.literal(true, { message: "You must accept the terms to continue." }),
});
export type RegisterGymInput = z.infer<typeof registerGymSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const switchGymSchema = z.object({ gymSlug: z.string().min(3).max(30) });

/** Member/staff invite acceptance: set a password on an existing account. */
export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(2).max(80),
  password: passwordSchema,
});

/** Collect field-level errors for react-hook-form without depending on Zod internals. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
