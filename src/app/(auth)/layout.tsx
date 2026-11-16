import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <Link href="/" className="mb-6 text-center text-lg font-bold tracking-tight">
        GymFlow
      </Link>
      <div className="rounded-[var(--radius-card)] border bg-card p-6 shadow-sm">{children}</div>
    </main>
  );
}
