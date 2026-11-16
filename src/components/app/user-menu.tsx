"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, RefreshCw } from "lucide-react";
import { logout, switchGym } from "@/server/auth/actions";
import { Button } from "@/components/ui/button";

export type SwitcherOption = { slug: string; name: string; role: string };

export function UserMenu({
  memberships,
  currentSlug,
}: {
  memberships: SwitcherOption[];
  currentSlug?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      {memberships.length > 1 ? (
        <div className="relative">
          <select
            aria-label="Switch gym"
            defaultValue={currentSlug}
            disabled={pending}
            className="h-9 max-w-[10rem] rounded-lg border bg-card px-2 text-sm"
            onChange={(e) => {
              const slug = e.target.value;
              startTransition(async () => {
                const result = await switchGym({ gymSlug: slug });
                if (result.ok) {
                  router.push(result.data.redirectTo);
                  router.refresh();
                }
              });
            }}
          >
            {memberships.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.name}
              </option>
            ))}
          </select>
          {pending ? (
            <RefreshCw className="pointer-events-none absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin" />
          ) : null}
        </div>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await logout();
            if (result.ok) {
              router.replace(result.data.redirectTo);
              router.refresh();
            }
          })
        }
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline">Sign out</span>
      </Button>
    </div>
  );
}
