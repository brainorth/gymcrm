import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app/header";
import { StaffManager } from "@/components/staff/staff-manager";
import { can, requireTenant } from "@/server/auth/rbac";
import { ForbiddenError, UnauthenticatedError } from "@/server/db/errors";
import { listStaff } from "@/server/services/staff";

export default async function StaffPage({
  params,
}: {
  params: Promise<{ gymSlug: string }>;
}) {
  const { gymSlug } = await params;

  let ctx;
  try {
    ctx = await requireTenant(gymSlug, "staff:read");
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect(`/login?next=/${gymSlug}/staff`);
    if (error instanceof ForbiddenError) redirect(`/${gymSlug}/portal`);
    throw error;
  }

  const staff = await listStaff(ctx);
  const canWrite = ctx.role === "SUPER_ADMIN" || can(ctx.role, "staff:write");

  return (
    <>
      <AppHeader
        title={ctx.gym.name}
        subtitle={`gym.brainorth.com/${ctx.gym.slug} · Staff`}
        role={ctx.role}
        user={ctx.user}
        currentSlug={ctx.gym.slug}
      />
      <main className="mx-auto max-w-5xl px-5 py-6 pb-20 sm:pb-6">
        <StaffManager
          gymSlug={ctx.gym.slug}
          currentUserId={ctx.user.id}
          canWrite={canWrite}
          initialStaff={staff}
        />
      </main>
    </>
  );
}
