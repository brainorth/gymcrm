import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app/header";
import { GymSettingsForm } from "@/components/staff/gym-settings-form";
import { requireTenant } from "@/server/auth/rbac";
import { ForbiddenError, UnauthenticatedError } from "@/server/db/errors";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ gymSlug: string }>;
}) {
  const { gymSlug } = await params;

  let ctx;
  try {
    ctx = await requireTenant(gymSlug, "gym:settings");
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect(`/login?next=/${gymSlug}/settings`);
    if (error instanceof ForbiddenError) redirect(`/${gymSlug}/portal`);
    throw error;
  }

  return (
    <>
      <AppHeader
        title={ctx.gym.name}
        subtitle={`gym.brainorth.com/${ctx.gym.slug} · Settings`}
        role={ctx.role}
        user={ctx.user}
        currentSlug={ctx.gym.slug}
      />
      <main className="mx-auto max-w-5xl px-5 py-6 pb-20 sm:pb-6">
        <GymSettingsForm
          initialSettings={{
            id: ctx.gym.id,
            name: ctx.gym.name,
            slug: ctx.gym.slug,
            timezone: ctx.gym.timezone,
            currency: ctx.gym.currency,
          }}
        />
      </main>
    </>
  );
}
