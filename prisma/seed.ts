import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { addDays, gymLocalDate } from "../src/lib/dates";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL (or DIRECT_URL) must be set to run prisma/seed.ts");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const now = new Date();
  const timeZone = "Asia/Kolkata";
  const today = gymLocalDate(now, timeZone);

  // 1. SaaS Plans
  const starterPlan = await prisma.saasPlan.upsert({
    where: { code: "starter" },
    update: {
      name: "Starter",
      interval: "MONTH",
      priceMinor: 99900,
      currency: "INR",
      maxMembers: 150,
      isActive: true,
      sortOrder: 1,
    },
    create: {
      code: "starter",
      name: "Starter",
      interval: "MONTH",
      priceMinor: 99900,
      currency: "INR",
      maxMembers: 150,
      isActive: true,
      sortOrder: 1,
    },
  });

  const proPlan = await prisma.saasPlan.upsert({
    where: { code: "pro" },
    update: {
      name: "Pro",
      interval: "MONTH",
      priceMinor: 199900,
      currency: "INR",
      maxMembers: null,
      isActive: true,
      sortOrder: 2,
    },
    create: {
      code: "pro",
      name: "Pro",
      interval: "MONTH",
      priceMinor: 199900,
      currency: "INR",
      maxMembers: null,
      isActive: true,
      sortOrder: 2,
    },
  });

  // 2. Super Admin
  const [adminHash, ownerHash, staffHash, trainerHash] = await Promise.all([
    hashPassword("AdminPassword123!"),
    hashPassword("OwnerPassword123!"),
    hashPassword("StaffPassword123!"),
    hashPassword("TrainerPassword123!"),
  ]);

  const superAdmin = await prisma.user.upsert({
    where: { email: "admin@brainorth.com" },
    update: {
      name: "Platform Admin",
      passwordHash: adminHash,
      platformRole: "SUPER_ADMIN",
      isActive: true,
    },
    create: {
      email: "admin@brainorth.com",
      emailVerifiedAt: now,
      name: "Platform Admin",
      passwordHash: adminHash,
      platformRole: "SUPER_ADMIN",
      isActive: true,
    },
  });

  // 3. Demo Gym Owner + Gym + SaaS Subscription
  const owner = await prisma.user.upsert({
    where: { email: "owner@brainorth.com" },
    update: {
      name: "Aarav Sharma",
      passwordHash: ownerHash,
      isActive: true,
    },
    create: {
      email: "owner@brainorth.com",
      emailVerifiedAt: now,
      name: "Aarav Sharma",
      phone: "9876543210",
      passwordHash: ownerHash,
      isActive: true,
    },
  });

  const gym = await prisma.gym.upsert({
    where: { slug: "iron-pulse" },
    update: {
      name: "Iron Pulse Fitness",
      timezone: timeZone,
      currency: "INR",
      billingStatus: "ACTIVE",
      status: "ACTIVE",
      ownerId: owner.id,
    },
    create: {
      name: "Iron Pulse Fitness",
      slug: "iron-pulse",
      status: "ACTIVE",
      ownerId: owner.id,
      timezone: timeZone,
      currency: "INR",
      phone: "9876543210",
      addressLine: "42 Indiranagar 100 Feet Road",
      city: "Bengaluru",
      billingStatus: "ACTIVE",
      qrSecret: randomBytes(32).toString("hex"),
    },
  });

  await prisma.gymMembership.upsert({
    where: { userId_gymId: { userId: owner.id, gymId: gym.id } },
    update: { role: "GYM_OWNER", isActive: true },
    create: { userId: owner.id, gymId: gym.id, role: "GYM_OWNER", isActive: true },
  });

  await prisma.saasSubscription.upsert({
    where: { gymId: gym.id },
    update: {
      planId: proPlan.id,
      status: "ACTIVE",
      provider: "MANUAL",
      currentPeriodStart: addDays(today, -10),
      currentPeriodEnd: addDays(today, 20),
    },
    create: {
      gymId: gym.id,
      planId: proPlan.id,
      status: "ACTIVE",
      provider: "MANUAL",
      currentPeriodStart: addDays(today, -10),
      currentPeriodEnd: addDays(today, 20),
    },
  });

  // 4. Staff & Trainer Users
  const staff = await prisma.user.upsert({
    where: { email: "staff@brainorth.com" },
    update: {
      name: "Priya Nair",
      passwordHash: staffHash,
      isActive: true,
    },
    create: {
      email: "staff@brainorth.com",
      emailVerifiedAt: now,
      name: "Priya Nair",
      phone: "9876543211",
      passwordHash: staffHash,
      isActive: true,
    },
  });

  await prisma.gymMembership.upsert({
    where: { userId_gymId: { userId: staff.id, gymId: gym.id } },
    update: { role: "STAFF", isActive: true, invitedBy: owner.id },
    create: {
      userId: staff.id,
      gymId: gym.id,
      role: "STAFF",
      isActive: true,
      invitedBy: owner.id,
    },
  });

  const trainer = await prisma.user.upsert({
    where: { email: "trainer@brainorth.com" },
    update: {
      name: "Rohan Verma",
      passwordHash: trainerHash,
      isActive: true,
    },
    create: {
      email: "trainer@brainorth.com",
      emailVerifiedAt: now,
      name: "Rohan Verma",
      phone: "9876543212",
      passwordHash: trainerHash,
      isActive: true,
    },
  });

  await prisma.gymMembership.upsert({
    where: { userId_gymId: { userId: trainer.id, gymId: gym.id } },
    update: { role: "TRAINER", isActive: true, invitedBy: owner.id },
    create: {
      userId: trainer.id,
      gymId: gym.id,
      role: "TRAINER",
      isActive: true,
      invitedBy: owner.id,
    },
  });

  // 5. Gym Membership Plans
  const monthlyPlan = await prisma.plan.upsert({
    where: { gymId_name: { gymId: gym.id, name: "Monthly" } },
    update: {
      durationInDays: 30,
      priceMinor: 150000,
      currency: "INR",
      maxFreezeDays: 7,
      isActive: true,
      sortOrder: 1,
    },
    create: {
      gymId: gym.id,
      name: "Monthly",
      description: "Full gym floor & group classes for 30 days",
      durationInDays: 30,
      priceMinor: 150000,
      currency: "INR",
      maxFreezeDays: 7,
      isActive: true,
      sortOrder: 1,
    },
  });

  const quarterlyPlan = await prisma.plan.upsert({
    where: { gymId_name: { gymId: gym.id, name: "Quarterly" } },
    update: {
      durationInDays: 90,
      priceMinor: 400000,
      currency: "INR",
      maxFreezeDays: 15,
      isActive: true,
      sortOrder: 2,
    },
    create: {
      gymId: gym.id,
      name: "Quarterly",
      description: "Full gym floor, group classes & 15-day freeze",
      durationInDays: 90,
      priceMinor: 400000,
      currency: "INR",
      maxFreezeDays: 15,
      isActive: true,
      sortOrder: 2,
    },
  });

  // 6. Demo Members + Active Subscriptions
  const memberSpecs = [
    {
      memberCode: "IMP-00001",
      fullName: "Vikram Patel",
      phone: "9811100001",
      email: "vikram.patel@example.com",
      plan: monthlyPlan,
      startOffsetDays: -27,
      endOffsetDays: 3, // Expiring in 3 days for dashboard renewal widget
    },
    {
      memberCode: "IMP-00002",
      fullName: "Ananya Iyer",
      phone: "9811100002",
      email: "ananya.iyer@example.com",
      plan: monthlyPlan,
      startOffsetDays: -10,
      endOffsetDays: 20,
    },
    {
      memberCode: "IMP-00003",
      fullName: "Kabir Malhotra",
      phone: "9811100003",
      email: "kabir.malhotra@example.com",
      plan: quarterlyPlan,
      startOffsetDays: -15,
      endOffsetDays: 75,
    },
  ] as const;

  const seededMembers: Array<{ id: string; memberCode: string; subscriptionId: string }> = [];

  for (const spec of memberSpecs) {
    const member = await prisma.memberProfile.upsert({
      where: { gymId_memberCode: { gymId: gym.id, memberCode: spec.memberCode } },
      update: {
        fullName: spec.fullName,
        phone: spec.phone,
        email: spec.email,
        status: "ACTIVE",
      },
      create: {
        gymId: gym.id,
        memberCode: spec.memberCode,
        fullName: spec.fullName,
        phone: spec.phone,
        email: spec.email,
        status: "ACTIVE",
        waiverAcceptedAt: now,
        waiverVersion: "v1",
      },
    });

    let subscription = await prisma.memberSubscription.findFirst({
      where: { gymId: gym.id, memberId: member.id, status: "ACTIVE" },
    });

    if (!subscription) {
      const startDate = addDays(today, spec.startOffsetDays);
      const endDate = addDays(today, spec.endOffsetDays);
      subscription = await prisma.memberSubscription.create({
        data: {
          gymId: gym.id,
          memberId: member.id,
          planId: spec.plan.id,
          startDate,
          endDate,
          effectiveEndDate: endDate,
          status: "ACTIVE",
          priceMinor: spec.plan.priceMinor,
          currency: "INR",
          createdById: owner.id,
        },
      });
    }

    seededMembers.push({
      id: member.id,
      memberCode: member.memberCode,
      subscriptionId: subscription.id,
    });
  }

  // 7. Payment & Today's Attendance for first member
  const firstMember = seededMembers[0]!;

  await prisma.payment.upsert({
    where: {
      gymId_idempotencyKey: {
        gymId: gym.id,
        idempotencyKey: "seed-payment-imp-00001",
      },
    },
    update: {},
    create: {
      gymId: gym.id,
      memberId: firstMember.id,
      subscriptionId: firstMember.subscriptionId,
      amountMinor: monthlyPlan.priceMinor,
      currency: "INR",
      method: "UPI",
      status: "SUCCEEDED",
      provider: "MANUAL",
      idempotencyKey: "seed-payment-imp-00001",
      recordedById: owner.id,
      notes: "Initial seeded membership payment",
    },
  });

  await prisma.attendance.upsert({
    where: {
      gymId_memberId_localDate: {
        gymId: gym.id,
        memberId: firstMember.id,
        localDate: today,
      },
    },
    update: {},
    create: {
      gymId: gym.id,
      memberId: firstMember.id,
      subscriptionId: firstMember.subscriptionId,
      checkInTime: now,
      localDate: today,
      source: "STAFF_SCAN",
      verifiedByUserId: staff.id,
    },
  });

  console.log("Seeded Brainorth Gym SaaS:", {
    saasPlans: [starterPlan.code, proPlan.code],
    superAdmin: superAdmin.email,
    gym: gym.slug,
    users: [owner.email, staff.email, trainer.email],
    plans: [monthlyPlan.name, quarterlyPlan.name],
    members: seededMembers.map((m) => m.memberCode),
  });
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
