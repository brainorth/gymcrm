import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 config (replaces package.json#prisma and implicit .env loading).
 *
 * Supabase has two connection strings and they are NOT interchangeable:
 *   DATABASE_URL -> transaction pooler (:6543)  -> used by the app at runtime
 *   DIRECT_URL   -> direct / session pooler (:5432) -> used for migrations
 * Migrations take advisory locks and run DDL, which transaction pooling breaks.
 */
const migrationUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!migrationUrl) {
  throw new Error(
    "Set DIRECT_URL (preferred) or DATABASE_URL in .env before running Prisma CLI commands.",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: migrationUrl,
    // Only needed if your role cannot CREATE DATABASE (Supabase pooled roles):
    // shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
