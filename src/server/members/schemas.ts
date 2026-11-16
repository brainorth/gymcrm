import { z } from "zod";
import { emailSchema, phoneSchema } from "@/server/auth/schemas";

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

export const memberInputSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Enter the member's full name.")
    .max(100, "Name is too long."),
  phone: phoneSchema,
  email: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(emailSchema.optional()),
  dateOfBirth: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use YYYY-MM-DD format."),
  gender: optionalTrimmed(32),
  emergencyContactName: optionalTrimmed(100),
  emergencyContactPhone: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(phoneSchema.optional()),
  emergencyContactRelation: optionalTrimmed(40),
  notes: optionalTrimmed(500),
});

export type MemberFormInput = z.input<typeof memberInputSchema>;
export type MemberParsedInput = z.output<typeof memberInputSchema>;

export const createMemberSchema = memberInputSchema.extend({
  gymSlug: z.string().min(1),
});

export const updateMemberSchema = memberInputSchema.extend({
  gymSlug: z.string().min(1),
  memberId: z.string().min(1),
});

export const setMemberStatusSchema = z.object({
  gymSlug: z.string().min(1),
  memberId: z.string().min(1),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]),
});
