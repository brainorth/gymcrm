"use client";

import { useMemo, useState } from "react";
import { FileText, Loader2, RotateCcw, Search, X } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { issueInvoiceAction, refundPaymentAction } from "@/server/payments/actions";
import type { PaymentDTO } from "@/server/services/payments";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";

type Props = {
  gymSlug: string;
  currency: string;
  canRefund: boolean;
  canIssueInvoice: boolean;
  initialPayments: PaymentDTO[];
};

const METHOD_LABEL: Record<PaymentDTO["method"], string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  BANK_TRANSFER: "Bank transfer",
  ONLINE: "Online",
  OTHER: "Other",
};

export function PaymentsManager({
  gymSlug,
  currency,
  canRefund,
  canIssueInvoice,
  initialPayments,
}: Props) {
  const [payments, setPayments] = useState<PaymentDTO[]>(initialPayments);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [refundingPayment, setRefundingPayment] = useState<PaymentDTO | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundBusy, setRefundBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter(
      (p) =>
        p.memberName.toLowerCase().includes(q) ||
        p.memberPhone.toLowerCase().includes(q) ||
        p.memberCode.toLowerCase().includes(q) ||
        (p.planName?.toLowerCase().includes(q) ?? false) ||
        (p.invoiceNumber?.toLowerCase().includes(q) ?? false),
    );
  }, [payments, search]);

  async function handleIssueInvoice(payment: PaymentDTO) {
    setBusyId(payment.id);
    setBannerError(null);
    const result = await issueInvoiceAction({ gymSlug, paymentId: payment.id });
    setBusyId(null);
    if (!result.ok) {
      setBannerError(result.error.message);
      return;
    }
    setPayments((prev) => prev.map((p) => (p.id === result.data.id ? result.data : p)));
  }

  function openRefundForm(payment: PaymentDTO) {
    const remainingMinor = Math.max(0, payment.amountMinor - payment.refundedMinor);
    setRefundingPayment(payment);
    setRefundAmount(String(remainingMinor / 100));
    setRefundReason("");
    setBannerError(null);
  }

  async function submitRefund(e: React.FormEvent) {
    e.preventDefault();
    if (!refundingPayment) return;
    setRefundBusy(true);
    setBannerError(null);
    const result = await refundPaymentAction({
      gymSlug,
      paymentId: refundingPayment.id,
      amountMajor: Number(refundAmount),
      reason: refundReason,
    });
    setRefundBusy(false);
    if (!result.ok) {
      setBannerError(result.error.message);
      return;
    }
    setPayments((prev) => prev.map((p) => (p.id === result.data.id ? result.data : p)));
    setRefundingPayment(null);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Payments &amp; Invoices</h2>
        <p className="text-sm text-muted-foreground">
          Review collected payments, issue tax invoices, and process refunds.
        </p>
      </div>

      {bannerError ? <Alert tone="error">{bannerError}</Alert> : null}

      {refundingPayment ? (
        <Card className="border-primary/40">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">
              Refund payment — {refundingPayment.memberName} (
              {formatMoney(
                refundingPayment.amountMinor - refundingPayment.refundedMinor,
                refundingPayment.currency,
              )}{" "}
              refundable)
            </CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setRefundingPayment(null)}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <form onSubmit={submitRefund} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={`Refund amount (${currency})`} htmlFor="refund-amount">
              <Input
                id="refund-amount"
                type="number"
                step="0.01"
                min="0.01"
                max={(refundingPayment.amountMinor - refundingPayment.refundedMinor) / 100}
                inputMode="decimal"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                required
              />
            </Field>
            <Field label="Reason (optional)" htmlFor="refund-reason">
              <Input
                id="refund-reason"
                placeholder="e.g. Duplicate charge"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                maxLength={300}
              />
            </Field>
            <div className="flex items-end gap-2">
              <Button type="submit" disabled={refundBusy} className="w-full">
                {refundBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirm refund
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by member, phone, plan, or invoice number..."
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardTitle className="text-base">No payments found</CardTitle>
          <CardDescription className="mt-1">
            Payments recorded from memberships will appear here.
          </CardDescription>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((payment) => {
            const remainingMinor = Math.max(0, payment.amountMinor - payment.refundedMinor);
            const canRefundThis =
              canRefund && payment.status === "SUCCEEDED" && remainingMinor > 0;
            const canIssueThis =
              canIssueInvoice && !payment.invoiceId && payment.status === "SUCCEEDED";

            return (
              <Card
                key={payment.id}
                className={payment.status === "REFUNDED" ? "opacity-75" : ""}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">{payment.memberName}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {payment.planName ?? "Manual payment"} · {payment.memberCode}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Badge>{METHOD_LABEL[payment.method]}</Badge>
                    <Badge>{payment.status.toLowerCase()}</Badge>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{payment.paymentDate}</span>
                  <span>
                    <strong className="text-foreground">
                      {formatMoney(payment.amountMinor, payment.currency)}
                    </strong>
                    {payment.refundedMinor > 0 ? (
                      <span className="ml-1 text-destructive">
                        (Refunded {formatMoney(payment.refundedMinor, payment.currency)})
                      </span>
                    ) : null}
                  </span>
                </div>

                {payment.invoiceNumber ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Invoice: <strong className="text-foreground">{payment.invoiceNumber}</strong>
                  </p>
                ) : null}

                {canIssueThis || canRefundThis ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {canIssueThis ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busyId === payment.id}
                        onClick={() => handleIssueInvoice(payment)}
                      >
                        {busyId === payment.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <FileText className="h-3.5 w-3.5" />
                        )}
                        Issue invoice
                      </Button>
                    ) : null}

                    {canRefundThis ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => openRefundForm(payment)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Refund
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
