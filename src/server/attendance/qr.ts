import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/env";

const WINDOW_MS = 5 * 60 * 1000;
const CODE_LENGTH = 6;

function codeForBucket(gymId: string, bucket: number): string {
  return createHmac("sha256", env().AUTH_SECRET)
    .update(`${gymId}:${bucket}`)
    .digest("hex")
    .slice(0, CODE_LENGTH)
    .toUpperCase();
}

/**
 * Generates a 6-character uppercase rotating desk check-in code valid for
 * 5-minute windows, along with the remaining seconds in the current window.
 */
export function generateDeskCheckInCode(
  gymId: string,
  now = new Date(),
): { code: string; expiresInSeconds: number } {
  const nowMs = now.getTime();
  const bucket = Math.floor(nowMs / WINDOW_MS);
  const windowEndMs = (bucket + 1) * WINDOW_MS;
  const expiresInSeconds = Math.max(1, Math.ceil((windowEndMs - nowMs) / 1000));

  return {
    code: codeForBucket(gymId, bucket),
    expiresInSeconds,
  };
}

/**
 * Verifies a 6-character desk check-in code against the current and previous
 * 5-minute windows (for clock/boundary grace) using constant-time comparison.
 */
export function verifyDeskCheckInCode(
  gymId: string,
  code: string,
  now = new Date(),
): boolean {
  const normalized = code.trim().toUpperCase();
  if (normalized.length !== CODE_LENGTH) return false;

  const bucket = Math.floor(now.getTime() / WINDOW_MS);
  const inputBuf = Buffer.from(normalized, "utf8");

  for (const candidateBucket of [bucket, bucket - 1]) {
    const expectedBuf = Buffer.from(codeForBucket(gymId, candidateBucket), "utf8");
    if (inputBuf.length === expectedBuf.length && timingSafeEqual(inputBuf, expectedBuf)) {
      return true;
    }
  }

  return false;
}
