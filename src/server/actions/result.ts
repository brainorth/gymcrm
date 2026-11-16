import { ZodError } from "zod";
import { AppError } from "@/server/db/errors";
import { fieldErrorsFrom } from "@/server/auth/schemas";

/**
 * One result shape for every server action. Forms never see a thrown stack
 * trace, and internal failures (tenant-scope violations, DB errors) are logged
 * server-side while the client gets a generic message.
 */
export type ActionError = {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  retryAfterSeconds?: number;
};

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(error: ActionError): ActionResult<T> {
  return { ok: false, error };
}

export function toActionError(error: unknown): ActionError {
  if (error instanceof ZodError) {
    return {
      code: "VALIDATION",
      message: "Some fields need attention.",
      fieldErrors: fieldErrorsFrom(error),
    };
  }
  if (error instanceof AppError) {
    const base: ActionError = {
      code: error.code,
      message: error.expose ? error.message : "Something went wrong. Please try again.",
    };
    if ("fieldErrors" in error) {
      base.fieldErrors = (error as { fieldErrors?: Record<string, string[]> }).fieldErrors;
    }
    if ("retryAfterSeconds" in error) {
      base.retryAfterSeconds = (error as { retryAfterSeconds?: number }).retryAfterSeconds;
    }
    if (!error.expose) console.error(`[${error.code}] ${error.message}`, error);
    return base;
  }
  console.error("[action:unhandled]", error);
  return { code: "INTERNAL", message: "Something went wrong. Please try again." };
}

/** Wrap an action body so it can never throw across the network boundary. */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (error) {
    return fail(toActionError(error));
  }
}
