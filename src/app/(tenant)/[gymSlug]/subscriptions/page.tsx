import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app/header";
import { SubscriptionsManager } from "@/components/subscriptions/subscriptions-manager";
import { localDateString } from "@/lib/dates";
import { can, requireTenant } from "@/server/auth/rbac";
import { ForbiddenError, UnauthenticatedError } from "@/server/db/errors";
import { listMembers } from "@/server/services/members";
import { listPlans } from "@/server/services/plans";
import { listSubscriptions } from "@/server/services/subscriptions";

export default async function SubscriptionsPage({
  params,
}: {
  params: Promise<{ gymSlug: string }>;
}) {
  const { gymSlug } = await params;

  let ctx;
  try {
    ctx = await requireTenant(gymSlug, "subscription:read");
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect(`/login?next=/${gymSlug}/subscriptions`);
    if (error instanceof ForbiddenError) redirect(`/${gymSlug}/portal`);
    throw error;
  }

  const [subscriptions, members, plans] = await Promise.all([
    listSubscriptions(ctx),
    listMembers(ctx),
    listPlans(ctx),
  ]);

  const canWrite = ctx.role === "SUPER_ADMIN" || can(ctx.role, "subscription:write");
  const canFreeze = ctx.role === "SUPER_ADMIN" || can(ctx.role, "subscription:freeze");
  const canRecordPayment = ctx.role === "SUPER_ADMIN" || can(ctx.role, "payment:record");
  const todayIso = localDateString(new Date(), ctx.gym.timezone);

  return (
    <>
      <AppHeader
        title={ctx.gym.name}
        subtitle={`gym.brainorth.com/${ctx.gym.slug} · Memberships`}
        role={ctx.role}
        user={ctx.user}
        currentSlug={ctx.gym.slug}
      />
      <main className="mx-auto max-w-5xl px-5 py-6 pb-20 sm:pb-6">
        <SubscriptionsManager
          gymSlug={ctx.gym.slug}
          currency={ctx.gym.currency}
          todayIso={todayIso}
          canWrite={canWrite}
          canFreeze={canFreeze}
          canRecordPayment={canRecordPayment}
          initialSubscriptions={subscriptions}
          members={members}
          plans={plans}
        />
      </main>
    </>
  );
}
