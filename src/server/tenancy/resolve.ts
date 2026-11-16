import { cache } from "react";
import { prisma } from "@/server/db/client";
import { NotFoundError } from "@/server/db/errors";
import { isValidSlug } from "@/lib/routing";

/**
 * Slug -> gym. This is the ONLY place a URL segment becomes a tenant id.
 * Memoised per request via React cache(), so a page + its data fetches resolve
 * the slug once.
 *
 * Note this lookup is deliberately unscoped (it is how we discover the tenant),
 * which is exactly why it selects a narrow, non-sensitive set of columns and
 * never returns qrSecret or billing internals.
 */
export const gymPublicColumns = {
  id: true,
  name: true,
  slug: true,
  logoKey: true,
  status: true,
  billingStatus: true,
  timezone: true,
  currency: true,
  trialEndsAt: true,
  city: true,
} as const;

export type ResolvedGym = {
  id: string;
  name: string;
  slug: string;
  logoKey: string | null;
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  billingStatus: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELLED" | "UNPAID";
  timezone: string;
  currency: string;
  trialEndsAt: Date | null;
  city: string | null;
};

export const resolveGymBySlug = cache(async (slug: string): Promise<ResolvedGym | null> => {
  if (!isValidSlug(slug)) return null;
  const gym = await prisma.gym.findUnique({
    where: { slug },
    select: gymPublicColumns,
  });
  if (!gym) return null;
  return gym as ResolvedGym;
});

export async function requireGymBySlug(slug: string): Promise<ResolvedGym> {
  const gym = await resolveGymBySlug(slug);
  if (!gym || gym.status === "ARCHIVED") throw new NotFoundError("Gym");
  return gym;
}

export async function isSlugAvailable(slug: string): Promise<boolean> {
  if (!isValidSlug(slug)) return false;
  const existing = await prisma.gym.findUnique({ where: { slug }, select: { id: true } });
  return existing === null;
}

/** Is this tenant allowed to operate right now? Owners keep billing access. */
export function tenantAccessLevel(gym: ResolvedGym): "open" | "billing_only" | "closed" {
  if (gym.status === "ARCHIVED") return "closed";
  if (gym.status === "SUSPENDED") return "billing_only";
  const trialOver =
    gym.billingStatus === "TRIALING" &&
    gym.trialEndsAt !== null &&
    gym.trialEndsAt.getTime() < Date.now();
  if (trialOver || gym.billingStatus === "UNPAID" || gym.billingStatus === "CANCELLED") {
    return "billing_only";
  }
  return "open";
}
