import { env } from "@/env";

/**
 * Minimal transactional email port. With no RESEND_API_KEY we log to the server
 * console, so password-reset and invite flows are fully testable in dev without
 * a provider account. Swap in Resend/SES by adding a driver here — callers and
 * the outbox worker do not change.
 */
export type Email = { to: string; subject: string; html: string; text?: string };

export async function sendEmail(email: Email): Promise<{ delivered: boolean; id?: string }> {
  const { RESEND_API_KEY, ALERTS_FROM_EMAIL } = env();
  if (!RESEND_API_KEY) {
    console.info(
      `\n[email:dev] to=${email.to} subject=${email.subject}\n${email.text ?? email.html}\n`,
    );
    return { delivered: false };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: ALERTS_FROM_EMAIL,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });
  if (!res.ok) {
    throw new Error(`Email provider rejected the message (${res.status})`);
  }
  const body = (await res.json()) as { id?: string };
  return { delivered: true, id: body.id };
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]!);
}

/** Absolute URL on the app host (used in emails, never relative). */
export function appUrl(path: string): string {
  const host = process.env.NEXT_PUBLIC_APP_HOST ?? "gym.brainorth.com";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto = isLocal ? "http" : "https";
  return `${proto}://${host}${path.startsWith("/") ? path : `/${path}`}`;
}
