import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/env";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * PLATFORM client — unscoped, god-mode. It may read/write any gym.
 *
 * Rules:
 *  - Only identity/auth, platform-admin, webhook and cron code may import this.
 *  - Tenant business logic must use `tenantDb(gymId)` from ./tenant-client.
 *  - Every platform-client query that touches tenant data MUST have an explicit
 *    gymId in the where clause, written by hand and covered by a test.
 *
 * Supabase note: we deliberately do NOT pass `statementNameGenerator` to the pg
 * adapter, so queries use UNNAMED prepared statements. That is what makes the
 * transaction pooler (:6543) safe. Naming them would break under PgBouncer
 * transaction mode.
 */
function build(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString,
    max: process.env.NODE_ENV === "production" ? 5 : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? [{ emit: "event", level: "query" }, "warn", "error"]
        : ["warn", "error"],
  });
}

const globalForPrisma = globalThis as unknown as {
  __gymPrisma?: PrismaClient;
};

/** Singleton across Next.js dev HMR reloads. */
export const prisma: PrismaClient =
  globalForPrisma.__gymPrisma ?? build(env().DATABASE_URL);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__gymPrisma = prisma;
}

/** Test harness helper: a disposable client pointed at the test database. */
export function createIsolatedPrismaClient(connectionString: string): PrismaClient {
  return build(connectionString);
}

export type { PrismaClient };
