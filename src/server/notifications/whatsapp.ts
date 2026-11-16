import { env } from "@/env";

export type WhatsAppMessage = {
  to: string;
  text: string;
};

/**
 * Minimal WhatsApp Cloud API port. With no WHATSAPP_TOKEN or
 * WHATSAPP_PHONE_NUMBER_ID we log to the server console so renewal reminders
 * and outbox flows are testable in dev without a Meta Business account.
 */
export async function sendWhatsApp({
  to,
  text,
}: WhatsAppMessage): Promise<{ delivered: boolean; id?: string }> {
  const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = env();
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.info(`\n[whatsapp:dev] to=${to}\n${text}\n`);
    return { delivered: false };
  }

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `WhatsApp provider rejected the message (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const body = (await res.json()) as { messages?: Array<{ id?: string }> };
  return { delivered: true, id: body.messages?.[0]?.id };
}
