"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Building2, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import type { BillingStatus, GymStatus } from "@/generated/prisma/client";
import { Alert, Badge, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { adminUpdateGymAction } from "@/server/saas/actions";
import type { AdminGymDTO } from "@/server/services/saas";

const GYM_STATUSES: readonly GymStatus[] = ["ACTIVE", "SUSPENDED", "ARCHIVED"];
const BILLING_STATUSES: readonly BillingStatus[] = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELLED",
  "UNPAID",
];

function AdminGymRow({
  gym,
  onResult,
}: {
  gym: AdminGymDTO;
  onResult: (feedback: { tone: "success" | "error"; message: string }) => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<GymStatus>(gym.status);
  const [billingStatus, setBillingStatus] = useState<BillingStatus>(gym.billingStatus);
  const [isPending, startTransition] = useTransition();

  const dirty = status !== gym.status || billingStatus !== gym.billingStatus;

  function handleSave() {
    startTransition(async () => {
      const res = await adminUpdateGymAction({
        gymId: gym.id,
        status,
        billingStatus,
      });
      if (!res.ok) {
        onResult({ tone: "error", message: res.error.message });
        return;
      }
      onResult({
        tone: "success",
        message: `Updated ${gym.name} (${res.data.status} / ${res.data.billingStatus}).`,
      });
      router.refresh();
    });
  }

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight">{gym.name}</h3>
            <Badge>/{gym.slug}</Badge>
            {gym.saasPlanName ? (
              <Badge>
                {gym.saasPlanName}
                {gym.saasSubscriptionStatus ? ` · ${gym.saasSubscriptionStatus}` : ""}
              </Badge>
            ) : (
              <Badge>No SaaS Plan</Badge>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            Owner: <span className="font-medium text-foreground">{gym.owner.name}</span> (
            {gym.owner.email})
          </p>

          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span>Members: {gym.memberCount}</span>
            <span>Active Subscriptions: {gym.activeSubscriptionCount}</span>
            <span>Currency: {gym.currency}</span>
            <span>
              Created:{" "}
              {new Date(gym.createdAt).toLocaleDateString("en-IN", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs font-medium">
            <span className="block text-muted-foreground">Gym Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as GymStatus)}
              disabled={isPending}
              className="h-9 rounded-lg border bg-card px-2.5 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {GYM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs font-medium">
            <span className="block text-muted-foreground">Billing Status</span>
            <select
              value={billingStatus}
              onChange={(e) => setBillingStatus(e.target.value as BillingStatus)}
              disabled={isPending}
              className="h-9 rounded-lg border bg-card px-2.5 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {BILLING_STATUSES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>

          <Button
            type="button"
            size="sm"
            disabled={isPending || !dirty}
            onClick={handleSave}
          >
            {isPending ? "Saving..." : "Save"}
          </Button>

          <Link
            href={`/${gym.slug}/dashboard`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-card px-3 text-xs font-medium transition-colors hover:bg-muted"
          >
            Dashboard
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </Card>
  );
}

export function AdminGymsPanel({ initialGyms }: { initialGyms: AdminGymDTO[] }) {
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(
    null,
  );

  const activeCount = initialGyms.filter((g) => g.status === "ACTIVE").length;
  const payingCount = initialGyms.filter((g) => g.billingStatus === "ACTIVE").length;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" aria-hidden />
              <CardTitle>Super-Admin Console</CardTitle>
            </div>
            <CardDescription>
              Platform-wide overview of all gyms, owners, member counts, and billing states.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>Total: {initialGyms.length}</Badge>
            <Badge>Active: {activeCount}</Badge>
            <Badge>Paying: {payingCount}</Badge>
          </div>
        </div>
      </Card>

      {feedback ? <Alert tone={feedback.tone}>{feedback.message}</Alert> : null}

      {initialGyms.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">No gyms found on the platform.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {initialGyms.map((gym) => (
            <AdminGymRow key={gym.id} gym={gym} onResult={setFeedback} />
          ))}
        </div>
      )}
    </div>
  );
}
