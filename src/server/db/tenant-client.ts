import { prisma, type PrismaClient } from "./client";
import { getRequestContext } from "./context";
import { TenantScopeError } from "./errors";
import { isTenantModel, tenantMeta, type TenantModelMeta } from "./tenant-registry";

/**
 * ============================================================================
 * THE TENANT GUARD
 * ============================================================================
 * `tenantDb(gymId)` returns a Prisma client that is structurally incapable of
 * touching another gym's rows. It is the ONLY client tenant code may use.
 *
 * Five enforced rules:
 *  1. Fail-closed model access — a model that is not registered as tenant-owned
 *     (User, Session, VerificationToken, ...) throws. New tables are denied
 *     until `npm run gen:tenant-registry` classifies them.
 *  2. Every where clause gets `gymId` (or `id` for Gym) injected. A caller that
 *     passes a DIFFERENT gymId throws instead of being silently corrected, so
 *     bugs surface in tests rather than in production.
 *  3. Every create gets gymId stamped; createMany stamps every row.
 *  4. Nested relation writes are REJECTED. `data: { subscriptions: { create } }`
 *     would bypass rule 3 for the child rows, so we forbid it outright and
 *     require explicit scoped calls inside a transaction.
 *  5. include/select may not traverse into platform tables (that is how
 *     `include: { user: { include: { memberships: true } } }` leaks other gyms,
 *     and how passwordHash escapes). Raw SQL is rejected too.
 *
 * The database backs this up with composite FKs ([parentId, gymId] -> [id, gymId]),
 * so even a hand-written platform query cannot mix two tenants' rows.
 */

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

const NESTED_WRITE_KEYS = new Set([
  "create",
  "createMany",
  "connect",
  "connectOrCreate",
  "upsert",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "set",
  "disconnect",
]);

type Dict = Record<string, unknown>;

function isPlainObject(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rule 2 — inject the tenant key, refusing any conflicting value. */
function scopeWhere(
  where: unknown,
  meta: TenantModelMeta,
  gymId: string,
  model: string,
  operation: string,
): Dict {
  const col = meta.scope;
  if (where === undefined || where === null) return { [col]: gymId };
  if (!isPlainObject(where)) {
    throw new TenantScopeError(`Unsupported where shape on ${model}.${operation}`);
  }
  const existing = where[col];
  if (existing !== undefined && existing !== gymId) {
    throw new TenantScopeError(
      `${model}.${operation} tried to filter ${col}=${JSON.stringify(existing)} inside gym ${gymId}`,
      { model, operation, attempted: existing, gymId },
    );
  }
  return { ...where, [col]: gymId };
}

/** Rule 4 — no nested writes, anywhere in the payload. */
function assertNoNestedWrites(
  value: unknown,
  meta: TenantModelMeta,
  model: string,
  path = "data",
  topLevel = true,
): void {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      assertNoNestedWrites(item, meta, model, `${path}[${i}]`, false);
    }
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (topLevel && meta.jsonFields.includes(key)) continue; // arbitrary JSON
    if (NESTED_WRITE_KEYS.has(key) && (isPlainObject(child) || Array.isArray(child))) {
      throw new TenantScopeError(
        `Nested write "${path}.${key}" is not allowed on ${model}. ` +
          `Write the child explicitly with tenantDb(gymId) inside a transaction.`,
        { model, path: `${path}.${key}` },
      );
    }
    assertNoNestedWrites(child, meta, model, `${path}.${key}`, false);
  }
}

/** Rule 3 — stamp the tenant key on writes. */
function scopeCreateData(
  data: unknown,
  meta: TenantModelMeta,
  gymId: string,
  model: string,
): Dict | Dict[] {
  const stamp = (row: unknown): Dict => {
    if (!isPlainObject(row)) {
      throw new TenantScopeError(`Unsupported create payload on ${model}`);
    }
    const col = meta.scope;
    if (row[col] !== undefined && row[col] !== gymId) {
      throw new TenantScopeError(
        `${model}.create tried to write ${col}=${JSON.stringify(row[col])} inside gym ${gymId}`,
        { model, attempted: row[col], gymId },
      );
    }
    assertNoNestedWrites(row, meta, model);
    return { ...row, [col]: gymId };
  };
  if (Array.isArray(data)) return data.map(stamp);
  return stamp(data);
}

/** Rule 5 — selections may not walk into platform tables. */
function assertSelectionAllowed(
  selection: unknown,
  model: string,
  path: string,
): void {
  if (!isPlainObject(selection)) return;
  const meta = tenantMeta(model);
  for (const [key, value] of Object.entries(selection)) {
    const target = meta?.relations[key];
    if (!target) continue; // scalar field
    if (!isTenantModel(target)) {
      throw new TenantScopeError(
        `${path}.${key} traverses into platform table "${target}". ` +
          `Read it with an explicit, hand-scoped platform query instead.`,
        { model, relation: key, target },
      );
    }
    if (isPlainObject(value)) {
      const nested = value as Dict;
      assertSelectionAllowed(nested.select, target, `${path}.${key}.select`);
      assertSelectionAllowed(nested.include, target, `${path}.${key}.include`);
      // Relation filters (some/every/none) still run under the parent's scope.
      assertSelectionAllowed(nested.where, target, `${path}.${key}.where`);
    }
  }
}

function guardArgs(
  model: string,
  operation: string,
  args: unknown,
  gymId: string,
): unknown {
  if (!isTenantModel(model)) {
    throw new TenantScopeError(
      `Model "${model}" is platform-only and cannot be used from a tenant scope.`,
      { model, operation, gymId },
    );
  }
  const meta = tenantMeta(model)!;
  const a: Dict = isPlainObject(args) ? { ...args } : {};

  if (WHERE_OPS.has(operation)) {
    a.where = scopeWhere(a.where, meta, gymId, model, operation);
  }

  switch (operation) {
    case "create":
    case "createMany":
    case "createManyAndReturn":
      a.data = scopeCreateData(a.data, meta, gymId, model);
      break;
    case "update":
    case "updateMany":
    case "updateManyAndReturn":
      assertNoNestedWrites(a.data, meta, model);
      break;
    case "upsert":
      a.create = scopeCreateData(a.create, meta, gymId, model);
      assertNoNestedWrites(a.update, meta, model, "update");
      break;
    default:
      break;
  }

  assertSelectionAllowed(a.include, model, `${model}.include`);
  assertSelectionAllowed(a.select, model, `${model}.select`);
  return a;
}

function blockRaw(operation: string): never {
  throw new TenantScopeError(
    `${operation} bypasses the tenant guard. Use a platform-client query with an explicit gymId, or raw SQL inside withTenantTransaction().`,
    { operation },
  );
}

export type TenantDb = ReturnType<typeof createTenantClient>;

function createTenantClient(base: PrismaClient, gymId: string) {
  if (!gymId) throw new TenantScopeError("tenantDb() requires a non-empty gymId");
  return base.$extends({
    name: `tenant:${gymId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // Second pair of eyes: if a request context exists, it must agree.
          const ambient = getRequestContext();
          if (ambient && ambient.gymId !== gymId) {
            throw new TenantScopeError(
              `tenantDb(${gymId}) used inside a request scoped to gym ${ambient.gymId}`,
              { ambient: ambient.gymId, requested: gymId },
            );
          }
          const guarded = guardArgs(model ?? "", operation, args, gymId);
          return query(guarded as typeof args);
        },
      },
      $queryRaw: () => blockRaw("$queryRaw"),
      $executeRaw: () => blockRaw("$executeRaw"),
      $queryRawUnsafe: () => blockRaw("$queryRawUnsafe"),
      $executeRawUnsafe: () => blockRaw("$executeRawUnsafe"),
    },
  });
}

const cache = new Map<string, TenantDb>();

/**
 * Get the tenant-scoped client. Cheap and cached; extensions also apply inside
 * `$transaction`, so `db.$transaction(async (tx) => tx.plan.create(...))` stays
 * guarded.
 */
export function tenantDb(gymId: string, base: PrismaClient = prisma): TenantDb {
  if (base !== prisma) return createTenantClient(base, gymId);
  const hit = cache.get(gymId);
  if (hit) return hit;
  if (cache.size > 500) cache.clear();
  const created = createTenantClient(base, gymId);
  cache.set(gymId, created);
  return created;
}
