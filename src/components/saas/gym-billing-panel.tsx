"use client";

import { useState, useTransition } from "react";
import { Check, CreditCard, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { selectSaasPlanAction } from "@/server/saas/actions";
import type { GymBillingOverviewDTO, SaasPlanDTO } from "@/server/services/saas";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function extractFeatureList(features: unknown): string[] {
  if (Array.isArray(features)) {
    return features.filter((item): item is string => typeof item === "string");
  }
  if (features && typeof features === "object") {
    return Object.entries(features as Record<string, unknown>)
      .filter(([, value]) => Boolean(value))
      .map(([key, value]) => (typeof value === "string" ? value : `${key}: ${String(value)}`));
  }
  return [];
}

export function GymBillingPanel({ initialOverview }: { initialOverview: GymBillingOverviewDTO }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(
    null,
  );

  const { gym, subscription, plans } = initialOverview;

  function handleSelectPlan(plan: SaasPlanDTO) {
    setFeedback(null);
    setPendingPlanId(plan.id);
    startTransition(async () => {
      const res = await selectSaasPlanAction({
        gymSlug: gym.slug,
        saasPlanId: plan.id,
      });
      setPendingPlanId(null);
      if (!res.ok) {
        setFeedback({ tone: "error", message: res.error.message });
        return;
      }
      setFeedback({
        tone: "success",
        message: `Subscribed to ${plan.name}. Billing status is now ${res.data.billingStatus}.`,
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" aria-hidden />
              <CardTitle>Platform SaaS Billing</CardTitle>
            </div>
            <CardDescription>
              Manage {gym.name}&apos;s platform subscription and billing status.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Gym: {gym.status}</Badge>
            <Badge>Billing: {gym.billingStatus}</Badge>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border bg-muted/30 p-3.5">
            <p className="text-xs font-medium text-muted-foreground">Current Plan</p>
            <p className="mt-1 text-base font-semibold">
              {subscription ? subscription.planName : "No plan selected"}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3.5">
            <p className="text-xs font-medium text-muted-foreground">Subscription Status</p>
            <p className="mt-1 text-base font-semibold">
              {subscription ? subscription.status : gym.billingStatus}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3.5">
            <p className="text-xs font-medium text-muted-foreground">
              {gym.billingStatus === "TRIALING" && gym.trialEndsAt
                ? "Trial Ends"
                : "Current Period Ends"}
            </p>
            <p className="mt-1 text-base font-semibold">
              {subscription?.currentPeriodEnd
                ? formatDate(subscription.currentPeriodEnd)
                : formatDate(gym.trialEndsAt)}
            </p>
          </div>
        </div>
      </Card>

      {feedback ? <Alert tone={feedback.tone}>{feedback.message}</Alert> : null}

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Available Plans</h2>
          <p className="text-sm text-muted-foreground">
            Choose a plan that fits your gym&apos;s member and staff capacity.
          </p>
        </div>

        {plans.length === 0 ? (
          <Card>
            <p className="text-sm text-muted-foreground">
              No active SaaS plans are currently configured.
            </p>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {plans.map((plan) => {
              const isCurrent = subscription?.planId === plan.id;
              const features = extractFeatureList(plan.features);
              const isSelectingThis = isPending && pendingPlanId === plan.id;

              return (
                <Card
                  key={plan.id}
                  className={isCurrent ? "border-primary ring-1 ring-primary/30" : undefined}
                >
                  <div className="flex h-full flex-col justify-between gap-5">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-base font-semibold">{plan.name}</h3>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            {plan.code}
                          </p>
                        </div>
                        {isCurrent ? <Badge>Current</Badge> : null}
                      </div>

                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold tracking-tight">
                          {formatMoney(plan.priceMinor, plan.currency)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          / {plan.interval === "YEAR" ? "year" : "month"}
                        </span>
                      </div>

                      <div className="space-y-1.5 border-t pt-3 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-primary shrink-0" aria-hidden />
                          <span>
                            {plan.maxMembers !== null
                              ? `Up to ${plan.maxMembers} members`
                              : "Unlimited members"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-primary shrink-0" aria-hidden />
                          <span>
                            {plan.maxStaff !== null
                              ? `Up to ${plan.maxStaff} staff accounts`
                              : "Unlimited staff accounts"}
                          </span>
                        </div>
                        {features.map((feat) => (
                          <div key={feat} className="flex items-center gap-2">
                            <Check className="h-4 w-4 text-primary shrink-0" aria-hidden />
                            <span>{feat}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant={isCurrent ? "outline" : "default"}
                      disabled={isPending || isCurrent}
                      onClick={() => handleSelectPlan(plan)}
                      className="w-full"
                    >
                      {isSelectingThis
                        ? "Updating..."
                        : isCurrent
                          ? "Current Plan"
                          : "Select Plan"}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
