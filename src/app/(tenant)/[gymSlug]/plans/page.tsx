import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app/header";
import { PlansManager } from "@/components/plans/plans-manager";
import { can, requireTenant } from "@/server/auth/rbac";
import { ForbiddenError, UnauthenticatedError } from "@/server/db/errors";
import { listPlans } from "@/server/services/plans";

export default async function PlansPage({
  params,
}: {
  params: Promise<{ gymSlug: string }>;
}) {
  const { gymSlug } = await params;

  let ctx;
  try {
    ctx = await requireTenant(gymSlug, "plan:read");
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect(`/login?next=/${gymSlug}/plans`);
    if (error instanceof ForbiddenError) redirect(`/${gymSlug}/portal`);
    throw error;
  }

  const plans = await listPlans(ctx);
  const canWrite = ctx.role === "SUPER_ADMIN" || can(ctx.role, "plan:write");

  return (
    <>
      <AppHeader
        title={ctx.gym.name}
        subtitle={`gym.brainorth.com/${ctx.gym.slug} · Plans`}
        role={ctx.role}
        user={ctx.user}
        currentSlug={ctx.gym.slug}
      />
      <main className="mx-auto max-w-5xl px-5 py-6 pb-20 sm:pb-6">
        <PlansManager
          gymSlug={ctx.gym.slug}
          currency={ctx.gym.currency}
          canWrite={canWrite}
          initialPlans={plans}
        />
      </main>
    </>
  );
}
