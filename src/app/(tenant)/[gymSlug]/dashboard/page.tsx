import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarClock,
  CalendarPlus,
  CreditCard,
  IndianRupee,
  Phone,
  QrCode,
  UserPlus,
  Users,
} from "lucide-react";
import { AppHeader } from "@/components/app/header";
import { Badge, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { requireTenant } from "@/server/auth/rbac";
import { ForbiddenError, UnauthenticatedError } from "@/server/db/errors";
import { getDashboardSummary } from "@/server/services/dashboard";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ gymSlug: string }>;
}) {
  const { gymSlug } = await params;

  let ctx;
  try {
    ctx = await requireTenant(gymSlug, "member:read");
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect(`/login?next=/${gymSlug}/dashboard`);
    if (error instanceof ForbiddenError) redirect(`/${gymSlug}/portal`);
    throw error;
  }

  const summary = await getDashboardSummary(ctx);

  const stats = [
    { icon: Users, label: "Active members", value: summary.activeMembers },
    { icon: CalendarClock, label: "Live memberships", value: summary.activeSubscriptions },
    { icon: QrCode, label: "Check-ins today", value: summary.checkInsToday },
  ];

  const quickActions = [
    { label: "Add member", href: `/${ctx.gym.slug}/members`, icon: UserPlus },
    { label: "Enroll / Renew", href: `/${ctx.gym.slug}/subscriptions`, icon: CalendarPlus },
    { label: "Check in", href: `/${ctx.gym.slug}/attendance`, icon: QrCode },
    { label: "Plans", href: `/${ctx.gym.slug}/plans`, icon: CreditCard },
  ];

  return (
    <>
      <AppHeader
        title={ctx.gym.name}
        subtitle={`gym.brainorth.com/${ctx.gym.slug} · ${ctx.gym.timezone}`}
        role={ctx.role}
        user={ctx.user}
        currentSlug={ctx.gym.slug}
      />
      <main className="mx-auto max-w-5xl space-y-5 px-5 py-6 pb-20 sm:pb-6">
        {ctx.impersonating ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardTitle className="text-base">Super-admin support session</CardTitle>
            <CardDescription>
              You are viewing this gym as platform staff. Every action is written to the audit log.
            </CardDescription>
          </Card>
        ) : null}

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {quickActions.map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 rounded-xl border bg-card px-4 py-3 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
            >
              <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span className="truncate">{label}</span>
            </Link>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {stats.map(({ icon: Icon, label, value }) => (
            <Card key={label}>
              <Icon className="h-5 w-5 text-primary" aria-hidden />
              <p className="mt-3 text-3xl font-semibold tabular-nums">{value}</p>
              <CardDescription>{label}</CardDescription>
            </Card>
          ))}
        </section>

        {summary.revenue ? (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <div className="flex items-center justify-between">
                <CardDescription>Collected today</CardDescription>
                <IndianRupee className="h-4 w-4 text-primary" aria-hidden />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {formatMoney(summary.revenue.todayMinor, ctx.gym.currency)}
              </p>
            </Card>
            <Card>
              <div className="flex items-center justify-between">
                <CardDescription>Collected this month</CardDescription>
                <IndianRupee className="h-4 w-4 text-primary" aria-hidden />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {formatMoney(summary.revenue.monthMinor, ctx.gym.currency)}
              </p>
            </Card>
          </section>
        ) : null}

        <Card>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Expiring in the next 7 days</CardTitle>
              <CardDescription className="mt-0.5">
                Follow up early to keep renewals on time.
              </CardDescription>
            </div>
            <Link
              href={`/${ctx.gym.slug}/subscriptions`}
              className="text-xs font-medium text-primary hover:underline"
            >
              View all
            </Link>
          </div>

          {summary.expiringSoon.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No memberships expiring in the next 7 days.
            </p>
          ) : (
            <div className="mt-3 divide-y rounded-lg border">
              {summary.expiringSoon.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.memberName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.planName} · Ends {item.effectiveEndDate}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge>{item.daysLeft === 0 ? "Today" : `${item.daysLeft}d left`}</Badge>
                    <a
                      href={`tel:${item.memberPhone}`}
                      aria-label={`Call ${item.memberName}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border hover:bg-muted"
                    >
                      <Phone className="h-3.5 w-3.5 text-primary" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </main>
    </>
  );
}
