"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/server/actions/result";
import { withTenant } from "@/server/auth/rbac";
import {
  addOrInviteStaff,
  removeStaff,
  updateGymSettings,
  updateStaffRole,
  type GymSettingsDTO,
  type StaffDTO,
} from "@/server/services/staff";
import {
  inviteStaffSchema,
  removeStaffSchema,
  updateGymSettingsSchema,
  updateStaffRoleSchema,
} from "@/server/staff/schemas";

export async function addOrInviteStaffAction(
  input: unknown,
): Promise<ActionResult<{ staff: StaffDTO; invited: boolean }>> {
  return runAction(async () => {
    const parsed = inviteStaffSchema.parse(input);
    const result = await withTenant(parsed.gymSlug, "staff:write", (ctx) =>
      addOrInviteStaff(ctx, parsed),
    );
    revalidatePath(`/${parsed.gymSlug}/staff`);
    return result;
  });
}

export async function updateStaffRoleAction(input: unknown): Promise<ActionResult<StaffDTO>> {
  return runAction(async () => {
    const parsed = updateStaffRoleSchema.parse(input);
    const staff = await withTenant(parsed.gymSlug, "staff:write", (ctx) =>
      updateStaffRole(ctx, parsed.membershipId, parsed.role),
    );
    revalidatePath(`/${parsed.gymSlug}/staff`);
    return staff;
  });
}

export async function removeStaffAction(
  input: unknown,
): Promise<ActionResult<{ membershipId: string }>> {
  return runAction(async () => {
    const parsed = removeStaffSchema.parse(input);
    const removed = await withTenant(parsed.gymSlug, "staff:write", (ctx) =>
      removeStaff(ctx, parsed.membershipId),
    );
    revalidatePath(`/${parsed.gymSlug}/staff`);
    return removed;
  });
}

export async function updateGymSettingsAction(
  input: unknown,
): Promise<ActionResult<GymSettingsDTO>> {
  return runAction(async () => {
    const parsed = updateGymSettingsSchema.parse(input);
    const settings = await withTenant(parsed.gymSlug, "gym:settings", (ctx) =>
      updateGymSettings(ctx, parsed),
    );
    revalidatePath(`/${parsed.gymSlug}/settings`);
    revalidatePath(`/${parsed.gymSlug}/dashboard`);
    revalidatePath(`/${parsed.gymSlug}`, "layout");
    return settings;
  });
}
