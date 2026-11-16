import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/env";
import {
  drainNotificationOutbox,
  enqueueRenewalReminders,
} from "@/server/services/notifications";

export const dynamic = "force-dynamic";

function verifyCronAuth(request: Request): NextResponse | null {
  const secret = env().CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  const token = match?.[1];
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid authorization header" },
      { status: 401 },
    );
  }

  const provided = Buffer.from(token, "utf8");
  const expected = Buffer.from(secret, "utf8");
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return NextResponse.json(
      { ok: false, error: "Invalid cron secret" },
      { status: 401 },
    );
  }

  return null;
}

async function handleCron(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const { enqueued } = await enqueueRenewalReminders();
  const { processed, sent, failed } = await drainNotificationOutbox();

  return NextResponse.json({
    ok: true,
    enqueued,
    processed,
    sent,
    failed,
  });
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
