import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app/header";
import { MembersManager } from "@/components/members/members-manager";
import { can, requireTenant } from "@/server/auth/rbac";
import { ForbiddenError, UnauthenticatedError } from "@/server/db/errors";
import { listMembers } from "@/server/services/members";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ gymSlug: string }>;
}) {
  const { gymSlug } = await params;

  let ctx;
  try {
    ctx = await requireTenant(gymSlug, "member:read");
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect(`/login?next=/${gymSlug}/members`);
    if (error instanceof ForbiddenError) redirect(`/${gymSlug}/portal`);
    throw error;
  }

  const members = await listMembers(ctx);
  const canWrite = ctx.role === "SUPER_ADMIN" || can(ctx.role, "member:write");
  const canArchive = ctx.role === "SUPER_ADMIN" || can(ctx.role, "member:archive");

  return (
    <>
      <AppHeader
        title={ctx.gym.name}
        subtitle={`gym.brainorth.com/${ctx.gym.slug} · Members`}
        role={ctx.role}
        user={ctx.user}
        currentSlug={ctx.gym.slug}
      />
      <main className="mx-auto max-w-5xl px-5 py-6 pb-20 sm:pb-6">
        <MembersManager
          gymSlug={ctx.gym.slug}
          canWrite={canWrite}
          canArchive={canArchive}
          initialMembers={members}
        />
      </main>
    </>
  );
}
