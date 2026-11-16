"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Mail } from "lucide-react";
import { forgotPasswordSchema } from "@/server/auth/schemas";
import { requestPasswordReset } from "@/server/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert, CardDescription, CardTitle } from "@/components/ui/card";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ email: string }>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    const result = await requestPasswordReset(values);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setSent(true);
  });

  if (sent) {
    return (
      <div className="space-y-4">
        <CardTitle>Check your inbox</CardTitle>
        <Alert tone="success">
          If that email has an account, a reset link is on its way. It expires in 1 hour.
          In local dev the link is printed to the server console.
        </Alert>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <CardTitle>Forgot password</CardTitle>
        <CardDescription>We&apos;ll email you a reset link.</CardDescription>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <Field label="Email" htmlFor="email" error={errors.email?.message}>
        <Input id="email" type="email" inputMode="email" autoCapitalize="none" {...register("email")} />
      </Field>
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
        Send reset link
      </Button>
    </form>
  );
}
