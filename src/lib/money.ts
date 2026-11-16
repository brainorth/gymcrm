/**
 * Money helpers. Database always stores integer minor units (paise/cents).
 * Never do floating-point arithmetic on stored balances.
 */

export function formatMoney(minorUnits: number, currency = "INR"): string {
  const major = minorUnits / 100;
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: minorUnits % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}

export function toMinorUnits(majorAmount: number): number {
  return Math.round(majorAmount * 100);
}
