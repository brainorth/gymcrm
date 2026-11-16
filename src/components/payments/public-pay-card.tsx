"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CreditCard, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { completeMockPaymentAction } from "@/server/payments/link-actions";
import type { PublicPaymentLinkDTO } from "@/server/services/payment-links";

const STATUS_LABELS: Record<PublicPaymentLinkDTO["status"], string> = {
  CREATED: "Pending Payment",
  PAID: "Paid",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

export function PublicPayCard({
  link,
  isMockMode,
}: {
  link: PublicPaymentLinkDTO;
  isMockMode: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(link.status);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleMockPay() {
    setError(null);
    startTransition(async () => {
      const res = await completeMockPaymentAction(link.shortCode);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setStatus("PAID");
      router.refresh();
    });
  }

  return (
    <Card className="w-full max-w-md space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {link.gymName}
          </p>
          <CardTitle className="mt-1">Membership Payment</CardTitle>
          <CardDescription>For {link.memberName}</CardDescription>
        </div>
        <Badge
          className={
            status === "PAID"
              ? "border-primary/40 bg-primary/10 text-primary"
              : status === "EXPIRED" || status === "CANCELLED"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : undefined
          }
        >
          {STATUS_LABELS[status]}
        </Badge>
      </div>

      <div className="rounded-lg border bg-muted/40 p-4">
        <p className="text-xs text-muted-foreground">Amount due</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight">
          {formatMoney(link.amountMinor, link.currency)}
        </p>
        {link.expiresAt && status === "CREATED" ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Expires {new Date(link.expiresAt).toLocaleString()}
          </p>
        ) : null}
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {status === "PAID" ? (
        <Alert tone="success">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            <span>Payment received</span>
          </div>
          {link.paidAt ? (
            <p className="mt-1 text-xs opacity-90">
              Completed on {new Date(link.paidAt).toLocaleString()}
            </p>
          ) : null}
        </Alert>
      ) : null}

      {status === "EXPIRED" ? (
        <Alert tone="error">
          This payment link has expired. Ask {link.gymName} for a new link.
        </Alert>
      ) : null}

      {status === "CANCELLED" ? (
        <Alert tone="error">
          This payment link was cancelled. Ask {link.gymName} for assistance.
        </Alert>
      ) : null}

      {status === "CREATED" && isMockMode ? (
        <div className="space-y-3">
          <Button
            type="button"
            className="w-full"
            disabled={isPending}
            onClick={handleMockPay}
          >
            <CreditCard className="h-4 w-4" aria-hidden />
            {isPending ? "Completing test payment..." : "Complete Test Payment"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Test mode is active (`PAYMENTS_DRIVER=mock`). No real charge will be made.
          </p>
        </div>
      ) : null}

      {status === "CREATED" && !isMockMode ? (
        <Alert tone="info">
          Online checkout via Razorpay is enabled. Use your Razorpay payment link or order
          checkout to complete this payment.
        </Alert>
      ) : null}

      <div className="flex items-center justify-center gap-1.5 border-t pt-4 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        <span>Reference: {link.shortCode}</span>
      </div>
    </Card>
  );
}
