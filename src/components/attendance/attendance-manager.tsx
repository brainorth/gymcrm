"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, LogIn, LogOut, Search } from "lucide-react";
import { checkInAction, checkOutAction } from "@/server/attendance/actions";
import type { AttendanceDTO } from "@/server/services/attendance";
import type { MemberDTO } from "@/server/services/members";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/field";

type Props = {
  gymSlug: string;
  timezone: string;
  selectedDate: string;
  todayIso: string;
  canMark: boolean;
  initialRecords: AttendanceDTO[];
  members: MemberDTO[];
};

function formatTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AttendanceManager({
  gymSlug,
  timezone,
  selectedDate,
  todayIso,
  canMark,
  initialRecords,
  members,
}: Props) {
  const router = useRouter();
  const [records, setRecords] = useState<AttendanceDTO[]>(initialRecords);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isToday = selectedDate === todayIso;

  const checkedInMemberIds = useMemo(
    () => new Set(records.map((r) => r.memberId)),
    [records],
  );

  const quickMatches = useMemo(() => {
    if (!isToday || !canMark) return [];
    const q = query.trim().toLowerCase();
    const active = members.filter((m) => m.status === "ACTIVE");
    if (!q) return active.slice(0, 6);
    return active
      .filter(
        (m) =>
          m.fullName.toLowerCase().includes(q) ||
          m.phone.toLowerCase().includes(q) ||
          m.memberCode.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [members, query, isToday, canMark]);

  async function handleCheckIn(memberId: string) {
    setBusyId(memberId);
    setError(null);
    const result = await checkInAction({ gymSlug, memberId, source: "MANUAL" });
    setBusyId(null);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setRecords((prev) => [result.data, ...prev]);
  }

  async function handleCheckOut(attendanceId: string) {
    setBusyId(attendanceId);
    setError(null);
    const result = await checkOutAction({ gymSlug, attendanceId });
    setBusyId(null);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setRecords((prev) => prev.map((r) => (r.id === result.data.id ? result.data : r)));
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Attendance</h2>
          <p className="text-sm text-muted-foreground">
            {records.length} {records.length === 1 ? "check-in" : "check-ins"} on {selectedDate}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={selectedDate}
            max={todayIso}
            onChange={(e) => {
              const next = e.target.value;
              if (next) router.push(`/${gymSlug}/attendance?date=${next}`);
            }}
            className="w-auto"
            aria-label="Select date"
          />
          {!isToday ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push(`/${gymSlug}/attendance`)}
            >
              Today
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {isToday && canMark ? (
        <Card>
          <CardTitle className="text-base">Quick check-in</CardTitle>
          <CardDescription className="mt-0.5">
            Search by name, phone, or member ID and tap Check in.
          </CardDescription>

          <div className="relative mt-3">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search active members..."
              className="pl-9"
              aria-label="Search members to check in"
            />
          </div>

          {quickMatches.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No active members match.</p>
          ) : (
            <div className="mt-3 divide-y rounded-lg border">
              {quickMatches.map((m) => {
                const alreadyIn = checkedInMemberIds.has(m.id);
                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{m.fullName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.memberCode} · {m.phone}
                        {m.activeSubscriptionEndDate
                          ? ` · Valid till ${m.activeSubscriptionEndDate}`
                          : " · No active plan"}
                      </p>
                    </div>
                    {alreadyIn ? (
                      <Badge className="shrink-0">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        In today
                      </Badge>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busyId === m.id}
                        onClick={() => handleCheckIn(m.id)}
                        className="shrink-0"
                      >
                        {busyId === m.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <LogIn className="h-3.5 w-3.5" />
                        )}
                        Check in
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          {isToday ? "Today’s check-ins" : `Check-ins for ${selectedDate}`}
        </h3>

        {records.length === 0 ? (
          <Card>
            <CardTitle className="text-base">No check-ins recorded</CardTitle>
            <CardDescription className="mt-1">
              {isToday
                ? "Use Quick check-in above as members arrive."
                : "No members checked in on this date."}
            </CardDescription>
          </Card>
        ) : (
          <div className="space-y-2">
            {records.map((rec) => (
              <Card key={rec.id} className="flex items-center justify-between gap-3 py-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">{rec.memberName}</p>
                    <Badge>{rec.planName ?? "No active plan"}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {rec.memberCode} · In at {formatTime(rec.checkInTime, timezone)}
                    {rec.checkOutTime
                      ? ` · Out at ${formatTime(rec.checkOutTime, timezone)}`
                      : ""}
                  </p>
                </div>

                {canMark && !rec.checkOutTime ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busyId === rec.id}
                    onClick={() => handleCheckOut(rec.id)}
                    className="shrink-0"
                  >
                    {busyId === rec.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <LogOut className="h-3.5 w-3.5" />
                    )}
                    Check out
                  </Button>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
