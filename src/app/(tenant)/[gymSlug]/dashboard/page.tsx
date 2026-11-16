import { redirect } from "next/navigation";
import { CalendarClock, IndianRupee, QrCode, ShieldCheck, Users } from "lucide-react";
import { AppHeader } from "@/components/app/header";
import { Badge, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { requireTenant, ROLE_PERMISSIONS, type Permission } from "@/server/auth/rbac";
import { ForbiddenError, UnauthenticatedError } from "@/server/db/errors";
import { gymLocalDate } from "@/lib/dates";

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

  const today = gymLocalDate(new Date(), ctx.gym.timezone);

  // Every one of these runs through tenantDb(gym.id) — no gymId in sight,
  // because the guard injects it. This is what module code will look like.
  const [memberCount, activeSubs, checkInsToday] = await Promise.all([
    ctx.db.memberProfile.count({ where: { status: "ACTIVE" } }),
    ctx.db.memberSubscription.count({ where: { status: "ACTIVE" } }),
    ctx.db.attendance.count({ where: { localDate: today } }),
  ]);

  const permissions: readonly Permission[] =
    ctx.role === "SUPER_ADMIN" ? ROLE_PERMISSIONS.GYM_OWNER : ROLE_PERMISSIONS[ctx.role];

  const stats = [
    { icon: Users, label: "Active members", value: memberCount },
    { icon: CalendarClock, label: "Active memberships", value: activeSubs },
    { icon: QrCode, label: "Check-ins today", value: checkInsToday },
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
      <main className="mx-auto max-w-5xl space-y-5 px-5 py-6">
        {ctx.impersonating ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardTitle className="text-base">Super-admin support session</CardTitle>
            <CardDescription>
              You are viewing this gym as platform staff. Every action is written to the audit log.
            </CardDescription>
          </Card>
        ) : null}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {stats.map(({ icon: Icon, label, value }) => (
            <Card key={label}>
              <Icon className="h-5 w-5 text-primary" aria-hidden />
              <p className="mt-3 text-3xl font-semibold tabular-nums">{value}</p>
              <CardDescription>{label}</CardDescription>
            </Card>
          ))}
        </section>

        <Card>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
            <CardTitle className="text-base">Foundation is live</CardTitle>
          </div>
          <CardDescription className="mt-1">
            Signed in as {ctx.user.name} · role resolved from your membership in this gym, not a
            global flag. All queries above were auto-scoped to gymId{" "}
            <code className="rounded bg-muted px-1">{ctx.gym.id.slice(0, 8)}…</code>
          </CardDescription>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {permissions.map((p) => (
              <Badge key={p}>{p}</Badge>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle className="text-base">Next modules</CardTitle>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            <li>· Member onboarding (photo, ID proof, waiver, emergency contact)</li>
            <li>· Plans, subscriptions, freezing</li>
            <li>· Payments + invoices (Razorpay adapter is wired, keys pending)</li>
            <li>· Rotating-QR attendance</li>
            <li>· Revenue analytics + renewal alerts</li>
          </ul>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <IndianRupee className="h-3.5 w-3.5" /> Revenue analytics are owner-only — staff roles
            cannot see gym totals.
          </p>
        </Card>
      </main>
    </>
  );
}
