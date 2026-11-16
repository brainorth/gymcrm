"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save } from "lucide-react";
import type { z } from "zod";
import { updateGymSettingsAction } from "@/server/staff/actions";
import {
  gymSettingsInputSchema,
  type GymSettingsFormInput,
  type GymSettingsParsedInput,
} from "@/server/staff/schemas";
import type { GymSettingsDTO } from "@/server/services/staff";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";

type Props = {
  initialSettings: GymSettingsDTO;
};

export function GymSettingsForm({ initialSettings }: Props) {
  const router = useRouter();
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof gymSettingsInputSchema>, unknown, GymSettingsParsedInput>({
    resolver: zodResolver(gymSettingsInputSchema),
    defaultValues: {
      name: initialSettings.name,
      timezone: initialSettings.timezone,
      currency: initialSettings.currency,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null);
    const result = await updateGymSettingsAction({
      ...values,
      gymSlug: initialSettings.slug,
    });

    if (!result.ok) {
      if (result.error.fieldErrors) {
        for (const [field, msgs] of Object.entries(result.error.fieldErrors)) {
          if (msgs[0]) setError(field as keyof GymSettingsFormInput, { message: msgs[0] });
        }
      }
      setBanner({ tone: "error", text: result.error.message });
      return;
    }

    setBanner({ tone: "success", text: "Gym settings saved." });
    router.refresh();
  });

  return (
    <Card className="max-w-2xl">
      <CardTitle>Gym settings</CardTitle>
      <CardDescription className="mt-1">
        Configure your gym&apos;s display name, local timezone, and billing currency.
      </CardDescription>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}

        <Field label="Gym name" htmlFor="gym-name" error={errors.name?.message}>
          <Input
            id="gym-name"
            placeholder="Ironworks Fitness"
            aria-invalid={Boolean(errors.name)}
            {...register("name")}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Timezone (IANA)"
            htmlFor="gym-timezone"
            error={errors.timezone?.message}
            hint="Used for attendance days and subscription dates (e.g. Asia/Kolkata, UTC)."
          >
            <Input
              id="gym-timezone"
              placeholder="Asia/Kolkata"
              aria-invalid={Boolean(errors.timezone)}
              {...register("timezone")}
            />
          </Field>

          <Field
            label="Currency"
            htmlFor="gym-currency"
            error={errors.currency?.message}
            hint="3-letter ISO currency code (e.g. INR, USD, EUR)."
          >
            <Input
              id="gym-currency"
              maxLength={3}
              placeholder="INR"
              className="uppercase"
              aria-invalid={Boolean(errors.currency)}
              {...register("currency")}
            />
          </Field>
        </div>

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save settings
              </>
            )}
          </Button>
        </div>
      </form>
    </Card>
  );
}
