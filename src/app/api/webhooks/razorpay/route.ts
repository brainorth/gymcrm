import { NextResponse } from "next/server";
import { AppError } from "@/server/db/errors";
import { processRazorpayWebhook } from "@/server/services/payment-links";

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature") ?? "";

    const result = await processRazorpayWebhook(rawBody, signature);
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.expose ? error.message : "Webhook rejected." },
        { status: error.status },
      );
    }
    console.error("[webhook:razorpay]", error);
    return NextResponse.json(
      { ok: false, code: "INTERNAL", error: "Failed to process webhook." },
      { status: 500 },
    );
  }
}
