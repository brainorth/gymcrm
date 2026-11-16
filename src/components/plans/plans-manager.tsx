"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Plus, Power, X } from "lucide-react";
import type { z } from "zod";
import { formatMoney } from "@/lib/money";
import {
  createPlanAction,
  togglePlanActiveAction,
  updatePlanAction,
} from "@/server/plans/actions";
import {
  planInputSchema,
  type PlanFormInput,
  type PlanParsedInput,
} from "@/server/plans/schemas";
import type { PlanDTO } from "@/server/services/plans";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";

type Props = {
  gymSlug: string;
  currency: string;
  canWrite: boolean;
  initialPlans: PlanDTO[];
};

const EMPTY_DEFAULTS: PlanFormInput = {
  name: "",
  description: "",
  durationInDays: 30,
  priceMajor: 1500,
  joiningFeeMajor: 0,
  maxFreezeDays: 0,
  graceDays: 0,
};

export function PlansManager({ gymSlug, currency, canWrite, initialPlans }: Props) {
  const [plans, setPlans] = useState<PlanDTO[]>(initialPlans);
  const [editing, setEditing] = useState<PlanDTO | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof planInputSchema>, unknown, PlanParsedInput>({
    resolver: zodResolver(planInputSchema),
    defaultValues: EMPTY_DEFAULTS,
  });

  function openCreate() {
    setEditing(null);
    setFormError(null);
    reset(EMPTY_DEFAULTS);
    setFormOpen(true);
  }

  function openEdit(plan: PlanDTO) {
    setEditing(plan);
    setFormError(null);
    reset({
      name: plan.name,
      description: plan.description ?? "",
      durationInDays: plan.durationInDays,
      priceMajor: plan.priceMinor / 100,
      joiningFeeMajor: plan.joiningFeeMinor / 100,
      maxFreezeDays: plan.maxFreezeDays,
      graceDays: plan.graceDays,
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setFormError(null);
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = editing
      ? await updatePlanAction({ ...values, gymSlug, planId: editing.id })
      : await createPlanAction({ ...values, gymSlug });

    if (!result.ok) {
      if (result.error.fieldErrors) {
        for (const [field, msgs] of Object.entries(result.error.fieldErrors)) {
          if (msgs[0]) setError(field as keyof PlanFormInput, { message: msgs[0] });
        }
      }
      setFormError(result.error.message);
      return;
    }

    const saved = result.data;
    setPlans((prev) =>
      editing
        ? prev.map((p) => (p.id === saved.id ? saved : p))
        : [saved, ...prev],
    );
    closeForm();
  });

  async function handleToggle(plan: PlanDTO) {
    setTogglingId(plan.id);
    setFormError(null);
    const result = await togglePlanActiveAction({
      gymSlug,
      planId: plan.id,
      isActive: !plan.isActive,
    });
    setTogglingId(null);

    if (!result.ok) {
      setFormError(result.error.message);
      return;
    }
    setPlans((prev) => prev.map((p) => (p.id === result.data.id ? result.data : p)));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Membership plans</h2>
          <p className="text-sm text-muted-foreground">
            Create monthly, quarterly, or annual plans in {currency}.
          </p>
        </div>
        {canWrite && !formOpen ? (
          <Button onClick={openCreate} className="shrink-0">
            <Plus className="h-4 w-4" />
            New plan
          </Button>
        ) : null}
      </div>

      {formError && !formOpen ? <Alert tone="error">{formError}</Alert> : null}

      {formOpen && canWrite ? (
        <Card>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">
              {editing ? `Edit “${editing.name}”` : "Create membership plan"}
            </CardTitle>
            <Button type="button" variant="ghost" size="icon" onClick={closeForm} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            {formError ? <Alert tone="error">{formError}</Alert> : null}

            <Field label="Plan name" htmlFor="plan-name" error={errors.name?.message}>
              <Input
                id="plan-name"
                placeholder="e.g. Monthly Pro"
                {...register("name")}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label={`Price (${currency})`}
                htmlFor="plan-price"
                error={errors.priceMajor?.message}
              >
                <Input
                  id="plan-price"
                  type="number"
                  step="0.01"
                  min={0}
                  inputMode="decimal"
                  {...register("priceMajor")}
                />
              </Field>

              <Field
                label="Duration (days)"
                htmlFor="plan-duration"
                error={errors.durationInDays?.message}
              >
                <Input
                  id="plan-duration"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  {...register("durationInDays")}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field
                label={`Joining fee (${currency})`}
                htmlFor="plan-joining"
                error={errors.joiningFeeMajor?.message}
              >
                <Input
                  id="plan-joining"
                  type="number"
                  step="0.01"
                  min={0}
                  inputMode="decimal"
                  {...register("joiningFeeMajor")}
                />
              </Field>

              <Field
                label="Max freeze days"
                htmlFor="plan-freeze"
                hint="0 = no freezing"
                error={errors.maxFreezeDays?.message}
              >
                <Input
                  id="plan-freeze"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  {...register("maxFreezeDays")}
                />
              </Field>

              <Field
                label="Grace days"
                htmlFor="plan-grace"
                hint="Late-renewal buffer"
                error={errors.graceDays?.message}
              >
                <Input
                  id="plan-grace"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  {...register("graceDays")}
                />
              </Field>
            </div>

            <Field
              label="Description (optional)"
              htmlFor="plan-desc"
              error={errors.description?.message}
            >
              <Input
                id="plan-desc"
                placeholder="Includes cardio, strength floor, and locker access"
                {...register("description")}
              />
            </Field>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editing ? "Save changes" : "Create plan"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {plans.length === 0 ? (
        <Card>
          <CardTitle className="text-base">No plans yet</CardTitle>
          <CardDescription className="mt-1">
            Add your first membership plan (e.g. Monthly ₹1,500 or Quarterly ₹4,000) to start
            enrolling members.
          </CardDescription>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {plans.map((plan) => (
            <Card
              key={plan.id}
              className={plan.isActive ? "" : "opacity-65"}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <CardTitle className="truncate text-base">{plan.name}</CardTitle>
                    <Badge>{plan.isActive ? "active" : "paused"}</Badge>
                  </div>
                  {plan.description ? (
                    <CardDescription className="mt-1 line-clamp-2">
                      {plan.description}
                    </CardDescription>
                  ) : null}
                </div>
                <p className="shrink-0 text-lg font-semibold tabular-nums">
                  {formatMoney(plan.priceMinor, plan.currency)}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>{plan.durationInDays} days</span>
                {plan.joiningFeeMinor > 0 ? (
                  <span>· +{formatMoney(plan.joiningFeeMinor, plan.currency)} joining</span>
                ) : null}
                {plan.maxFreezeDays > 0 ? (
                  <span>· {plan.maxFreezeDays}d freeze</span>
                ) : null}
                {plan.graceDays > 0 ? <span>· {plan.graceDays}d grace</span> : null}
              </div>

              {canWrite ? (
                <div className="mt-4 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(plan)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={togglingId === plan.id}
                    onClick={() => handleToggle(plan)}
                  >
                    {togglingId === plan.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Power className="h-3.5 w-3.5" />
                    )}
                    {plan.isActive ? "Pause" : "Activate"}
                  </Button>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
