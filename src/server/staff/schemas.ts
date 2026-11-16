import { z } from "zod";
import { emailSchema } from "@/server/auth/schemas";

export const STAFF_ROLES = ["STAFF", "TRAINER", "GYM_OWNER"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const staffRoleSchema = z.enum(STAFF_ROLES);

export const inviteStaffInputSchema = z.object({
  name: z.string().trim().min(2, "Enter the staff member's name.").max(80, "Name is too long."),
  email: emailSchema,
  role: staffRoleSchema,
});

export type InviteStaffFormInput = z.input<typeof inviteStaffInputSchema>;
export type InviteStaffParsedInput = z.output<typeof inviteStaffInputSchema>;

export const inviteStaffSchema = inviteStaffInputSchema.extend({
  gymSlug: z.string().min(1),
});

export const updateStaffRoleSchema = z.object({
  gymSlug: z.string().min(1),
  membershipId: z.string().min(1),
  role: staffRoleSchema,
});

export const removeStaffSchema = z.object({
  gymSlug: z.string().min(1),
  membershipId: z.string().min(1),
});

export const gymSettingsInputSchema = z.object({
  name: z.string().trim().min(2, "Enter your gym's name.").max(80, "Name is too long."),
  timezone: z
    .string()
    .trim()
    .min(1, "Enter a valid timezone.")
    .max(64, "Timezone is too long.")
    .refine(
      (tz) => {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      "Enter a valid IANA timezone (e.g. Asia/Kolkata).",
    ),
  currency: z
    .string()
    .trim()
    .length(3, "Use a 3-letter currency code (e.g. INR, USD).")
    .toUpperCase(),
});

export type GymSettingsFormInput = z.input<typeof gymSettingsInputSchema>;
export type GymSettingsParsedInput = z.output<typeof gymSettingsInputSchema>;

export const updateGymSettingsSchema = gymSettingsInputSchema.extend({
  gymSlug: z.string().min(1),
});
