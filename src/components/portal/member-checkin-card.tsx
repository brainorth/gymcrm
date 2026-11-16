"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";
import { memberSelfCheckInAction } from "@/server/attendance/portal-actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Input } from "@/components/ui/field";

type Props = {
  gymSlug: string;
};

export function MemberCheckinCard({ gymSlug }: Props) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await memberSelfCheckInAction({ gymSlug, code });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setCode("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex gap-2">
        <Input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="6-CHAR CODE"
          maxLength={6}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={isPending}
          className="font-mono text-base tracking-widest uppercase"
          aria-label="Desk check-in code"
        />
        <Button type="submit" disabled={isPending || code.trim().length < 6} className="shrink-0">
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <LogIn className="h-4 w-4" aria-hidden />
          )}
          Check in now
        </Button>
      </div>
    </form>
  );
}
