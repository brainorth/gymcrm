import { z } from "zod";

/**
 * Server-only environment contract. Anything the browser may see must be
 * NEXT_PUBLIC_* and is read directly (Next inlines those at build time).
 *
 * Payments/storage/notifications are intentionally OPTIONAL: the app boots and
 * every feature except live money movement works without those keys.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().optional(),
  TEST_DATABASE_URL: z.string().optional(),

  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be >= 32 chars (openssl rand -base64 48)"),
  SESSION_COOKIE_NAME: z.string().default("gym_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),

  ENABLE_PATH_TENANT_FALLBACK: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  PAYMENTS_DRIVER: z.enum(["mock", "razorpay"]).default("mock"),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  RAZORPAYX_ACCOUNT_NUMBER: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  ALERTS_FROM_EMAIL: z.string().default("alerts@brainorth.com"),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  CRON_SECRET: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/** Lazily parsed so importing this module never throws at build time. */
export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only escape hatch. */
export function resetEnvCache(): void {
  cached = undefined;
}
