import Link from "next/link";
import { ArrowRight, CalendarCheck, IndianRupee, QrCode, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

const FEATURES = [
  {
    icon: Users,
    title: "Members, not spreadsheets",
    body: "Photos, ID proof, emergency contacts and signed waivers on every profile.",
  },
  {
    icon: IndianRupee,
    title: "Cash, card or payment link",
    body: "Record payments in seconds, send a link, and issue a numbered invoice.",
  },
  {
    icon: QrCode,
    title: "QR attendance that can't be faked",
    body: "Rotating codes at the front desk. Expired members are blocked automatically.",
  },
  {
    icon: CalendarCheck,
    title: "Renewals that chase themselves",
    body: "Expiring memberships and dues nudged over email and WhatsApp.",
  },
];

export default function MarketingPage() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:py-16">
      <header className="flex items-center justify-between">
        <span className="text-lg font-bold tracking-tight">GymFlow</span>
        <div className="flex items-center gap-2">
          <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Sign in
          </Link>
          <Link href="/register" className={buttonVariants({ size: "sm" })}>
            Start free
          </Link>
        </div>
      </header>

      <section className="py-12 sm:py-20">
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
          Run your gym. <span className="text-primary">We&apos;ll run the paperwork.</span>
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground">
          Members, plans, payments, attendance and renewals — one clean app your staff can
          use on a phone at the front desk.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/register" className={buttonVariants({ size: "lg" })}>
            Register your gym <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/login" className={buttonVariants({ variant: "outline", size: "lg" })}>
            I already have an account
          </Link>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          14-day trial. Your own URL: gym.brainorth.com/your-gym
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <Card key={title}>
            <Icon className="h-5 w-5 text-primary" aria-hidden />
            <CardTitle className="mt-3 text-base">{title}</CardTitle>
            <CardDescription className="mt-1">{body}</CardDescription>
          </Card>
        ))}
      </section>

      <footer className="mt-16 border-t pt-6 text-sm text-muted-foreground">
        Foundation module: own auth, tenant isolation, Razorpay-ready payments.
      </footer>
    </main>
  );
}
