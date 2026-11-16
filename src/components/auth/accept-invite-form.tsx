"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2 } from "lucide-react";
import { z } from "zod";
import { passwordSchema } from "@/server/auth/schemas";
import { acceptMemberInviteAction } from "@/server/members/invite-actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert, CardDescription, CardTitle } from "@/components/ui/card";

const acceptInviteFormSchema = z.object({
  token: z.string().min(20, "Invalid invite token.").max(200),
  password: passwordSchema,
});

type AcceptInviteFormValues = z.infer<typeof acceptInviteFormSchema>;

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AcceptInviteFormValues>({
    resolver: zodResolver(acceptInviteFormSchema),
    defaultValues: { token, password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    const result = await acceptMemberInviteAction(values);
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
        <CardTitle>Invalid invite link</CardTitle>
        <Alert>This invite link is missing its token. Ask your gym for a new invite.</Alert>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <CardTitle>Claim your member portal</CardTitle>
        <CardDescription>Set a password to activate your account and view your membership.</CardDescription>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <input type="hidden" {...register("token")} />
      <Field
        label="Password"
        htmlFor="password"
        error={errors.password?.message}
        hint="At least 10 characters."
      >
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          {...register("password")}
        />
      </Field>
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        Activate account
      </Button>
    </form>
  );
}
