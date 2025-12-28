/**
 * Plaid Component Private/Internal Functions
 *
 * Internal mutations and queries used by actions and webhooks.
 * These are NOT exposed to the host app directly.
 *
 * COMPONENT NOTE: Uses internalMutation/internalQuery for component isolation.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server.js";
import type { QueryCtx, MutationCtx } from "./_generated/server.js";

// =============================================================================
// HELPER: Safe Upsert Pattern (TOCTOU Protection)
// =============================================================================

/**
 * Safe upsert pattern to handle TOCTOU (Time-of-Check-Time-of-Use) race conditions.
 *
 * Problem: In concurrent upsert operations, two calls might both:
 * 1. Query and find no existing record
 * 2. Both insert, creating duplicates
 *
 * Solution: Insert-first approach with duplicate detection and cleanup.
 * 1. Try to insert first (optimistic)
 * 2. After insert, check if duplicates exist (same key, different _id)
 * 3. If duplicates found, keep the one with earliest _creationTime, delete others
 * 4. If we deleted our insert, update the surviving record
 *
 * This ensures exactly one record per unique key, even under concurrent inserts.
 *
 * Alternative approach for existing records:
 * - Query first, if exists, update it
 * - If not exists, do insert-then-verify pattern above
 *
 * @param ctx - Mutation context
 * @param queryFn - Function to query for existing record(s) by unique key
 * @param insertFn - Function to insert a new record
 * @param updateFn - Function to update an existing record
 * @returns { created: boolean; id: string } - Whether record was created or updated
 */
async function safeUpsertWithDedup<T extends { _id: any; _creationTime: number }>(
  ctx: MutationCtx,
  queryFn: () => Promise<T | null>,
  queryAllFn: () => Promise<T[]>,
  insertFn: () => Promise<string>,
  updateFn: (id: any) => Promise<void>
): Promise<{ created: boolean; id: string }> {
  // First check if record exists
  const existing = await queryFn();

  if (existing) {
    // Record exists - just update it
    await updateFn(existing._id);
    return { created: false, id: String(existing._id) };
  }

  // No existing record - insert new one
  const newId = await insertFn();

  // CRITICAL: After insert, check for duplicates created by concurrent mutations
  // This handles the race condition where another mutation inserted between
  // our query and insert
  const allMatching = await queryAllFn();

  if (allMatching.length > 1) {
    // Duplicates detected! Keep the one with earliest creation time
    const sorted = allMatching.sort((a, b) => a._creationTime - b._creationTime);
    const survivor = sorted[0];
    const duplicates = sorted.slice(1);

    // Delete all duplicates
    for (const dup of duplicates) {
      await ctx.db.delete(dup._id);
    }

    // If our insert was a duplicate (not the survivor), update the survivor
    if (String(survivor._id) !== newId) {
      await updateFn(survivor._id);
      return { created: false, id: String(survivor._id) };
    }
  }

  return { created: true, id: newId };
}

// =============================================================================
// HELPER: Efficient ID Lookup
// =============================================================================

/**
 * Helper to get a plaidItem by its string ID efficiently using O(1) lookup.
 * Uses ctx.db.normalizeId() + ctx.db.get() instead of full table scan.
 */
async function getPlaidItemById(
  ctx: QueryCtx | MutationCtx,
  plaidItemId: string
) {
  // normalizeId converts string to proper Id type, returns null if invalid
  const id = ctx.db.normalizeId("plaidItems", plaidItemId);
  if (!id) return null;
  return await ctx.db.get(id);
}

// =============================================================================
// VALIDATORS (Reusable)
// =============================================================================

const balancesValidator = v.object({
  available: v.optional(v.number()),
  current: v.optional(v.number()),
  limit: v.optional(v.number()),
  isoCurrencyCode: v.string(),
});

const accountValidator = v.object({
  accountId: v.string(),
  name: v.string(),
  officialName: v.optional(v.string()),
  mask: v.optional(v.string()),
  type: v.string(),
  subtype: v.optional(v.string()),
  balances: balancesValidator,
});

const transactionValidator = v.object({
  accountId: v.string(),
  transactionId: v.string(),
  amount: v.number(),
  isoCurrencyCode: v.string(),
  date: v.string(),
  datetime: v.optional(v.string()),
  name: v.string(),
  merchantName: v.optional(v.string()),
  pending: v.boolean(),
  pendingTransactionId: v.optional(v.string()),
  categoryPrimary: v.optional(v.string()),
  categoryDetailed: v.optional(v.string()),
  paymentChannel: v.optional(v.string()),
});

const aprValidator = v.object({
  aprPercentage: v.number(),
  aprType: v.string(),
  balanceSubjectToApr: v.optional(v.number()),
  interestChargeAmount: v.optional(v.number()),
});

const recurringStreamValidator = v.object({
  streamId: v.string(),
  accountId: v.string(),
  description: v.string(),
  merchantName: v.optional(v.string()),
  averageAmount: v.number(),
  lastAmount: v.number(),
  isoCurrencyCode: v.string(),
  frequency: v.string(),
  status: v.union(
    v.literal("MATURE"),
    v.literal("EARLY_DETECTION"),
    v.literal("TOMBSTONED")
  ),
  isActive: v.boolean(),
  type: v.union(v.literal("inflow"), v.literal("outflow")),
  category: v.optional(v.string()),
  firstDate: v.optional(v.string()),
  lastDate: v.optional(v.string()),
  predictedNextDate: v.optional(v.string()),
});

// =============================================================================
// INTERNAL QUERIES
// =============================================================================

/**
 * Get a plaidItem by its Convex document ID.
 * Returns the item with its encrypted access token.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const getPlaidItem = internalQuery({
  args: { plaidItemId: v.string() },
  returns: v.union(
    v.object({
      _id: v.any(),
      userId: v.string(),
      itemId: v.string(),
      accessToken: v.string(),
      cursor: v.optional(v.string()),
      institutionId: v.optional(v.string()),
      institutionName: v.optional(v.string()),
      status: v.string(),
      syncError: v.optional(v.string()),
      createdAt: v.number(),
      lastSyncedAt: v.optional(v.number()),
      syncVersion: v.optional(v.number()),
      syncStartedAt: v.optional(v.number()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    // O(1) lookup using normalizeId + get
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) return null;

    return {
      _id: item._id,
      userId: item.userId,
      itemId: item.itemId,
      accessToken: item.accessToken,
      cursor: item.cursor,
      institutionId: item.institutionId,
      institutionName: item.institutionName,
      status: item.status,
      syncError: item.syncError,
      createdAt: item.createdAt,
      lastSyncedAt: item.lastSyncedAt,
      syncVersion: item.syncVersion,
      syncStartedAt: item.syncStartedAt,
    };
  },
});

/**
 * Get a plaidItem by Plaid's item_id (for webhooks).
 */
export const getPlaidItemByItemId = internalQuery({
  args: { itemId: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("plaidItems")
      .withIndex("by_item_id", (q) => q.eq("itemId", args.itemId))
      .first();
  },
});

// =============================================================================
// INTERNAL MUTATIONS - PlaidItems
// =============================================================================

/**
 * Create a new plaidItem.
 * Returns the Convex document ID as a string.
 */
export const createPlaidItem = internalMutation({
  args: {
    userId: v.string(),
    itemId: v.string(),
    accessToken: v.string(),
    institutionId: v.optional(v.string()),
    institutionName: v.optional(v.string()),
    status: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("plaidItems", {
      userId: args.userId,
      itemId: args.itemId,
      accessToken: args.accessToken,
      institutionId: args.institutionId,
      institutionName: args.institutionName,
      status: args.status as any,
      createdAt: Date.now(),
    });

    return String(id);
  },
});

/**
 * Update plaidItem status.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const updateItemStatus = internalMutation({
  args: {
    plaidItemId: v.string(),
    status: v.string(),
    syncError: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // O(1) lookup using normalizeId + get
    const item = await getPlaidItemById(ctx, args.plaidItemId);

    if (item) {
      await ctx.db.patch(item._id, {
        status: args.status as any,
        syncError: args.syncError,
      });
    }

    return null;
  },
});

/**
 * Update plaidItem cursor after successful sync.
 * Also marks as 'active' and updates lastSyncedAt.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const updateItemCursor = internalMutation({
  args: {
    plaidItemId: v.string(),
    cursor: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // O(1) lookup using normalizeId + get
    const item = await getPlaidItemById(ctx, args.plaidItemId);

    if (item) {
      await ctx.db.patch(item._id, {
        cursor: args.cursor,
        status: "active",
        lastSyncedAt: Date.now(),
      });
    }

    return null;
  },
});

// =============================================================================
// SYNC LOCKING - Prevent Race Conditions (Critical Fix)
// =============================================================================

/** Timeout for considering a sync "stuck" (5 minutes) */
const SYNC_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Acquire a sync lock using optimistic locking.
 * Returns the new syncVersion if lock acquired, or null if another sync is in progress.
 *
 * This prevents race conditions where two concurrent syncs could:
 * - Both read the same cursor
 * - Both fetch duplicate transactions
 * - Race to update cursor state
 *
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const acquireSyncLock = internalMutation({
  args: {
    plaidItemId: v.string(),
    expectedVersion: v.optional(v.number()), // Version we expect (for optimistic locking)
  },
  returns: v.union(
    v.object({
      acquired: v.literal(true),
      syncVersion: v.number(),
      cursor: v.optional(v.string()),
      accessToken: v.string(),
      userId: v.string(),
    }),
    v.object({
      acquired: v.literal(false),
      reason: v.string(),
      currentVersion: v.optional(v.number()),
      syncStartedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) {
      return { acquired: false as const, reason: "Item not found" };
    }

    const now = Date.now();
    const currentVersion = item.syncVersion ?? 0;

    // Check if there's an active sync (that hasn't timed out)
    if (item.status === "syncing" && item.syncStartedAt) {
      const syncAge = now - item.syncStartedAt;
      if (syncAge < SYNC_TIMEOUT_MS) {
        return {
          acquired: false as const,
          reason: "Sync already in progress",
          currentVersion,
          syncStartedAt: item.syncStartedAt,
        };
      }
      // Sync has timed out, we can take over
      console.warn(
        `[Plaid Component] Sync timeout detected for ${args.plaidItemId}, taking over`
      );
    }

    // If expectedVersion provided, verify it matches (optimistic lock check)
    if (args.expectedVersion !== undefined && args.expectedVersion !== currentVersion) {
      return {
        acquired: false as const,
        reason: "Version mismatch (concurrent modification)",
        currentVersion,
        syncStartedAt: item.syncStartedAt,
      };
    }

    // Acquire the lock by incrementing version and setting status
    const newVersion = currentVersion + 1;
    await ctx.db.patch(item._id, {
      status: "syncing",
      syncVersion: newVersion,
      syncStartedAt: now,
      syncError: undefined, // Clear previous error
    });

    return {
      acquired: true as const,
      syncVersion: newVersion,
      cursor: item.cursor,
      accessToken: item.accessToken,
      userId: item.userId,
    };
  },
});

/**
 * Complete a sync atomically: update cursor AND store the version we synced with.
 * Fails if another sync has taken over (version mismatch).
 *
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const completeSyncWithVersion = internalMutation({
  args: {
    plaidItemId: v.string(),
    syncVersion: v.number(), // Version we acquired
    cursor: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) {
      return { success: false, reason: "Item not found" };
    }

    // Verify we still hold the lock (version matches)
    if (item.syncVersion !== args.syncVersion) {
      return {
        success: false,
        reason: `Version mismatch: expected ${args.syncVersion}, got ${item.syncVersion}`,
      };
    }

    // Complete the sync
    await ctx.db.patch(item._id, {
      cursor: args.cursor,
      status: "active",
      lastSyncedAt: Date.now(),
      syncStartedAt: undefined, // Clear sync start time
    });

    return { success: true };
  },
});

/**
 * Release sync lock on error without updating cursor.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const releaseSyncLock = internalMutation({
  args: {
    plaidItemId: v.string(),
    syncVersion: v.number(),
    status: v.string(),
    syncError: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) return null;

    // Only release if we still hold the lock
    if (item.syncVersion === args.syncVersion) {
      await ctx.db.patch(item._id, {
        status: args.status as any,
        syncError: args.syncError,
        syncStartedAt: undefined,
      });
    }

    return null;
  },
});

/**
 * Mark plaidItem as needing re-authentication.
 * Used by webhook handlers.
 */
export const markNeedsReauth = internalMutation({
  args: {
    itemId: v.string(), // Plaid item_id (not Convex _id)
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("plaidItems")
      .withIndex("by_item_id", (q) => q.eq("itemId", args.itemId))
      .first();

    if (item) {
      await ctx.db.patch(item._id, {
        status: "needs_reauth",
        syncError: args.reason,
      });
    }

    return null;
  },
});

/**
 * Set plaidItem error status.
 * Used by webhook handlers.
 */
export const setItemError = internalMutation({
  args: {
    itemId: v.string(), // Plaid item_id
    errorCode: v.string(),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("plaidItems")
      .withIndex("by_item_id", (q) => q.eq("itemId", args.itemId))
      .first();

    if (item) {
      await ctx.db.patch(item._id, {
        status: "error",
        syncError: `${args.errorCode}: ${args.errorMessage}`,
      });
    }

    return null;
  },
});

// =============================================================================
// CIRCUIT BREAKER - Queries & Mutations
// =============================================================================

/**
 * Get plaidItem with circuit breaker fields.
 * Used by circuit breaker module.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const getPlaidItemWithCircuit = internalQuery({
  args: { plaidItemId: v.string() },
  returns: v.union(
    v.object({
      _id: v.any(),
      circuitState: v.optional(v.string()),
      consecutiveFailures: v.optional(v.number()),
      consecutiveSuccesses: v.optional(v.number()),
      lastFailureAt: v.optional(v.number()),
      nextRetryAt: v.optional(v.number()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    // O(1) lookup using normalizeId + get
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) return null;

    return {
      _id: item._id,
      circuitState: item.circuitState,
      consecutiveFailures: item.consecutiveFailures,
      consecutiveSuccesses: item.consecutiveSuccesses,
      lastFailureAt: item.lastFailureAt,
      nextRetryAt: item.nextRetryAt,
    };
  },
});

/**
 * Update circuit breaker state for a plaidItem.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const updateCircuitState = internalMutation({
  args: {
    plaidItemId: v.string(),
    circuitState: v.optional(
      v.union(v.literal("closed"), v.literal("open"), v.literal("half_open"))
    ),
    consecutiveFailures: v.optional(v.number()),
    consecutiveSuccesses: v.optional(v.number()),
    lastFailureAt: v.optional(v.number()),
    nextRetryAt: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // O(1) lookup using normalizeId + get
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) return null;

    const updates: Record<string, unknown> = {};
    if (args.circuitState !== undefined) updates.circuitState = args.circuitState;
    if (args.consecutiveFailures !== undefined)
      updates.consecutiveFailures = args.consecutiveFailures;
    if (args.consecutiveSuccesses !== undefined)
      updates.consecutiveSuccesses = args.consecutiveSuccesses;
    if (args.lastFailureAt !== undefined) updates.lastFailureAt = args.lastFailureAt;
    if (args.nextRetryAt !== undefined)
      updates.nextRetryAt = args.nextRetryAt === null ? undefined : args.nextRetryAt;

    await ctx.db.patch(item._id, updates);

    return null;
  },
});

/**
 * Reset circuit breaker to closed state.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const resetCircuitBreaker = internalMutation({
  args: { plaidItemId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    // O(1) lookup using normalizeId + get
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) return null;

    await ctx.db.patch(item._id, {
      circuitState: "closed",
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastFailureAt: undefined,
      nextRetryAt: undefined,
    });

    return null;
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Accounts
// =============================================================================

/**
 * Bulk upsert accounts.
 * Creates new accounts or updates existing ones by accountId.
 *
 * Uses safe upsert pattern to handle TOCTOU race conditions where
 * concurrent calls might both try to insert the same account.
 */
export const bulkUpsertAccounts = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    accounts: v.array(accountValidator),
  },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let created = 0;
    let updated = 0;

    for (const account of args.accounts) {
      const result = await safeUpsertWithDedup(
        ctx,
        // Query for existing record
        () =>
          ctx.db
            .query("plaidAccounts")
            .withIndex("by_account_id", (q) => q.eq("accountId", account.accountId))
            .first(),
        // Query for ALL matching records (for duplicate detection)
        () =>
          ctx.db
            .query("plaidAccounts")
            .withIndex("by_account_id", (q) => q.eq("accountId", account.accountId))
            .collect(),
        // Insert function
        async () => {
          const id = await ctx.db.insert("plaidAccounts", {
            userId: args.userId,
            plaidItemId: args.plaidItemId,
            ...account,
            createdAt: now,
          });
          return String(id);
        },
        // Update function
        async (id) => {
          await ctx.db.patch(id, {
            name: account.name,
            officialName: account.officialName,
            mask: account.mask,
            type: account.type,
            subtype: account.subtype,
            balances: account.balances,
          });
        }
      );

      if (result.created) {
        created++;
      } else {
        updated++;
      }
    }

    return { created, updated };
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Transactions
// =============================================================================

/**
 * Bulk upsert transactions.
 * Handles added, modified, and removed transactions from sync.
 */
export const bulkUpsertTransactions = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    added: v.array(transactionValidator),
    modified: v.array(transactionValidator),
    removed: v.array(v.string()),
  },
  returns: v.object({
    added: v.number(),
    modified: v.number(),
    removed: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Insert added transactions
    for (const txn of args.added) {
      await ctx.db.insert("plaidTransactions", {
        userId: args.userId,
        plaidItemId: args.plaidItemId,
        ...txn,
        createdAt: now,
      });
    }

    // Update modified transactions
    for (const txn of args.modified) {
      const existing = await ctx.db
        .query("plaidTransactions")
        .withIndex("by_transaction_id", (q) =>
          q.eq("transactionId", txn.transactionId)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          ...txn,
          updatedAt: now,
        });
      }
    }

    // Delete removed transactions
    for (const transactionId of args.removed) {
      const existing = await ctx.db
        .query("plaidTransactions")
        .withIndex("by_transaction_id", (q) =>
          q.eq("transactionId", transactionId)
        )
        .first();

      if (existing) {
        await ctx.db.delete(existing._id);
      }
    }

    return {
      added: args.added.length,
      modified: args.modified.length,
      removed: args.removed.length,
    };
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Liabilities
// =============================================================================

/**
 * Upsert credit card liability.
 * Creates or updates by accountId.
 *
 * Uses safe upsert pattern to handle TOCTOU race conditions where
 * concurrent calls might both try to insert the same liability.
 */
export const upsertCreditCardLiability = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    accountId: v.string(),
    aprs: v.array(aprValidator),
    isOverdue: v.boolean(),
    lastPaymentAmount: v.optional(v.number()),
    lastPaymentDate: v.optional(v.string()),
    lastStatementBalance: v.optional(v.number()),
    lastStatementIssueDate: v.optional(v.string()),
    minimumPaymentAmount: v.optional(v.number()),
    nextPaymentDueDate: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const now = Date.now();

    const result = await safeUpsertWithDedup(
      ctx,
      // Query for existing record
      () =>
        ctx.db
          .query("plaidCreditCardLiabilities")
          .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
          .first(),
      // Query for ALL matching records (for duplicate detection)
      () =>
        ctx.db
          .query("plaidCreditCardLiabilities")
          .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
          .collect(),
      // Insert function
      async () => {
        const id = await ctx.db.insert("plaidCreditCardLiabilities", {
          userId: args.userId,
          plaidItemId: args.plaidItemId,
          accountId: args.accountId,
          aprs: args.aprs,
          isOverdue: args.isOverdue,
          lastPaymentAmount: args.lastPaymentAmount,
          lastPaymentDate: args.lastPaymentDate,
          lastStatementBalance: args.lastStatementBalance,
          lastStatementIssueDate: args.lastStatementIssueDate,
          minimumPaymentAmount: args.minimumPaymentAmount,
          nextPaymentDueDate: args.nextPaymentDueDate,
          createdAt: now,
          updatedAt: now,
        });
        return String(id);
      },
      // Update function
      async (id) => {
        await ctx.db.patch(id, {
          aprs: args.aprs,
          isOverdue: args.isOverdue,
          lastPaymentAmount: args.lastPaymentAmount,
          lastPaymentDate: args.lastPaymentDate,
          lastStatementBalance: args.lastStatementBalance,
          lastStatementIssueDate: args.lastStatementIssueDate,
          minimumPaymentAmount: args.minimumPaymentAmount,
          nextPaymentDueDate: args.nextPaymentDueDate,
          updatedAt: now,
        });
      }
    );

    return result.id;
  },
});

const creditCardLiabilityValidator = v.object({
  accountId: v.string(),
  aprs: v.array(aprValidator),
  isOverdue: v.boolean(),
  lastPaymentAmount: v.optional(v.number()),
  lastPaymentDate: v.optional(v.string()),
  lastStatementBalance: v.optional(v.number()),
  lastStatementIssueDate: v.optional(v.string()),
  minimumPaymentAmount: v.optional(v.number()),
  nextPaymentDueDate: v.optional(v.string()),
});

/**
 * Bulk upsert credit card liabilities.
 * Creates or updates by accountId in a single mutation.
 * Uses safe upsert pattern to handle TOCTOU race conditions.
 */
export const bulkUpsertCreditCardLiabilities = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    creditCards: v.array(creditCardLiabilityValidator),
  },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let created = 0;
    let updated = 0;

    for (const card of args.creditCards) {
      const result = await safeUpsertWithDedup(
        ctx,
        // Query for existing record
        () =>
          ctx.db
            .query("plaidCreditCardLiabilities")
            .withIndex("by_account", (q) => q.eq("accountId", card.accountId))
            .first(),
        // Query for ALL matching records (for duplicate detection)
        () =>
          ctx.db
            .query("plaidCreditCardLiabilities")
            .withIndex("by_account", (q) => q.eq("accountId", card.accountId))
            .collect(),
        // Insert function
        async () => {
          const id = await ctx.db.insert("plaidCreditCardLiabilities", {
            userId: args.userId,
            plaidItemId: args.plaidItemId,
            accountId: card.accountId,
            aprs: card.aprs,
            isOverdue: card.isOverdue,
            lastPaymentAmount: card.lastPaymentAmount,
            lastPaymentDate: card.lastPaymentDate,
            lastStatementBalance: card.lastStatementBalance,
            lastStatementIssueDate: card.lastStatementIssueDate,
            minimumPaymentAmount: card.minimumPaymentAmount,
            nextPaymentDueDate: card.nextPaymentDueDate,
            createdAt: now,
            updatedAt: now,
          });
          return String(id);
        },
        // Update function
        async (id) => {
          await ctx.db.patch(id, {
            aprs: card.aprs,
            isOverdue: card.isOverdue,
            lastPaymentAmount: card.lastPaymentAmount,
            lastPaymentDate: card.lastPaymentDate,
            lastStatementBalance: card.lastStatementBalance,
            lastStatementIssueDate: card.lastStatementIssueDate,
            minimumPaymentAmount: card.minimumPaymentAmount,
            nextPaymentDueDate: card.nextPaymentDueDate,
            updatedAt: now,
          });
        }
      );

      if (result.created) {
        created++;
      } else {
        updated++;
      }
    }

    return { created, updated };
  },
});

// =============================================================================
// WEBHOOK HELPERS
// =============================================================================

/**
 * Schedule a sync operation (placeholder for Phase 2).
 * In Phase 2, this would schedule a background job.
 */
export const scheduleSync = internalMutation({
  args: {
    itemId: v.string(),
    syncType: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    console.log(
      `[Plaid Component] Scheduled ${args.syncType} sync for item ${args.itemId}`
    );
    // Phase 2: Implement actual scheduling
    return null;
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Item Deactivation
// =============================================================================

/**
 * Deactivate a plaidItem (for USER_PERMISSION_REVOKED webhook).
 * Marks item as inactive but keeps data for audit trail.
 */
export const deactivateItem = internalMutation({
  args: {
    itemId: v.string(), // Plaid item_id
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("plaidItems")
      .withIndex("by_item_id", (q) => q.eq("itemId", args.itemId))
      .first();

    if (item) {
      await ctx.db.patch(item._id, {
        status: "error",
        syncError: `Deactivated: ${args.reason}`,
      });
    }

    return null;
  },
});

// =============================================================================
// INTERNAL QUERIES - For Cron Jobs
// =============================================================================

/**
 * Get all active plaidItems for scheduled sync.
 * Returns items that are in 'active' status.
 */
export const getAllActiveItems = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.string(),
      userId: v.string(),
      itemId: v.string(),
      accessToken: v.string(),
      cursor: v.optional(v.string()),
      lastSyncedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx) => {
    const items = await ctx.db
      .query("plaidItems")
      .collect();

    // Filter for active items
    const activeItems = items.filter((item) => item.status === "active");

    return activeItems.map((item) => ({
      _id: String(item._id),
      userId: item.userId,
      itemId: item.itemId,
      accessToken: item.accessToken,
      cursor: item.cursor,
      lastSyncedAt: item.lastSyncedAt,
    }));
  },
});

/**
 * Get items that need sync (haven't synced in specified hours).
 */
export const getItemsNeedingSync = internalQuery({
  args: {
    maxAgeHours: v.optional(v.number()), // Default 24 hours
  },
  returns: v.array(
    v.object({
      _id: v.string(),
      userId: v.string(),
      itemId: v.string(),
      accessToken: v.string(),
      cursor: v.optional(v.string()),
      lastSyncedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const maxAgeMs = (args.maxAgeHours ?? 24) * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAgeMs;

    const items = await ctx.db
      .query("plaidItems")
      .collect();

    // Filter for active items that need sync
    const needingSync = items.filter((item) => {
      if (item.status !== "active") return false;
      if (!item.lastSyncedAt) return true; // Never synced
      return item.lastSyncedAt < cutoff;
    });

    return needingSync.map((item) => ({
      _id: String(item._id),
      userId: item.userId,
      itemId: item.itemId,
      accessToken: item.accessToken,
      cursor: item.cursor,
      lastSyncedAt: item.lastSyncedAt,
    }));
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Recurring Streams
// =============================================================================

/**
 * Bulk upsert recurring streams.
 * Creates or updates by streamId.
 *
 * Uses safe upsert pattern to handle TOCTOU race conditions where
 * concurrent calls might both try to insert the same stream.
 */
export const bulkUpsertRecurringStreams = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    streams: v.array(recurringStreamValidator),
  },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let created = 0;
    let updated = 0;

    for (const stream of args.streams) {
      const result = await safeUpsertWithDedup(
        ctx,
        // Query for existing record
        () =>
          ctx.db
            .query("plaidRecurringStreams")
            .withIndex("by_stream_id", (q) => q.eq("streamId", stream.streamId))
            .first(),
        // Query for ALL matching records (for duplicate detection)
        () =>
          ctx.db
            .query("plaidRecurringStreams")
            .withIndex("by_stream_id", (q) => q.eq("streamId", stream.streamId))
            .collect(),
        // Insert function
        async () => {
          const id = await ctx.db.insert("plaidRecurringStreams", {
            userId: args.userId,
            plaidItemId: args.plaidItemId,
            streamId: stream.streamId,
            accountId: stream.accountId,
            description: stream.description,
            merchantName: stream.merchantName,
            averageAmount: stream.averageAmount,
            lastAmount: stream.lastAmount,
            isoCurrencyCode: stream.isoCurrencyCode,
            frequency: stream.frequency,
            status: stream.status,
            isActive: stream.isActive,
            type: stream.type,
            category: stream.category,
            firstDate: stream.firstDate,
            lastDate: stream.lastDate,
            predictedNextDate: stream.predictedNextDate,
            createdAt: now,
            updatedAt: now,
          });
          return String(id);
        },
        // Update function
        async (id) => {
          await ctx.db.patch(id, {
            description: stream.description,
            merchantName: stream.merchantName,
            averageAmount: stream.averageAmount,
            lastAmount: stream.lastAmount,
            isoCurrencyCode: stream.isoCurrencyCode,
            frequency: stream.frequency,
            status: stream.status,
            isActive: stream.isActive,
            type: stream.type,
            category: stream.category,
            firstDate: stream.firstDate,
            lastDate: stream.lastDate,
            predictedNextDate: stream.predictedNextDate,
            updatedAt: now,
          });
        }
      );

      if (result.created) {
        created++;
      } else {
        updated++;
      }
    }

    return { created, updated };
  },
});

/**
 * Mark streams as tombstoned for a plaidItem.
 * Used when streams are removed during sync.
 */
export const tombstoneStreams = internalMutation({
  args: {
    plaidItemId: v.string(),
    streamIds: v.array(v.string()),
  },
  returns: v.object({ tombstoned: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let tombstoned = 0;

    for (const streamId of args.streamIds) {
      const existing = await ctx.db
        .query("plaidRecurringStreams")
        .withIndex("by_stream_id", (q) => q.eq("streamId", streamId))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          status: "TOMBSTONED",
          isActive: false,
          updatedAt: now,
        });
        tombstoned++;
      }
    }

    return { tombstoned };
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Mortgage Liabilities
// =============================================================================

const addressValidator = v.object({
  street: v.optional(v.string()),
  city: v.optional(v.string()),
  region: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  country: v.optional(v.string()),
});

/**
 * Upsert mortgage liability by accountId.
 *
 * Uses safe upsert pattern to handle TOCTOU race conditions where
 * concurrent calls might both try to insert the same liability.
 */
export const upsertMortgageLiability = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    accountId: v.string(),
    accountNumber: v.optional(v.string()),
    loanTerm: v.optional(v.string()),
    loanTypeDescription: v.optional(v.string()),
    originationDate: v.optional(v.string()),
    maturityDate: v.optional(v.string()),
    interestRatePercentage: v.number(),
    interestRateType: v.optional(v.string()),
    lastPaymentAmount: v.optional(v.number()),
    lastPaymentDate: v.optional(v.string()),
    nextMonthlyPayment: v.optional(v.number()),
    nextPaymentDueDate: v.optional(v.string()),
    originationPrincipalAmount: v.optional(v.number()),
    currentLateFee: v.optional(v.number()),
    escrowBalance: v.optional(v.number()),
    pastDueAmount: v.optional(v.number()),
    ytdInterestPaid: v.optional(v.number()),
    ytdPrincipalPaid: v.optional(v.number()),
    hasPmi: v.optional(v.boolean()),
    hasPrepaymentPenalty: v.optional(v.boolean()),
    propertyAddress: v.optional(addressValidator),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const now = Date.now();

    const result = await safeUpsertWithDedup(
      ctx,
      // Query for existing record
      () =>
        ctx.db
          .query("plaidMortgageLiabilities")
          .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
          .first(),
      // Query for ALL matching records (for duplicate detection)
      () =>
        ctx.db
          .query("plaidMortgageLiabilities")
          .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
          .collect(),
      // Insert function
      async () => {
        const id = await ctx.db.insert("plaidMortgageLiabilities", {
          ...args,
          createdAt: now,
          updatedAt: now,
        });
        return String(id);
      },
      // Update function
      async (id) => {
        await ctx.db.patch(id, {
          ...args,
          updatedAt: now,
        });
      }
    );

    return result.id;
  },
});

const mortgageLiabilityValidator = v.object({
  accountId: v.string(),
  accountNumber: v.optional(v.string()),
  loanTerm: v.optional(v.string()),
  loanTypeDescription: v.optional(v.string()),
  originationDate: v.optional(v.string()),
  maturityDate: v.optional(v.string()),
  interestRatePercentage: v.number(),
  interestRateType: v.optional(v.string()),
  lastPaymentAmount: v.optional(v.number()),
  lastPaymentDate: v.optional(v.string()),
  nextMonthlyPayment: v.optional(v.number()),
  nextPaymentDueDate: v.optional(v.string()),
  originationPrincipalAmount: v.optional(v.number()),
  currentLateFee: v.optional(v.number()),
  escrowBalance: v.optional(v.number()),
  pastDueAmount: v.optional(v.number()),
  ytdInterestPaid: v.optional(v.number()),
  ytdPrincipalPaid: v.optional(v.number()),
  hasPmi: v.optional(v.boolean()),
  hasPrepaymentPenalty: v.optional(v.boolean()),
  propertyAddress: v.optional(addressValidator),
});

/**
 * Bulk upsert mortgage liabilities.
 * Creates or updates by accountId in a single mutation.
 * Uses safe upsert pattern to handle TOCTOU race conditions.
 */
export const bulkUpsertMortgageLiabilities = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    mortgages: v.array(mortgageLiabilityValidator),
  },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let created = 0;
    let updated = 0;

    for (const mortgage of args.mortgages) {
      const result = await safeUpsertWithDedup(
        ctx,
        // Query for existing record
        () =>
          ctx.db
            .query("plaidMortgageLiabilities")
            .withIndex("by_account", (q) => q.eq("accountId", mortgage.accountId))
            .first(),
        // Query for ALL matching records (for duplicate detection)
        () =>
          ctx.db
            .query("plaidMortgageLiabilities")
            .withIndex("by_account", (q) => q.eq("accountId", mortgage.accountId))
            .collect(),
        // Insert function
        async () => {
          const id = await ctx.db.insert("plaidMortgageLiabilities", {
            userId: args.userId,
            plaidItemId: args.plaidItemId,
            ...mortgage,
            createdAt: now,
            updatedAt: now,
          });
          return String(id);
        },
        // Update function
        async (id) => {
          await ctx.db.patch(id, {
            ...mortgage,
            updatedAt: now,
          });
        }
      );

      if (result.created) {
        created++;
      } else {
        updated++;
      }
    }

    return { created, updated };
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Student Loan Liabilities
// =============================================================================

const loanStatusValidator = v.object({
  type: v.optional(v.string()),
  endDate: v.optional(v.string()),
});

const repaymentPlanValidator = v.object({
  type: v.optional(v.string()),
  description: v.optional(v.string()),
});

/**
 * Upsert student loan liability by accountId.
 *
 * Uses safe upsert pattern to handle TOCTOU race conditions where
 * concurrent calls might both try to insert the same liability.
 */
export const upsertStudentLoanLiability = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    accountId: v.string(),
    accountNumber: v.optional(v.string()),
    loanName: v.optional(v.string()),
    guarantor: v.optional(v.string()),
    sequenceNumber: v.optional(v.string()),
    disbursementDates: v.optional(v.array(v.string())),
    originationDate: v.optional(v.string()),
    expectedPayoffDate: v.optional(v.string()),
    lastStatementIssueDate: v.optional(v.string()),
    interestRatePercentage: v.number(),
    lastPaymentAmount: v.optional(v.number()),
    lastPaymentDate: v.optional(v.string()),
    minimumPaymentAmount: v.optional(v.number()),
    nextPaymentDueDate: v.optional(v.string()),
    paymentReferenceNumber: v.optional(v.string()),
    originationPrincipalAmount: v.optional(v.number()),
    outstandingInterestAmount: v.optional(v.number()),
    lastStatementBalance: v.optional(v.number()),
    ytdInterestPaid: v.optional(v.number()),
    ytdPrincipalPaid: v.optional(v.number()),
    isOverdue: v.optional(v.boolean()),
    loanStatus: v.optional(loanStatusValidator),
    repaymentPlan: v.optional(repaymentPlanValidator),
    servicerAddress: v.optional(addressValidator),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const now = Date.now();

    const result = await safeUpsertWithDedup(
      ctx,
      // Query for existing record
      () =>
        ctx.db
          .query("plaidStudentLoanLiabilities")
          .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
          .first(),
      // Query for ALL matching records (for duplicate detection)
      () =>
        ctx.db
          .query("plaidStudentLoanLiabilities")
          .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
          .collect(),
      // Insert function
      async () => {
        const id = await ctx.db.insert("plaidStudentLoanLiabilities", {
          ...args,
          createdAt: now,
          updatedAt: now,
        });
        return String(id);
      },
      // Update function
      async (id) => {
        await ctx.db.patch(id, {
          ...args,
          updatedAt: now,
        });
      }
    );

    return result.id;
  },
});

const studentLoanLiabilityValidator = v.object({
  accountId: v.string(),
  accountNumber: v.optional(v.string()),
  loanName: v.optional(v.string()),
  guarantor: v.optional(v.string()),
  sequenceNumber: v.optional(v.string()),
  disbursementDates: v.optional(v.array(v.string())),
  originationDate: v.optional(v.string()),
  expectedPayoffDate: v.optional(v.string()),
  lastStatementIssueDate: v.optional(v.string()),
  interestRatePercentage: v.number(),
  lastPaymentAmount: v.optional(v.number()),
  lastPaymentDate: v.optional(v.string()),
  minimumPaymentAmount: v.optional(v.number()),
  nextPaymentDueDate: v.optional(v.string()),
  paymentReferenceNumber: v.optional(v.string()),
  originationPrincipalAmount: v.optional(v.number()),
  outstandingInterestAmount: v.optional(v.number()),
  lastStatementBalance: v.optional(v.number()),
  ytdInterestPaid: v.optional(v.number()),
  ytdPrincipalPaid: v.optional(v.number()),
  isOverdue: v.optional(v.boolean()),
  loanStatus: v.optional(loanStatusValidator),
  repaymentPlan: v.optional(repaymentPlanValidator),
  servicerAddress: v.optional(addressValidator),
});

/**
 * Bulk upsert student loan liabilities.
 * Creates or updates by accountId in a single mutation.
 * Uses safe upsert pattern to handle TOCTOU race conditions.
 */
export const bulkUpsertStudentLoanLiabilities = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    studentLoans: v.array(studentLoanLiabilityValidator),
  },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let created = 0;
    let updated = 0;

    for (const loan of args.studentLoans) {
      const result = await safeUpsertWithDedup(
        ctx,
        // Query for existing record
        () =>
          ctx.db
            .query("plaidStudentLoanLiabilities")
            .withIndex("by_account", (q) => q.eq("accountId", loan.accountId))
            .first(),
        // Query for ALL matching records (for duplicate detection)
        () =>
          ctx.db
            .query("plaidStudentLoanLiabilities")
            .withIndex("by_account", (q) => q.eq("accountId", loan.accountId))
            .collect(),
        // Insert function
        async () => {
          const id = await ctx.db.insert("plaidStudentLoanLiabilities", {
            userId: args.userId,
            plaidItemId: args.plaidItemId,
            ...loan,
            createdAt: now,
            updatedAt: now,
          });
          return String(id);
        },
        // Update function
        async (id) => {
          await ctx.db.patch(id, {
            ...loan,
            updatedAt: now,
          });
        }
      );

      if (result.created) {
        created++;
      } else {
        updated++;
      }
    }

    return { created, updated };
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Merchant Enrichment
// =============================================================================

const confidenceLevelValidator = v.union(
  v.literal("VERY_HIGH"),
  v.literal("HIGH"),
  v.literal("MEDIUM"),
  v.literal("LOW"),
  v.literal("UNKNOWN")
);

/**
 * Upsert merchant enrichment by merchantId.
 * Shared across all users.
 *
 * Uses safe upsert pattern to handle TOCTOU race conditions where
 * concurrent calls might both try to insert the same merchant enrichment.
 */
export const upsertMerchantEnrichment = internalMutation({
  args: {
    merchantId: v.string(),
    merchantName: v.string(),
    logoUrl: v.optional(v.string()),
    categoryPrimary: v.optional(v.string()),
    categoryDetailed: v.optional(v.string()),
    categoryIconUrl: v.optional(v.string()),
    website: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    confidenceLevel: confidenceLevelValidator,
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const now = Date.now();

    const result = await safeUpsertWithDedup(
      ctx,
      // Query for existing record
      () =>
        ctx.db
          .query("merchantEnrichments")
          .withIndex("by_merchant", (q) => q.eq("merchantId", args.merchantId))
          .first(),
      // Query for ALL matching records (for duplicate detection)
      () =>
        ctx.db
          .query("merchantEnrichments")
          .withIndex("by_merchant", (q) => q.eq("merchantId", args.merchantId))
          .collect(),
      // Insert function
      async () => {
        const id = await ctx.db.insert("merchantEnrichments", {
          ...args,
          lastEnriched: now,
        });
        return String(id);
      },
      // Update function
      async (id) => {
        await ctx.db.patch(id, {
          ...args,
          lastEnriched: now,
        });
      }
    );

    return result.id;
  },
});

/**
 * Link transaction to merchant by updating merchantId field.
 */
export const linkTransactionToMerchant = internalMutation({
  args: {
    transactionId: v.string(),
    merchantId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const transaction = await ctx.db
      .query("plaidTransactions")
      .withIndex("by_transaction_id", (q) =>
        q.eq("transactionId", args.transactionId)
      )
      .first();

    if (!transaction) return false;

    await ctx.db.patch(transaction._id, {
      merchantId: args.merchantId,
      updatedAt: Date.now(),
    });

    return true;
  },
});

/**
 * Update transaction with enrichment data.
 */
export const updateTransactionEnrichment = internalMutation({
  args: {
    transactionId: v.string(),
    merchantId: v.optional(v.string()),
    enrichmentData: v.object({
      counterpartyName: v.optional(v.string()),
      counterpartyType: v.optional(v.string()),
      counterpartyEntityId: v.optional(v.string()),
      counterpartyConfidence: v.optional(v.string()),
      counterpartyLogoUrl: v.optional(v.string()),
      counterpartyWebsite: v.optional(v.string()),
      counterpartyPhoneNumber: v.optional(v.string()),
      enrichedAt: v.optional(v.number()),
    }),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const transaction = await ctx.db
      .query("plaidTransactions")
      .withIndex("by_transaction_id", (q) =>
        q.eq("transactionId", args.transactionId)
      )
      .first();

    if (!transaction) return false;

    await ctx.db.patch(transaction._id, {
      merchantId: args.merchantId,
      enrichmentData: args.enrichmentData,
      updatedAt: Date.now(),
    });

    return true;
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Webhook Logs
// =============================================================================

/**
 * Create a webhook log entry.
 */
export const createWebhookLog = internalMutation({
  args: {
    webhookId: v.string(),
    itemId: v.string(),
    webhookType: v.string(),
    webhookCode: v.string(),
    bodyHash: v.string(),
    receivedAt: v.number(),
    status: v.union(
      v.literal("received"),
      v.literal("processing"),
      v.literal("processed"),
      v.literal("duplicate"),
      v.literal("failed")
    ),
    errorMessage: v.optional(v.string()),
    scheduledFunctionId: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("webhookLogs", args);
    return String(id);
  },
});

/**
 * Update webhook log status.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const updateWebhookLogStatus = internalMutation({
  args: {
    webhookLogId: v.string(),
    status: v.union(
      v.literal("received"),
      v.literal("processing"),
      v.literal("processed"),
      v.literal("duplicate"),
      v.literal("failed")
    ),
    processedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    scheduledFunctionId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // O(1) lookup using normalizeId + get
    const id = ctx.db.normalizeId("webhookLogs", args.webhookLogId);
    if (!id) return null;
    const log = await ctx.db.get(id);
    if (!log) return null;

    await ctx.db.patch(log._id, {
      status: args.status,
      processedAt: args.processedAt,
      errorMessage: args.errorMessage,
      scheduledFunctionId: args.scheduledFunctionId,
    });

    return null;
  },
});

/**
 * Find recent webhook by body hash (for deduplication).
 */
export const findRecentByHash = internalQuery({
  args: {
    bodyHash: v.string(),
    windowMs: v.number(),
  },
  returns: v.union(
    v.object({
      _id: v.string(),
      webhookId: v.string(),
      status: v.string(),
      receivedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.windowMs;

    const matches = await ctx.db
      .query("webhookLogs")
      .withIndex("by_body_hash", (q) => q.eq("bodyHash", args.bodyHash))
      .collect();

    // Find first match within time window that isn't a duplicate
    const recent = matches.find(
      (log) => log.receivedAt >= cutoff && log.status !== "duplicate"
    );

    if (!recent) return null;

    return {
      _id: String(recent._id),
      webhookId: recent.webhookId,
      status: recent.status,
      receivedAt: recent.receivedAt,
    };
  },
});
