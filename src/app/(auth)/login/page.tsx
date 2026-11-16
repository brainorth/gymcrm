import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { getCurrentSession, landingPathFor } from "@/server/auth/session";

export const metadata = { title: "Sign in — GymFlow" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const params = await searchParams;
  const session = await getCurrentSession();
  if (session) redirect(landingPathFor(session.user));

  // Only allow same-site relative redirects.
  const next = params.next?.startsWith("/") && !params.next.startsWith("//") ? params.next : undefined;

  return (
    <div className="space-y-5">
      <div>
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>Sign in to your gym dashboard or member portal.</CardDescription>
      </div>
      {params.reset ? (
        <p className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm text-primary">
          Password updated. Sign in with your new password.
        </p>
      ) : null}
      <LoginForm next={next} />
    </div>
  );
}
