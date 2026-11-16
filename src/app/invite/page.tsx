import Link from "next/link";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";

export const metadata = { title: "Accept invite — GymFlow" };

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <Link href="/" className="mb-6 text-center text-lg font-bold tracking-tight">
        GymFlow
      </Link>
      <div className="rounded-[var(--radius-card)] border bg-card p-6 shadow-sm">
        <AcceptInviteForm token={token ?? ""} />
      </div>
    </main>
  );
}
