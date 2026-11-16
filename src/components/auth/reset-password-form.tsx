"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2 } from "lucide-react";
import { resetPasswordSchema } from "@/server/auth/schemas";
import { resetPassword } from "@/server/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert, CardDescription, CardTitle } from "@/components/ui/card";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ token: string; password: string }>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    const result = await resetPassword(values);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.replace(result.data.redirectTo);
    router.refresh();
  });

  if (!token) {
    return (
      <div className="space-y-3">
        <CardTitle>Invalid link</CardTitle>
        <Alert>This reset link is missing its token. Request a new one.</Alert>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <CardTitle>Set a new password</CardTitle>
        <CardDescription>You&apos;ll be signed out of all other devices.</CardDescription>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <input type="hidden" {...register("token")} />
      <Field label="New password" htmlFor="password" error={errors.password?.message} hint="At least 10 characters.">
        <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
      </Field>
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        Update password
      </Button>
    </form>
  );
}
