import { randomBytes } from "node:crypto";
import { hash, verify, type Algorithm } from "@node-rs/argon2";

/**
 * Argon2id with the OWASP baseline (m=19 MiB, t=2, p=1).
 * Native binding => this module is SERVER ONLY (never import from middleware,
 * which runs on the edge runtime).
 */
const PARAMS = {
  algorithm: 2 as Algorithm, // Algorithm.Argon2id (const enum cannot be referenced under isolatedModules)
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * A REAL hash of a random password, computed once, so a login attempt for an
 * unknown email costs the same ~20ms as a known one. Without this, response
 * timing enumerates which emails already have accounts.
 */
let dummyHashPromise: Promise<string> | undefined;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hash(randomBytes(32).toString("base64url"), PARAMS);
  return dummyHashPromise;
}

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, PARAMS);
}

export async function verifyPassword(
  storedHash: string | null | undefined,
  plain: string,
): Promise<boolean> {
  if (!storedHash) {
    // Account exists but has no password yet (invited user), or user not found.
    await verify(await dummyHash(), plain).catch(() => false);
    return false;
  }
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}

/** True when the stored hash uses weaker parameters than the current policy. */
export function needsRehash(storedHash: string): boolean {
  const match = /m=(\d+),t=(\d+),p=(\d+)/.exec(storedHash);
  if (!match) return true;
  const [, m, t, p] = match;
  return (
    Number(m) < PARAMS.memoryCost ||
    Number(t) < PARAMS.timeCost ||
    Number(p) < PARAMS.parallelism ||
    !storedHash.startsWith("$argon2id$")
  );
}
