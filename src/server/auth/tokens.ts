import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/env";

/** URL-safe opaque token. 32 bytes = 256 bits of entropy. */
export function newOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * We never store the raw token. An HMAC (peppered with AUTH_SECRET) means a
 * leaked database dump alone cannot be replayed as a session cookie.
 */
export function tokenFingerprint(token: string): string {
  return createHmac("sha256", env().AUTH_SECRET).update(token).digest("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Generic HMAC used for rotating attendance QR payloads and payment links. */
export function hmac(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("base64url");
}
