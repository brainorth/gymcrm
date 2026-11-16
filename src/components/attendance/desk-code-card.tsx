"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { QrCode, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

type Props = {
  code: string;
  expiresInSeconds: number;
};

export function DeskCodeCard({ code, expiresInSeconds }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const minutesLeft = Math.max(1, Math.ceil(expiresInSeconds / 60));

  return (
    <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <QrCode className="h-5 w-5 text-primary" aria-hidden />
          <CardTitle className="text-base">Front desk check-in code</CardTitle>
        </div>
        <CardDescription>
          Members can enter this rotating code in their portal to check in. Valid for ~{minutesLeft}{" "}
          {minutesLeft === 1 ? "minute" : "minutes"}.
        </CardDescription>
      </div>

      <div className="flex items-center gap-3">
        <div
          className="rounded-lg border bg-muted px-4 py-2 font-mono text-2xl font-bold tracking-[0.25em] text-foreground select-all"
          aria-label={`Desk check-in code ${code}`}
        >
          {code}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => startTransition(() => router.refresh())}
          aria-label="Refresh desk code"
        >
          <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} aria-hidden />
          Refresh
        </Button>
      </div>
    </Card>
  );
}
