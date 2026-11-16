/**
 * Timezone-correct date helpers.
 *
 * The rule: a "day" is the gym's LOCAL calendar day, not a UTC day. A 23:30 IST
 * check-in is 18:00 UTC — storing that as a UTC date would put the member's
 * attendance on the wrong day and break the one-check-in-per-day constraint.
 *
 * Prisma `@db.Date` columns want a Date whose UTC components are the local
 * Y/M/D, which is exactly what `gymLocalDate` returns.
 */

const partsFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

/** "2026-11-16" for the given instant, in the gym's timezone. */
export function localDateString(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return partsFormatter(timeZone).format(instant);
}

/** A Date at UTC midnight representing the gym's local calendar day. */
export function gymLocalDate(instant: Date, timeZone: string): Date {
  const [y, m, d] = localDateString(instant, timeZone).split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
}

/** Parse a "YYYY-MM-DD" input (from a date picker) into a @db.Date value. */
export function dateFromInput(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date input: ${value}`);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/** Whole days between two @db.Date values (b - a). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Indian fiscal year label, e.g. 2026-27 (Apr 1 -> Mar 31). */
export function fiscalYearFor(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return month >= 4 ? `${year}-${String(year + 1).slice(2)}` : `${year - 1}-${String(year).slice(2)}`;
}
