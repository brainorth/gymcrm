import { AsyncLocalStorage } from "node:async_hooks";
import type { GymRole } from "@/generated/prisma/client";

/**
 * Ambient request context. Set once by `requireTenant()` and readable by any
 * deep service (audit logging, outbox writes) without threading a ctx argument
 * through every call. It is ALSO a second pair of eyes: the tenant guard
 * cross-checks the gymId it was handed against the ambient one.
 */
export type RequestContext = {
  requestId: string;
  gymId: string;
  gymSlug: string;
  userId: string;
  role: GymRole | "SUPER_ADMIN";
  /** True when a SUPER_ADMIN is acting inside a tenant (always audited). */
  impersonating: boolean;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
