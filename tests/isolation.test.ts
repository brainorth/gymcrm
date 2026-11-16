import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { tenantDb } from "@/server/db/tenant-client";
import { TenantScopeError } from "@/server/db/errors";
import { runWithRequestContext } from "@/server/db/context";
import { resetDb, seedTwoGyms, testPrisma, type Fixture } from "./helpers/db.ts";

/**
 * The most important suite in the repo. Every rule the tenant guard claims is
 * executed here against a real Postgres with two populated gyms.
 */
describe("tenant isolation", () => {
  let f: Fixture;

  before(async () => {
    await resetDb();
    f = await seedTwoGyms();
  });
  after(async () => {
    await testPrisma.$disconnect();
  });
  beforeEach(async () => {
    // Re-seed only if a previous test mutated data destructively.
    const count = await testPrisma.gym.count();
    if (count < 2) {
      await resetDb();
      f = await seedTwoGyms();
    }
  });

  it("findMany only returns the caller's gym rows", async () => {
    const db = tenantDb(f.gymA.id, testPrisma);
    const members = await db.memberProfile.findMany();
    assert.equal(members.length, 1);
    assert.equal(members[0]?.id, f.a.member.id);

    for (const model of ["plan", "memberSubscription", "payment", "attendance"] as const) {
      const rows = await (db[model] as { findMany: () => Promise<Array<{ gymId: string }>> }).findMany();
      assert.ok(rows.length > 0, `${model} should have rows`);
      assert.ok(
        rows.every((r) => r.gymId === f.gymA.id),
        `${model} leaked another gym`,
      );
    }
  });

  it("findUnique with a foreign id returns null instead of the row", async () => {
    const db = tenantDb(f.gymA.id, testPrisma);
    const stolen = await db.memberProfile.findUnique({ where: { id: f.b.member.id } });
    assert.equal(stolen, null);
  });

  it("count / aggregate / groupBy are scoped", async () => {
    const db = tenantDb(f.gymA.id, testPrisma);
    assert.equal(await db.payment.count(), 1);
    const agg = await db.payment.aggregate({ _sum: { amountMinor: true } });
    assert.equal(agg._sum.amountMinor, 150000); // not 300000
    const grouped = await db.payment.groupBy({ by: ["method"], _count: true });
    assert.equal(grouped.length, 1);
  });

  it("explicitly filtering another gymId throws (never silently rewritten)", async () => {
    const db = tenantDb(f.gymA.id, testPrisma);
    await assert.rejects(
      () => db.memberProfile.findMany({ where: { gymId: f.gymB.id } }),
      TenantScopeError,
    );
  });

  it("OR clauses cannot escape the scope", async () => {
    const db = tenantDb(f.gymA.id, testPrisma);
    const rows = await db.memberProfile.findMany({
      where: { OR: [{ id: f.a.member.id }, { id: f.b.member.id }] },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, f.a.member.id);
  });

  it("update of a foreign row fails and leaves it untouched", async () => {
    const db = tenantDb(f.gymA.id, testPrisma);
    await assert.rejects(() =>
      db.memberProfile.update({
        where: { id: f.b.member.id },
        data: { fullName: "HACKED" },
      }),
    );
    const untouched = await testPrisma.memberProfile.findUnique({
      where: { id: f.b.member.id },
    });
    assert.equal(untouched?.fullName, "Member B");
  });

  it("updateMany / deleteMany cannot reach across gyms", async () => {
    const db = tenantDb(f.gymA.id, testPrisma);
    const updated = await db.memberProfile.updateMany({
      where: { id: f.b.member.id },
      data: { fullName: "HACKED" },
    });
    assert.equal(updated.count, 0);
    const deleted = await db.payment.deleteMany({ where: { id: f.b.payment.id } });
    assert.equal(deleted.count, 0);
    assert.ok(await testPrisma.payment.findUnique({ where: { id: f.b.payment.id } }));
  });

  it("create stamps gymId and refuses a foreign gymId", async () => {
    const db = tenantDb(f.gymA.id, testPrisma);
    const created = await db.plan.create({
      // tenantDb stamps gymId at runtime
      data: { name: "Quarterly A", durationInDays: 90, priceMinor: 400000 } as never,
    });
    assert.equal(created.gymId, f.gymA.id);
    await testPrisma.plan.delete({ where: { id: created.id } });

    await assert.rejects(
      () =>
        db.plan.create({
          data: {
            gymId: f.gymB.id,
            name: "Smuggled",
            durationInDays: 30,
            priceMinor: 100,
          },
        }),
      TenantScopeError,
    );
  });

  it("createMany stamps every row", async () => {
    const db = tenantDb(f.gymA.id, testPrisma);
    await db.plan.createMany({
      // tenantDb stamps gymId at runtime
      data: [
        { name: "Bulk 1", durationInDays: 7, priceMinor: 1000 },
        { name: "Bulk 2", durationInDays: 14, priceMinor: 2000 },
      ] as never,
    });
    const rows = await db.plan.findMany({ where: { name: { startsWith: "Bulk" } } });
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.gymId === f.gymA.id));
    await db.plan.deleteMany({ where: { name: { startsWith: "Bulk" } } });
  });

  it("nested relation writes are rejected", async () => {
    const db = tenantDb(f.gymA.id, testPrisma);
    await assert.rejects(
      () =>
        db.memberProfile.create({
          data: {
            memberCode: "A-9999",
            fullName: "Nested",
            phone: "9111111111",
            subscriptions: {
              create: {
                planId: f.a.plan.id,
                startDate: new Date("2026-11-01"),
                endDate: new Date("2026-12-01"),
                effectiveEndDate: new Date("2026-12-01"),
                priceMinor: 1,
              },
            },
          } as never,
        }),
      TenantScopeError,
    );
  });

  it("cannot traverse into platform tables via include/select", async () => {
    const db = tenantDb(f.gymA.id, testPrisma);
    await assert.rejects(
      () => db.gymMembership.findMany({ include: { user: true } }),
      TenantScopeError,
    );
    await assert.rejects(
      () => db.memberProfile.findMany({ select: { id: true, user: { select: { email: true } } } }),
      TenantScopeError,
    );
  });

  it("platform-only models are denied entirely (fail-closed)", async () => {
    const db = tenantDb(f.gymA.id, testPrisma);
    for (const model of ["user", "session", "verificationToken", "saasPlan"] as const) {
      await assert.rejects(
        () => (db[model] as { findMany: () => Promise<unknown> }).findMany(),
        TenantScopeError,
      );
    }
  });

  it("raw SQL is rejected on the tenant client", async () => {
    const db = tenantDb(f.gymA.id, testPrisma);
    await assert.rejects(
      () => db.$queryRawUnsafe('SELECT * FROM "Payment"'),
      TenantScopeError,
    );
    await assert.rejects(
      () => db.$executeRawUnsafe('DELETE FROM "Payment"'),
      TenantScopeError,
    );
  });

  it("the guard survives inside $transaction", async () => {
    const db = tenantDb(f.gymA.id, testPrisma);
    await assert.rejects(
      () =>
        db.$transaction(async (tx) => {
          await tx.plan.create({
            // tenantDb stamps gymId at runtime
            data: { name: "Tx OK", durationInDays: 1, priceMinor: 1 } as never,
          });
          await tx.plan.create({
            data: {
              gymId: f.gymB.id,
              name: "Tx BAD",
              durationInDays: 1,
              priceMinor: 1,
            },
          });
        }),
      TenantScopeError,
    );
    assert.equal(await testPrisma.plan.count({ where: { name: "Tx OK" } }), 0);
  });

  it("Gym itself is scoped by id", async () => {
    const db = tenantDb(f.gymA.id, testPrisma);
    const gyms = await db.gym.findMany();
    assert.equal(gyms.length, 1);
    assert.equal(gyms[0]?.id, f.gymA.id);
    const foreign = await db.gym.findUnique({ where: { slug: f.gymB.slug } });
    assert.equal(foreign, null);
  });

  it("ambient request context must agree with the client's gymId", async () => {
    await assert.rejects(
      () =>
        runWithRequestContext(
          {
            requestId: "r1",
            gymId: f.gymA.id,
            gymSlug: f.gymA.slug,
            userId: f.ownerA.id,
            role: "GYM_OWNER",
            impersonating: false,
          },
          // NOTE: PrismaPromise is lazy — it must be awaited INSIDE the context.
          async () => {
            await tenantDb(f.gymB.id, testPrisma).memberProfile.findMany();
          },
        ),
      TenantScopeError,
    );
  });
});

describe("database-level backstop", () => {
  let f: Fixture;
  before(async () => {
    await resetDb();
    f = await seedTwoGyms();
  });
  after(async () => {
    await testPrisma.$disconnect();
  });

  it("composite FK rejects a subscription mixing two gyms", async () => {
    await assert.rejects(
      () =>
        testPrisma.memberSubscription.create({
          data: {
            gymId: f.gymA.id,
            memberId: f.b.member.id, // gym B's member
            planId: f.a.plan.id,
            startDate: new Date("2026-11-01"),
            endDate: new Date("2026-12-01"),
            effectiveEndDate: new Date("2026-12-01"),
            priceMinor: 100,
          },
        }),
      /foreign key constraint|P2003/i,
    );
  });

  it("composite FK rejects a payment attached to another gym's subscription", async () => {
    await assert.rejects(
      () =>
        testPrisma.payment.create({
          data: {
            gymId: f.gymA.id,
            memberId: f.a.member.id,
            subscriptionId: f.b.subscription.id,
            amountMinor: 100,
            method: "CASH",
          },
        }),
      /foreign key constraint|P2003/i,
    );
  });

  it("one check-in per member per local day", async () => {
    await assert.rejects(() =>
      testPrisma.attendance.create({
        data: {
          gymId: f.gymA.id,
          memberId: f.a.member.id,
          checkInTime: new Date("2026-11-16T12:00:00Z"),
          localDate: new Date("2026-11-16"),
        },
      }),
    );
  });
});
