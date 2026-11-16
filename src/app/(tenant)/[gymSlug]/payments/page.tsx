import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app/header";
import { PaymentsManager } from "@/components/payments/payments-manager";
import { can, requireTenant } from "@/server/auth/rbac";
import { ForbiddenError, UnauthenticatedError } from "@/server/db/errors";
import { listPayments } from "@/server/services/payments";

export default async function PaymentsPage({
  params,
}: {
  params: Promise<{ gymSlug: string }>;
}) {
  const { gymSlug } = await params;

  let ctx;
  try {
    ctx = await requireTenant(gymSlug, "payment:read");
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect(`/login?next=/${gymSlug}/payments`);
    if (error instanceof ForbiddenError) redirect(`/${gymSlug}/portal`);
    throw error;
  }

  const payments = await listPayments(ctx);

  const canRefund = ctx.role === "SUPER_ADMIN" || can(ctx.role, "payment:refund");
  const canIssueInvoice = ctx.role === "SUPER_ADMIN" || can(ctx.role, "invoice:write");

  return (
    <>
      <AppHeader
        title={ctx.gym.name}
        subtitle={`gym.brainorth.com/${ctx.gym.slug} · Payments`}
        role={ctx.role}
        user={ctx.user}
        currentSlug={ctx.gym.slug}
      />
      <main className="mx-auto max-w-5xl px-5 py-6 pb-20 sm:pb-6">
        <PaymentsManager
          gymSlug={ctx.gym.slug}
          currency={ctx.gym.currency}
          canRefund={canRefund}
          canIssueInvoice={canIssueInvoice}
          initialPayments={payments}
        />
      </main>
    </>
  );
}
