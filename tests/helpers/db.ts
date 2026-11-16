import { createIsolatedPrismaClient } from "@/server/db/client";
import { ALL_MODELS } from "@/server/db/tenant-registry";
import type { PrismaClient } from "@/generated/prisma/client";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Point it at a SEPARATE database — the suite truncates every table.",
  );
}
if (url === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL.");
}

export const testPrisma: PrismaClient = createIsolatedPrismaClient(url);

export async function resetDb(): Promise<void> {
  const tables = ALL_MODELS.map((m) => `"${m}"`).join(", ");
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

export type Fixture = Awaited<ReturnType<typeof seedTwoGyms>>;

/** Two fully-populated gyms that must never see each other. */
export async function seedTwoGyms() {
  const ownerA = await testPrisma.user.create({
    data: { email: "owner.a@test.local", name: "Owner A", passwordHash: "x" },
  });
  const ownerB = await testPrisma.user.create({
    data: { email: "owner.b@test.local", name: "Owner B", passwordHash: "x" },
  });

  const mkGym = async (name: string, slug: string, ownerId: string) =>
    testPrisma.gym.create({
      data: { name, slug, ownerId, qrSecret: `secret-${slug}`, timezone: "Asia/Kolkata" },
    });

  const gymA = await mkGym("Gold's Gym A", "golds-a", ownerA.id);
  const gymB = await mkGym("Iron Temple B", "iron-b", ownerB.id);

  for (const [gym, owner] of [
    [gymA, ownerA],
    [gymB, ownerB],
  ] as const) {
    await testPrisma.gymMembership.create({
      data: { gymId: gym.id, userId: owner.id, role: "GYM_OWNER" },
    });
  }

  const mkTenantData = async (gymId: string, tag: string) => {
    const member = await testPrisma.memberProfile.create({
      data: {
        gymId,
        memberCode: `${tag}-0001`,
        fullName: `Member ${tag}`,
        phone: tag === "A" ? "9000000001" : "9000000002",
      },
    });
    const plan = await testPrisma.plan.create({
      data: { gymId, name: `Monthly ${tag}`, durationInDays: 30, priceMinor: 150000 },
    });
    const subscription = await testPrisma.memberSubscription.create({
      data: {
        gymId,
        memberId: member.id,
        planId: plan.id,
        startDate: new Date("2026-11-01"),
        endDate: new Date("2026-12-01"),
        effectiveEndDate: new Date("2026-12-01"),
        priceMinor: 150000,
      },
    });
    const payment = await testPrisma.payment.create({
      data: {
        gymId,
        memberId: member.id,
        subscriptionId: subscription.id,
        amountMinor: 150000,
        method: "CASH",
      },
    });
    const attendance = await testPrisma.attendance.create({
      data: {
        gymId,
        memberId: member.id,
        subscriptionId: subscription.id,
        checkInTime: new Date("2026-11-16T03:30:00Z"), // 09:00 IST
        localDate: new Date("2026-11-16"),
      },
    });
    return { member, plan, subscription, payment, attendance };
  };

  const a = await mkTenantData(gymA.id, "A");
  const b = await mkTenantData(gymB.id, "B");
  return { ownerA, ownerB, gymA, gymB, a, b };
}
