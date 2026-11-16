import { redirect } from "next/navigation";
import { CalendarClock, QrCode, UserRound } from "lucide-react";
import { AppHeader } from "@/components/app/header";
import { Alert, Badge, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { requireTenant } from "@/server/auth/rbac";
import { ForbiddenError, UnauthenticatedError } from "@/server/db/errors";
import { gymLocalDate, toInputValue } from "@/lib/dates";

export default async function MemberPortalPage({
  params,
}: {
  params: Promise<{ gymSlug: string }>;
}) {
  const { gymSlug } = await params;

  let ctx;
  try {
    ctx = await requireTenant(gymSlug, "portal:self");
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect(`/login?next=/${gymSlug}/portal`);
    throw error;
  }

  if (ctx.role !== "MEMBER") {
    return (
      <main className="mx-auto max-w-md px-5 py-10">
        <Alert tone="info">
          The member portal is for member accounts. Staff and owners should use the{" "}
          <a className="underline" href={`/${gymSlug}/dashboard`}>
            dashboard
          </a>
          .
        </Alert>
      </main>
    );
  }

  // A member can only ever load their OWN profile — scoped twice: by the guard
  // (gymId) and by userId.
  const profile = await ctx.db.memberProfile.findFirst({
    where: { userId: ctx.user.id },
    select: { id: true, fullName: true, memberCode: true, status: true },
  });

  const subscription = profile
    ? await ctx.db.memberSubscription.findFirst({
        where: { memberId: profile.id, status: "ACTIVE" },
        orderBy: { effectiveEndDate: "desc" },
        select: { id: true, effectiveEndDate: true, freezeDaysUsed: true },
      })
    : null;

  const today = gymLocalDate(new Date(), ctx.gym.timezone);
  const checkedIn = profile
    ? await ctx.db.attendance.findFirst({
        where: { memberId: profile.id, localDate: today },
        select: { id: true, checkInTime: true },
      })
    : null;

  return (
    <>
      <AppHeader
        title={ctx.gym.name}
        subtitle="Member portal"
        role={ctx.role}
        user={ctx.user}
        currentSlug={ctx.gym.slug}
      />
      <main className="mx-auto max-w-md space-y-4 px-5 py-6">
        {!profile ? (
          <Alert tone="info">
            Your account isn&apos;t linked to a member profile yet. Ask the front desk to link it.
          </Alert>
        ) : (
          <>
            <Card>
              <div className="flex items-center gap-2">
                <UserRound className="h-5 w-5 text-primary" aria-hidden />
                <CardTitle className="text-base">{profile.fullName}</CardTitle>
              </div>
              <CardDescription className="mt-1">
                Member ID {profile.memberCode} · <Badge>{profile.status.toLowerCase()}</Badge>
              </CardDescription>
            </Card>

            <Card>
              <div className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-primary" aria-hidden />
                <CardTitle className="text-base">Membership</CardTitle>
              </div>
              {subscription ? (
                <CardDescription className="mt-1">
                  Valid through {toInputValue(subscription.effectiveEndDate)}
                  {subscription.freezeDaysUsed > 0
                    ? ` · ${subscription.freezeDaysUsed} frozen days applied`
                    : ""}
                </CardDescription>
              ) : (
                <CardDescription className="mt-1">
                  No active membership. Contact the front desk to renew.
                </CardDescription>
              )}
            </Card>

            <Card>
              <div className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-primary" aria-hidden />
                <CardTitle className="text-base">Today&apos;s attendance</CardTitle>
              </div>
              <CardDescription className="mt-1">
                {checkedIn
                  ? `Checked in at ${checkedIn.checkInTime.toLocaleTimeString("en-IN", { timeZone: ctx.gym.timezone, hour: "2-digit", minute: "2-digit" })}`
                  : "Not checked in yet. Scan the code at the front desk."}
              </CardDescription>
            </Card>
          </>
        )}
      </main>
    </>
  );
}
