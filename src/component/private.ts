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
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    // Query by document ID
    const items = await ctx.db
      .query("plaidItems")
      .collect();

    // Find matching item by string ID comparison
    const item = items.find((i) => String(i._id) === args.plaidItemId);

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
 */
export const updateItemStatus = internalMutation({
  args: {
    plaidItemId: v.string(),
    status: v.string(),
    syncError: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Find item by string ID
    const items = await ctx.db.query("plaidItems").collect();
    const item = items.find((i) => String(i._id) === args.plaidItemId);

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
 */
export const updateItemCursor = internalMutation({
  args: {
    plaidItemId: v.string(),
    cursor: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const items = await ctx.db.query("plaidItems").collect();
    const item = items.find((i) => String(i._id) === args.plaidItemId);

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
// INTERNAL MUTATIONS - Accounts
// =============================================================================

/**
 * Bulk upsert accounts.
 * Creates new accounts or updates existing ones by accountId.
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
      const existing = await ctx.db
        .query("plaidAccounts")
        .withIndex("by_account_id", (q) => q.eq("accountId", account.accountId))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          name: account.name,
          officialName: account.officialName,
          mask: account.mask,
          type: account.type,
          subtype: account.subtype,
          balances: account.balances,
        });
        updated++;
      } else {
        await ctx.db.insert("plaidAccounts", {
          userId: args.userId,
          plaidItemId: args.plaidItemId,
          ...account,
          createdAt: now,
        });
        created++;
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

    const existing = await ctx.db
      .query("plaidCreditCardLiabilities")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
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
      return String(existing._id);
    } else {
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
    }
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
      const existing = await ctx.db
        .query("plaidRecurringStreams")
        .withIndex("by_stream_id", (q) => q.eq("streamId", stream.streamId))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
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
        updated++;
      } else {
        await ctx.db.insert("plaidRecurringStreams", {
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
        created++;
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
