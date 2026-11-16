import { prisma } from "@/server/db/client";
import { getRequestContext } from "@/server/db/context";

/**
 * Append-only audit trail. Payments, subscription edits, role changes and
 * super-admin impersonation all land here — this is what settles "I paid cash
 * and your staff pocketed it" disputes.
 *
 * AuditLog has a NULLABLE gymId (platform actions), so it is written through the
 * platform client with an explicit gymId rather than the tenant client.
 */
export type AuditEntry = {
  gymId: string | null;
  actorUserId: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
};

export async function writeAudit(entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      gymId: entry.gymId,
      actorUserId: entry.actorUserId,
      actorRole: entry.actorRole ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: (entry.before ?? undefined) as never,
      after: (entry.after ?? undefined) as never,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent?.slice(0, 400) ?? null,
    },
  });
}

/** Convenience for code already running inside withTenant(). */
export async function auditInContext(
  entry: Omit<AuditEntry, "gymId" | "actorUserId" | "actorRole">,
): Promise<void> {
  const ctx = getRequestContext();
  await writeAudit({
    ...entry,
    gymId: ctx?.gymId ?? null,
    actorUserId: ctx?.userId ?? null,
    actorRole: ctx?.role ?? null,
  });
}
