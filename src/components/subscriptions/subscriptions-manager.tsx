"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Ban,
  CalendarPlus,
  IndianRupee,
  Loader2,
  Pause,
  Play,
  Search,
  X,
} from "lucide-react";
import type { z } from "zod";
import { formatMoney } from "@/lib/money";
import type { MemberDTO } from "@/server/services/members";
import type { PlanDTO } from "@/server/services/plans";
import type { SubscriptionDTO } from "@/server/services/subscriptions";
import {
  assignSubscriptionAction,
  cancelSubscriptionAction,
  freezeSubscriptionAction,
  recordPaymentAction,
  resumeSubscriptionAction,
} from "@/server/subscriptions/actions";
import {
  assignSubscriptionSchema,
  type AssignSubscriptionFormInput,
  type AssignSubscriptionParsed,
} from "@/server/subscriptions/schemas";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";

type Props = {
  gymSlug: string;
  currency: string;
  todayIso: string;
  canWrite: boolean;
  canFreeze: boolean;
  canRecordPayment: boolean;
  initialSubscriptions: SubscriptionDTO[];
  members: MemberDTO[];
  plans: PlanDTO[];
};

type FilterTab = "ACTIVE" | "EXPIRING" | "FROZEN" | "ALL";

export function SubscriptionsManager({
  gymSlug,
  currency,
  todayIso,
  canWrite,
  canFreeze,
  canRecordPayment,
  initialSubscriptions,
  members,
  plans,
}: Props) {
  const [subs, setSubs] = useState<SubscriptionDTO[]>(initialSubscriptions);
  const [tab, setTab] = useState<FilterTab>("ACTIVE");
  const [search, setSearch] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [payingSub, setPayingSub] = useState<SubscriptionDTO | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "OTHER">(
    "UPI",
  );
  const [payBusy, setPayBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);

  const activeMembers = useMemo(
    () => members.filter((m) => m.status !== "ARCHIVED"),
    [members],
  );
  const activePlans = useMemo(() => plans.filter((p) => p.isActive), [plans]);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof assignSubscriptionSchema>, unknown, AssignSubscriptionParsed>({
    resolver: zodResolver(assignSubscriptionSchema),
    defaultValues: {
      gymSlug,
      memberId: activeMembers[0]?.id ?? "",
      planId: activePlans[0]?.id ?? "",
      startDate: todayIso,
      paymentMethod: "UPI",
      paidMajor: activePlans[0]
        ? (activePlans[0].priceMinor + activePlans[0].joiningFeeMinor) / 100
        : 0,
      notes: "",
    },
  });

  const selectedPlanId = watch("planId");
  const selectedMethod = watch("paymentMethod");

  function handlePlanChange(planId: string) {
    setValue("planId", planId);
    const plan = activePlans.find((p) => p.id === planId);
    if (plan) {
      setValue("paidMajor", (plan.priceMinor + plan.joiningFeeMinor) / 100);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sevenDaysOut = new Date(`${todayIso}T00:00:00.000Z`);
    sevenDaysOut.setUTCDate(sevenDaysOut.getUTCDate() + 7);
    const sevenDaysIso = sevenDaysOut.toISOString().slice(0, 10);

    return subs.filter((s) => {
      if (tab === "ACTIVE" && s.status !== "ACTIVE") return false;
      if (tab === "FROZEN" && !s.isFrozen) return false;
      if (
        tab === "EXPIRING" &&
        (s.status !== "ACTIVE" || s.effectiveEndDate > sevenDaysIso || s.effectiveEndDate < todayIso)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        s.memberName.toLowerCase().includes(q) ||
        s.memberPhone.toLowerCase().includes(q) ||
        s.memberCode.toLowerCase().includes(q) ||
        s.planName.toLowerCase().includes(q)
      );
    });
  }, [subs, tab, search, todayIso]);

  const onAssign = handleSubmit(async (values) => {
    setBannerError(null);
    const result = await assignSubscriptionAction({ ...values, gymSlug });
    if (!result.ok) {
      if (result.error.fieldErrors) {
        for (const [field, msgs] of Object.entries(result.error.fieldErrors)) {
          if (msgs[0]) setError(field as keyof AssignSubscriptionFormInput, { message: msgs[0] });
        }
      }
      setBannerError(result.error.message);
      return;
    }
    setSubs((prev) => [result.data, ...prev]);
    setAssignOpen(false);
    reset({
      gymSlug,
      memberId: activeMembers[0]?.id ?? "",
      planId: activePlans[0]?.id ?? "",
      startDate: todayIso,
      paymentMethod: "UPI",
      paidMajor: activePlans[0]
        ? (activePlans[0].priceMinor + activePlans[0].joiningFeeMinor) / 100
        : 0,
      notes: "",
    });
  });

  async function handleFreezeToggle(sub: SubscriptionDTO) {
    setBusyId(sub.id);
    setBannerError(null);
    const result = sub.isFrozen
      ? await resumeSubscriptionAction({ gymSlug, subscriptionId: sub.id })
      : await freezeSubscriptionAction({ gymSlug, subscriptionId: sub.id });
    setBusyId(null);

    if (!result.ok) {
      setBannerError(result.error.message);
      return;
    }
    setSubs((prev) => prev.map((s) => (s.id === result.data.id ? result.data : s)));
  }

  async function handleCancel(sub: SubscriptionDTO) {
    setBusyId(sub.id);
    setBannerError(null);
    const result = await cancelSubscriptionAction({ gymSlug, subscriptionId: sub.id });
    setBusyId(null);
    if (!result.ok) {
      setBannerError(result.error.message);
      return;
    }
    setSubs((prev) => prev.map((s) => (s.id === result.data.id ? result.data : s)));
  }

  function openPayModal(sub: SubscriptionDTO) {
    const dueMinor = Math.max(0, sub.priceMinor - sub.paidMinor);
    setPayingSub(sub);
    setPayAmount(String(dueMinor > 0 ? dueMinor / 100 : sub.priceMinor / 100));
    setPayMethod("UPI");
    setBannerError(null);
  }

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payingSub) return;
    setPayBusy(true);
    setBannerError(null);
    const result = await recordPaymentAction({
      gymSlug,
      memberId: payingSub.memberId,
      subscriptionId: payingSub.id,
      amountMajor: Number(payAmount),
      method: payMethod,
    });
    setPayBusy(false);

    if (!result.ok) {
      setBannerError(result.error.message);
      return;
    }
    if (result.data) {
      setSubs((prev) => prev.map((s) => (s.id === result.data!.id ? result.data! : s)));
    }
    setPayingSub(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Memberships</h2>
          <p className="text-sm text-muted-foreground">
            Assign plans, track renewals, freeze memberships, and record payments.
          </p>
        </div>
        {canWrite && !assignOpen ? (
          <Button
            onClick={() => setAssignOpen(true)}
            disabled={activeMembers.length === 0 || activePlans.length === 0}
            className="shrink-0"
          >
            <CalendarPlus className="h-4 w-4" />
            Enroll / Renew
          </Button>
        ) : null}
      </div>

      {activeMembers.length === 0 || activePlans.length === 0 ? (
        <Alert tone="info">
          {activePlans.length === 0
            ? "Create at least one active plan first before enrolling a member."
            : "Add at least one member first before assigning a plan."}
        </Alert>
      ) : null}

      {bannerError ? <Alert tone="error">{bannerError}</Alert> : null}

      {assignOpen && canWrite ? (
        <Card>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Enroll or renew member</CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setAssignOpen(false)}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <form onSubmit={onAssign} className="mt-4 space-y-4">
            <input type="hidden" {...register("gymSlug")} value={gymSlug} />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Member" htmlFor="sub-member" error={errors.memberId?.message}>
                <select
                  id="sub-member"
                  className="h-11 w-full rounded-lg border bg-card px-3 text-sm"
                  {...register("memberId")}
                >
                  {activeMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName} ({m.phone})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Plan" htmlFor="sub-plan" error={errors.planId?.message}>
                <select
                  id="sub-plan"
                  className="h-11 w-full rounded-lg border bg-card px-3 text-sm"
                  value={selectedPlanId}
                  onChange={(e) => handlePlanChange(e.target.value)}
                >
                  {activePlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatMoney(p.priceMinor + p.joiningFeeMinor, p.currency)} (
                      {p.durationInDays}d)
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Start date" htmlFor="sub-start" error={errors.startDate?.message}>
                <Input id="sub-start" type="date" {...register("startDate")} />
              </Field>

              <Field
                label="Payment method"
                htmlFor="sub-method"
                error={errors.paymentMethod?.message}
              >
                <select
                  id="sub-method"
                  className="h-11 w-full rounded-lg border bg-card px-3 text-sm"
                  {...register("paymentMethod")}
                >
                  <option value="UPI">UPI</option>
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="BANK_TRANSFER">Bank transfer</option>
                  <option value="OTHER">Other</option>
                  <option value="NONE">Pay later (no payment now)</option>
                </select>
              </Field>

              {selectedMethod !== "NONE" ? (
                <Field
                  label={`Amount received (${currency})`}
                  htmlFor="sub-paid"
                  error={errors.paidMajor?.message}
                >
                  <Input
                    id="sub-paid"
                    type="number"
                    step="0.01"
                    min={0}
                    inputMode="decimal"
                    {...register("paidMajor")}
                  />
                </Field>
              ) : null}
            </div>

            <Field label="Notes (optional)" htmlFor="sub-notes" error={errors.notes?.message}>
              <Input id="sub-notes" placeholder="e.g. Paid via GPay" {...register("notes")} />
            </Field>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setAssignOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save membership
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {payingSub ? (
        <Card className="border-primary/40">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">
              Record payment — {payingSub.memberName} ({payingSub.planName})
            </CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setPayingSub(null)}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <form onSubmit={submitPayment} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={`Amount (${currency})`} htmlFor="pay-amount">
              <Input
                id="pay-amount"
                type="number"
                step="0.01"
                min="0.01"
                inputMode="decimal"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                required
              />
            </Field>
            <Field label="Method" htmlFor="pay-method">
              <select
                id="pay-method"
                className="h-11 w-full rounded-lg border bg-card px-3 text-sm"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}
              >
                <option value="UPI">UPI</option>
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="OTHER">Other</option>
              </select>
            </Field>
            <div className="flex items-end gap-2">
              <Button type="submit" disabled={payBusy} className="w-full">
                {payBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Record payment
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by member, phone, or plan..."
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1 sm:pb-0">
          {(
            [
              { value: "ACTIVE", label: "Active" },
              { value: "EXPIRING", label: "Expiring 7d" },
              { value: "FROZEN", label: "Frozen" },
              { value: "ALL", label: "All" },
            ] as const
          ).map((item) => (
            <Button
              key={item.value}
              type="button"
              size="sm"
              variant={tab === item.value ? "default" : "outline"}
              onClick={() => setTab(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardTitle className="text-base">No memberships in this view</CardTitle>
          <CardDescription className="mt-1">
            Tap “Enroll / Renew” to assign a plan to a member.
          </CardDescription>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((sub) => {
            const balanceMinor = Math.max(0, sub.priceMinor - sub.paidMinor);
            const expired = sub.status === "ACTIVE" && sub.effectiveEndDate < todayIso;
            return (
              <Card key={sub.id} className={sub.status === "CANCELLED" ? "opacity-65" : ""}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">{sub.memberName}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {sub.planName} · {sub.memberCode}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {sub.isFrozen ? <Badge>frozen</Badge> : null}
                    <Badge>{expired ? "expired" : sub.status.toLowerCase()}</Badge>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {sub.startDate} → <strong>{sub.effectiveEndDate}</strong>
                  </span>
                  <span>
                    Paid {formatMoney(sub.paidMinor, sub.currency)} /{" "}
                    {formatMoney(sub.priceMinor, sub.currency)}
                    {balanceMinor > 0 ? (
                      <strong className="ml-1 text-destructive">
                        (Due {formatMoney(balanceMinor, sub.currency)})
                      </strong>
                    ) : null}
                  </span>
                </div>

                {sub.status === "ACTIVE" ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {canRecordPayment && balanceMinor > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openPayModal(sub)}
                      >
                        <IndianRupee className="h-3.5 w-3.5" />
                        Collect due
                      </Button>
                    ) : null}

                    {canFreeze && sub.maxFreezeDays > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busyId === sub.id}
                        onClick={() => handleFreezeToggle(sub)}
                      >
                        {busyId === sub.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : sub.isFrozen ? (
                          <Play className="h-3.5 w-3.5" />
                        ) : (
                          <Pause className="h-3.5 w-3.5" />
                        )}
                        {sub.isFrozen ? "Resume" : "Freeze"}
                      </Button>
                    ) : null}

                    {canWrite ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busyId === sub.id}
                        onClick={() => handleCancel(sub)}
                      >
                        <Ban className="h-3.5 w-3.5" />
                        Cancel
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
