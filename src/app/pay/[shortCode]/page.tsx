import { notFound } from "next/navigation";
import { env } from "@/env";
import { PublicPayCard } from "@/components/payments/public-pay-card";
import { getPublicPaymentLink } from "@/server/services/payment-links";

export const dynamic = "force-dynamic";

export default async function PublicPayPage({
  params,
}: {
  params: Promise<{ shortCode: string }>;
}) {
  const { shortCode } = await params;
  const link = await getPublicPaymentLink(shortCode);
  if (!link) notFound();

  const config = env();
  const isMockMode = config.NODE_ENV !== "production" && config.PAYMENTS_DRIVER === "mock";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <PublicPayCard link={link} isMockMode={isMockMode} />
    </main>
  );
}
