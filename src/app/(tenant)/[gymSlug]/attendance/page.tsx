import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app/header";
import { AttendanceManager } from "@/components/attendance/attendance-manager";
import { DeskCodeCard } from "@/components/attendance/desk-code-card";
import { localDateString } from "@/lib/dates";
import { generateDeskCheckInCode } from "@/server/attendance/qr";
import { can, requireTenant } from "@/server/auth/rbac";
import { ForbiddenError, UnauthenticatedError } from "@/server/db/errors";
import { listAttendanceByDate } from "@/server/services/attendance";
import { listMembers } from "@/server/services/members";

export default async function AttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ gymSlug: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { gymSlug } = await params;
  const { date } = await searchParams;

  let ctx;
  try {
    ctx = await requireTenant(gymSlug, "attendance:read");
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect(`/login?next=/${gymSlug}/attendance`);
    if (error instanceof ForbiddenError) redirect(`/${gymSlug}/portal`);
    throw error;
  }

  const todayIso = localDateString(new Date(), ctx.gym.timezone);
  const selectedDate =
    date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayIso;

  const [records, members] = await Promise.all([
    listAttendanceByDate(ctx, selectedDate),
    listMembers(ctx, { status: "ACTIVE" }),
  ]);

  const canMark = ctx.role === "SUPER_ADMIN" || can(ctx.role, "attendance:mark");
  const deskCode = canMark ? generateDeskCheckInCode(ctx.gym.id) : null;

  return (
    <>
      <AppHeader
        title={ctx.gym.name}
        subtitle={`gym.brainorth.com/${ctx.gym.slug} · Attendance`}
        role={ctx.role}
        user={ctx.user}
        currentSlug={ctx.gym.slug}
      />
      <main className="mx-auto max-w-5xl space-y-5 px-5 py-6 pb-20 sm:pb-6">
        {deskCode ? (
          <DeskCodeCard code={deskCode.code} expiresInSeconds={deskCode.expiresInSeconds} />
        ) : null}
        <AttendanceManager
          gymSlug={ctx.gym.slug}
          timezone={ctx.gym.timezone}
          selectedDate={selectedDate}
          todayIso={todayIso}
          canMark={canMark}
          initialRecords={records}
          members={members}
        />
      </main>
    </>
  );
}
