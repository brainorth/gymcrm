"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/server/actions/result";
import { verifyDeskCheckInCode } from "@/server/attendance/qr";
import { withTenant } from "@/server/auth/rbac";
import { ValidationFailedError } from "@/server/db/errors";
import { checkInMember, type AttendanceDTO } from "@/server/services/attendance";

const memberSelfCheckInSchema = z.object({
  gymSlug: z.string().min(1),
  code: z.string().trim().min(1, "Enter the 6-character desk code."),
});

export async function memberSelfCheckInAction(
  input: unknown,
): Promise<ActionResult<AttendanceDTO>> {
  return runAction(async () => {
    const parsed = memberSelfCheckInSchema.parse(input);

    const record = await withTenant(parsed.gymSlug, "portal:self", async (ctx) => {
      if (!verifyDeskCheckInCode(ctx.gym.id, parsed.code)) {
        throw new ValidationFailedError(
          "Invalid or expired desk code. Ask the front desk for the current code.",
        );
      }

      const profile = await ctx.db.memberProfile.findFirst({
        where: { userId: ctx.user.id },
        select: { id: true },
      });

      if (!profile) {
        throw new ValidationFailedError(
          "Your account isn't linked to a member profile yet. Ask the front desk to link it.",
        );
      }

      return checkInMember(ctx, profile.id, "MEMBER_QR");
    });

    revalidatePath(`/${parsed.gymSlug}/portal`);
    revalidatePath(`/${parsed.gymSlug}/attendance`);
    return record;
  });
}
