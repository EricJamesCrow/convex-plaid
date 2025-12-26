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
// CIRCUIT BREAKER - Queries & Mutations
// =============================================================================

/**
 * Get plaidItem with circuit breaker fields.
 * Used by circuit breaker module.
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
    const items = await ctx.db.query("plaidItems").collect();
    const item = items.find((i) => String(i._id) === args.plaidItemId);

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
    const items = await ctx.db.query("plaidItems").collect();
    const item = items.find((i) => String(i._id) === args.plaidItemId);

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
 */
export const resetCircuitBreaker = internalMutation({
  args: { plaidItemId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const items = await ctx.db.query("plaidItems").collect();
    const item = items.find((i) => String(i._id) === args.plaidItemId);

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

    const existing = await ctx.db
      .query("plaidMortgageLiabilities")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      });
      return String(existing._id);
    }

    const id = await ctx.db.insert("plaidMortgageLiabilities", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });

    return String(id);
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

    const existing = await ctx.db
      .query("plaidStudentLoanLiabilities")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      });
      return String(existing._id);
    }

    const id = await ctx.db.insert("plaidStudentLoanLiabilities", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });

    return String(id);
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
    const existing = await ctx.db
      .query("merchantEnrichments")
      .withIndex("by_merchant", (q) => q.eq("merchantId", args.merchantId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        lastEnriched: Date.now(),
      });
      return String(existing._id);
    }

    const id = await ctx.db.insert("merchantEnrichments", {
      ...args,
      lastEnriched: Date.now(),
    });

    return String(id);
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
    const logs = await ctx.db.query("webhookLogs").collect();
    const log = logs.find((l) => String(l._id) === args.webhookLogId);

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
