"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarClock,
  CreditCard,
  IndianRupee,
  LayoutDashboard,
  QrCode,
  Receipt,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  roles?: readonly string[];
};

export function TenantNav({ gymSlug, role }: { gymSlug: string; role: string }) {
  const pathname = usePathname();
  const base = `/${gymSlug}`;

  const allItems: NavItem[] = [
    { label: "Overview", href: `${base}/dashboard`, icon: LayoutDashboard },
    { label: "Members", href: `${base}/members`, icon: Users },
    { label: "Plans", href: `${base}/plans`, icon: CreditCard },
    { label: "Subs", href: `${base}/subscriptions`, icon: CalendarClock },
    { label: "Check-in", href: `${base}/attendance`, icon: QrCode },
    {
      label: "Payments",
      href: `${base}/payments`,
      icon: IndianRupee,
      roles: ["GYM_OWNER", "STAFF", "SUPER_ADMIN"],
    },
    {
      label: "Staff",
      href: `${base}/staff`,
      icon: ShieldCheck,
      roles: ["GYM_OWNER", "SUPER_ADMIN"],
    },
    {
      label: "Settings",
      href: `${base}/settings`,
      icon: Settings,
      roles: ["GYM_OWNER", "SUPER_ADMIN"],
    },
    {
      label: "Billing",
      href: `${base}/billing`,
      icon: Receipt,
      roles: ["GYM_OWNER", "SUPER_ADMIN"],
    },
  ];

  const items = allItems.filter((item) => !item.roles || item.roles.includes(role));

  return (
    <nav
      aria-label="Gym navigation"
      className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 backdrop-blur sm:static sm:border-t-0 sm:border-b sm:bg-transparent sm:backdrop-blur-none"
    >
      <div className="mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-2 py-1.5 sm:px-5 sm:py-2">
        {items.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex min-w-[64px] shrink-0 flex-col items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors sm:min-w-0 sm:flex-row sm:gap-2 sm:px-3 sm:py-1.5 sm:text-sm",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
