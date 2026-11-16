import { Badge } from "@/components/ui/card";
import { UserMenu } from "./user-menu";
import type { SessionMembership } from "@/server/auth/session";

export function AppHeader({
  title,
  subtitle,
  role,
  user,
  currentSlug,
}: {
  title: string;
  subtitle?: string;
  role: string;
  user: { name: string; memberships: SessionMembership[] };
  currentSlug?: string;
}) {
  return (
    <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
            <Badge className="shrink-0">{role.replace("_", " ").toLowerCase()}</Badge>
          </div>
          {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        <UserMenu
          currentSlug={currentSlug}
          memberships={user.memberships.map((m) => ({
            slug: m.gymSlug,
            name: m.gymName,
            role: m.role,
          }))}
        />
      </div>
    </header>
  );
}
