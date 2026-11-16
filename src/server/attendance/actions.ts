"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/server/actions/result";
import { withTenant } from "@/server/auth/rbac";
import { checkInSchema, checkOutSchema } from "@/server/attendance/schemas";
import {
  checkInMember,
  checkOutAttendance,
  type AttendanceDTO,
} from "@/server/services/attendance";

export async function checkInAction(input: unknown): Promise<ActionResult<AttendanceDTO>> {
  return runAction(async () => {
    const parsed = checkInSchema.parse(input);
    const record = await withTenant(parsed.gymSlug, "attendance:mark", (ctx) =>
      checkInMember(ctx, parsed.memberId, parsed.source),
    );
    revalidatePath(`/${parsed.gymSlug}/attendance`);
    revalidatePath(`/${parsed.gymSlug}/dashboard`);
    return record;
  });
}

export async function checkOutAction(input: unknown): Promise<ActionResult<AttendanceDTO>> {
  return runAction(async () => {
    const parsed = checkOutSchema.parse(input);
    const record = await withTenant(parsed.gymSlug, "attendance:mark", (ctx) =>
      checkOutAttendance(ctx, parsed.attendanceId),
    );
    revalidatePath(`/${parsed.gymSlug}/attendance`);
    return record;
  });
}
