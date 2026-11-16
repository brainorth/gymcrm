"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2, Rocket, X } from "lucide-react";
import type { z } from "zod";
import { registerGymSchema, type RegisterGymInput } from "@/server/auth/schemas";
import { checkSlugAvailability, registerGym } from "@/server/auth/actions";
import { normalizeSlug } from "@/lib/routing";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/card";

const APP_HOST = process.env.NEXT_PUBLIC_APP_HOST ?? "gym.brainorth.com";
const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York"];

export function RegisterGymForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugState, setSlugState] = useState<"idle" | "checking" | "free" | "taken" | "invalid">("idle");

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof registerGymSchema>, unknown, RegisterGymInput>({
    resolver: zodResolver(registerGymSchema),
    defaultValues: {
      gymName: "",
      slug: "",
      ownerName: "",
      email: "",
      password: "",
      timezone: "Asia/Kolkata",
      currency: "INR",
      acceptTerms: true as const,
    },
  });

  const gymName = watch("gymName");
  const slug = watch("slug");

  useEffect(() => {
    if (!slugTouched && gymName) {
      setValue("slug", normalizeSlug(gymName), { shouldValidate: false });
    }
  }, [gymName, slugTouched, setValue]);

  useEffect(() => {
    if (!slug) {
      setSlugState("idle");
      return;
    }
    setSlugState("checking");
    const timer = setTimeout(async () => {
      const result = await checkSlugAvailability(slug);
      if (!result.ok) setSlugState("invalid");
      else setSlugState(result.data.available ? "free" : "taken");
    }, 400);
    return () => clearTimeout(timer);
  }, [slug]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await registerGym(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof RegisterGymInput, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    router.replace(result.data.redirectTo);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError ? <Alert>{formError}</Alert> : null}

      <Field label="Gym name" htmlFor="gymName" error={errors.gymName?.message}>
        <Input id="gymName" placeholder="Gold's Gym Andheri" {...register("gymName")} />
      </Field>

      <Field
        label="Your gym URL"
        htmlFor="slug"
        error={errors.slug?.message ?? (slugState === "taken" ? "That URL is already taken." : undefined)}
        hint={`${APP_HOST}/${slug || "your-gym"}`}
      >
        <div className="relative">
          <Input
            id="slug"
            autoCapitalize="none"
            placeholder="golds-gym-andheri"
            {...register("slug", { onChange: () => setSlugTouched(true) })}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            {slugState === "checking" ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : slugState === "free" ? (
              <Check className="h-4 w-4 text-primary" />
            ) : slugState === "taken" || slugState === "invalid" ? (
              <X className="h-4 w-4 text-destructive" />
            ) : null}
          </span>
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" htmlFor="ownerName" error={errors.ownerName?.message}>
          <Input id="ownerName" autoComplete="name" placeholder="Rohit Sharma" {...register("ownerName")} />
        </Field>
        <Field label="Phone (optional)" htmlFor="phone" error={errors.phone?.message}>
          <Input id="phone" type="tel" inputMode="tel" placeholder="+91 98765 43210" {...register("phone")} />
        </Field>
      </div>

      <Field label="Email" htmlFor="email" error={errors.email?.message}>
        <Input id="email" type="email" inputMode="email" autoCapitalize="none" autoComplete="email" {...register("email")} />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        error={errors.password?.message}
        hint="At least 10 characters."
      >
        <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
      </Field>

      <Field label="Timezone" htmlFor="timezone" error={errors.timezone?.message} hint="Attendance days and expiry dates use this.">
        <select
          id="timezone"
          className="h-11 w-full rounded-lg border bg-card px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
          {...register("timezone")}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </Field>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 h-4 w-4 min-h-0" {...register("acceptTerms")} />
        <span className="text-muted-foreground">
          I agree to the terms of service and privacy policy.
        </span>
      </label>
      {errors.acceptTerms ? (
        <p className="text-xs font-medium text-destructive">{errors.acceptTerms.message}</p>
      ) : null}

      <Button type="submit" className="w-full" size="lg" disabled={isSubmitting || slugState === "taken"}>
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
        Create gym &amp; start 14-day trial
      </Button>
    </form>
  );
}
