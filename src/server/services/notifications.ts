import type { Prisma } from "@/generated/prisma/client";
import { addDays, gymLocalDate, toInputValue } from "@/lib/dates";
import { prisma } from "@/server/db/client";
import { appUrl, sendEmail } from "@/server/notifications/mailer";
import { sendWhatsApp } from "@/server/notifications/whatsapp";

const MAX_ATTEMPTS = 5;

type RenewalPayload = {
  gymId: string;
  gymName: string;
  gymSlug: string;
  subscriptionId: string;
  memberId: string;
  memberName: string;
  planName: string;
  effectiveEndDate: string;
  daysLeft: number;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderRenewalEmail(payload: RenewalPayload) {
  const portalLink = appUrl(`/${payload.gymSlug}/portal`);
  const when = payload.daysLeft === 1 ? "tomorrow" : `in ${payload.daysLeft} days`;
  const subject = `${payload.gymName}: Your ${payload.planName} membership expires ${when}`;
  const text = [
    `Hi ${payload.memberName},`,
    "",
    `Your ${payload.planName} membership at ${payload.gymName} is set to expire on ${payload.effectiveEndDate} (${when}).`,
    `Renew or check your membership status anytime: ${portalLink}`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(payload.memberName)},</p>`,
    `<p>Your <strong>${escapeHtml(payload.planName)}</strong> membership at <strong>${escapeHtml(payload.gymName)}</strong> is set to expire on <strong>${escapeHtml(payload.effectiveEndDate)}</strong> (${escapeHtml(when)}).</p>`,
    `<p><a href="${escapeHtml(portalLink)}">View your member portal</a> to renew.</p>`,
  ].join("");

  return { subject, text, html };
}

function renderRenewalWhatsApp(payload: RenewalPayload): string {
  const portalLink = appUrl(`/${payload.gymSlug}/portal`);
  const when = payload.daysLeft === 1 ? "tomorrow" : `in ${payload.daysLeft} days`;
  return `Hi ${payload.memberName}, your ${payload.planName} membership at ${payload.gymName} expires ${when} (${payload.effectiveEndDate}). View details: ${portalLink}`;
}

/**
 * Scan all active gyms and enqueue EMAIL / WHATSAPP renewal reminders for
 * active subscriptions expiring in 3 days or 1 day (in each gym's local TZ).
 * Idempotent via `dedupeKey` + `skipDuplicates`.
 */
export async function enqueueRenewalReminders(
  now: Date = new Date(),
): Promise<{ enqueued: number }> {
  const gyms = await prisma.gym.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true, slug: true, timezone: true },
  });

  let enqueued = 0;

  for (const gym of gyms) {
    const today = gymLocalDate(now, gym.timezone);
    const in1Day = addDays(today, 1);
    const in3Days = addDays(today, 3);
    const in1DayStr = toInputValue(in1Day);

    const expiring = await prisma.memberSubscription.findMany({
      where: {
        gymId: gym.id,
        status: "ACTIVE",
        effectiveEndDate: { in: [in3Days, in1Day] },
        member: { status: "ACTIVE", archivedAt: null },
      },
      select: {
        id: true,
        effectiveEndDate: true,
        member: {
          select: { id: true, fullName: true, email: true, phone: true },
        },
        plan: { select: { name: true } },
      },
    });

    if (expiring.length === 0) continue;

    const rows: Prisma.NotificationOutboxCreateManyInput[] = [];

    for (const sub of expiring) {
      const endDateStr = toInputValue(sub.effectiveEndDate);
      const daysLeft = endDateStr === in1DayStr ? 1 : 3;
      const template =
        daysLeft === 1 ? "membership.expiring_1d" : "membership.expiring_3d";

      const payload: RenewalPayload = {
        gymId: gym.id,
        gymName: gym.name,
        gymSlug: gym.slug,
        subscriptionId: sub.id,
        memberId: sub.member.id,
        memberName: sub.member.fullName,
        planName: sub.plan.name,
        effectiveEndDate: endDateStr,
        daysLeft,
      };

      if (sub.member.email) {
        rows.push({
          gymId: gym.id,
          channel: "EMAIL",
          template,
          recipient: sub.member.email,
          payload,
          dedupeKey: `renewal:${sub.id}:${endDateStr}:EMAIL`,
        });
      }

      if (sub.member.phone) {
        rows.push({
          gymId: gym.id,
          channel: "WHATSAPP",
          template,
          recipient: sub.member.phone,
          payload,
          dedupeKey: `renewal:${sub.id}:${endDateStr}:WHATSAPP`,
        });
      }
    }

    if (rows.length === 0) continue;

    const result = await prisma.notificationOutbox.createMany({
      data: rows,
      skipDuplicates: true,
    });
    enqueued += result.count;
  }

  return { enqueued };
}

/**
 * Drain due PENDING notifications from the outbox with atomic claim (`SENDING`)
 * and bounded retries (`MAX_ATTEMPTS`).
 */
export async function drainNotificationOutbox(limit = 50): Promise<{
  processed: number;
  sent: number;
  failed: number;
}> {
  const now = new Date();
  const candidates = await prisma.notificationOutbox.findMany({
    where: {
      status: "PENDING",
      scheduledFor: { lte: now },
      attempts: { lt: MAX_ATTEMPTS },
    },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
    take: limit,
  });

  let processed = 0;
  let sent = 0;
  let failed = 0;

  for (const row of candidates) {
    const claimed = await prisma.notificationOutbox.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: { status: "SENDING" },
    });
    if (claimed.count === 0) continue;

    processed += 1;

    try {
      const payload = row.payload as Record<string, unknown>;

      if (row.channel === "EMAIL") {
        const rendered =
          typeof payload.subject === "string" && typeof payload.html === "string"
            ? {
                subject: payload.subject,
                html: payload.html,
                text: typeof payload.text === "string" ? payload.text : undefined,
              }
            : renderRenewalEmail(payload as unknown as RenewalPayload);

        await sendEmail({
          to: row.recipient,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
      } else if (row.channel === "WHATSAPP") {
        const text =
          typeof payload.text === "string"
            ? payload.text
            : renderRenewalWhatsApp(payload as unknown as RenewalPayload);

        await sendWhatsApp({ to: row.recipient, text });
      } else {
        throw new Error(`Unsupported notification channel: ${row.channel}`);
      }

      await prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          lastError: null,
        },
      });
      sent += 1;
    } catch (err) {
      const nextAttempts = row.attempts + 1;
      const exhausted = nextAttempts >= MAX_ATTEMPTS;
      const message = err instanceof Error ? err.message : String(err);

      await prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          attempts: nextAttempts,
          status: exhausted ? "FAILED" : "PENDING",
          lastError: message.slice(0, 1000),
        },
      });
      failed += 1;
    }
  }

  return { processed, sent, failed };
}
