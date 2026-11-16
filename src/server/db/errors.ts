/** Typed error taxonomy. UI maps these codes to messages; logs get the detail. */

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly expose: boolean;
  constructor(
    code: string,
    message: string,
    opts: { status?: number; expose?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = opts.status ?? 400;
    this.expose = opts.expose ?? true;
  }
}

/** A query tried to cross a tenant boundary. Always a bug or an attack. */
export class TenantScopeError extends AppError {
  constructor(message: string, readonly detail: Record<string, unknown> = {}) {
    super("TENANT_SCOPE_VIOLATION", message, { status: 500, expose: false });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "You must sign in to continue.") {
    super("UNAUTHENTICATED", message, { status: 401 });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource.") {
    super("FORBIDDEN", message, { status: 403 });
  }
}

export class NotFoundError extends AppError {
  constructor(entity = "Resource") {
    super("NOT_FOUND", `${entity} not found.`, { status: 404 });
  }
}

export class ValidationFailedError extends AppError {
  constructor(
    message = "Some fields need attention.",
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super("VALIDATION", message, { status: 422 });
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many attempts. Try again shortly.", readonly retryAfterSeconds = 60) {
    super("RATE_LIMITED", message, { status: 429 });
  }
}

export class ConflictError extends AppError {
  constructor(message = "That already exists.") {
    super("CONFLICT", message, { status: 409 });
  }
}

export class PaymentsNotConfiguredError extends AppError {
  constructor(provider: string) {
    super(
      "PAYMENTS_NOT_CONFIGURED",
      `${provider} is not configured. Set the API keys and PAYMENTS_DRIVER to enable live payments.`,
      { status: 503 },
    );
  }
}

/** Prisma unique-constraint violation (P2002). */
export function isUniqueViolation(error: unknown, fields?: string[]): boolean {
  const e = error as { code?: string; meta?: { target?: string[] | string } };
  if (e?.code !== "P2002") return false;
  if (!fields) return true;
  const target = e.meta?.target;
  const list = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
  return fields.every((f) => list.includes(f));
}

export function isForeignKeyViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === "P2003";
}
