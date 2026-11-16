"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/server/actions/result";
import { withTenant } from "@/server/auth/rbac";
import {
  createMemberSchema,
  setMemberStatusSchema,
  updateMemberSchema,
} from "@/server/members/schemas";
import {
  createMember,
  setMemberStatus,
  updateMember,
  type MemberDTO,
} from "@/server/services/members";

export async function createMemberAction(input: unknown): Promise<ActionResult<MemberDTO>> {
  return runAction(async () => {
    const parsed = createMemberSchema.parse(input);
    const member = await withTenant(parsed.gymSlug, "member:write", (ctx) =>
      createMember(ctx, parsed),
    );
    revalidatePath(`/${parsed.gymSlug}/members`);
    revalidatePath(`/${parsed.gymSlug}/dashboard`);
    return member;
  });
}

export async function updateMemberAction(input: unknown): Promise<ActionResult<MemberDTO>> {
  return runAction(async () => {
    const parsed = updateMemberSchema.parse(input);
    const member = await withTenant(parsed.gymSlug, "member:write", (ctx) =>
      updateMember(ctx, parsed.memberId, parsed),
    );
    revalidatePath(`/${parsed.gymSlug}/members`);
    return member;
  });
}

export async function setMemberStatusAction(input: unknown): Promise<ActionResult<MemberDTO>> {
  return runAction(async () => {
    const parsed = setMemberStatusSchema.parse(input);
    const permission = parsed.status === "ARCHIVED" ? "member:archive" : "member:write";
    const member = await withTenant(parsed.gymSlug, permission, (ctx) =>
      setMemberStatus(ctx, parsed.memberId, parsed.status),
    );
    revalidatePath(`/${parsed.gymSlug}/members`);
    revalidatePath(`/${parsed.gymSlug}/dashboard`);
    return member;
  });
}
