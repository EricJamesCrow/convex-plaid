/**
 * Plaid Component Public API
 *
 * Queries and mutations exposed to the host app.
 * These are the primary way host apps interact with component data.
 *
 * COMPONENT NOTE: All IDs returned as strings for component boundary.
 * Security: accessToken is NEVER exposed in query results.
 */

import { v } from "convex/values";
import { query, mutation } from "./_generated/server.js";

// =============================================================================
// VALIDATORS (Reusable)
// =============================================================================

const balancesValidator = v.object({
  available: v.optional(v.number()),
  current: v.optional(v.number()),
  limit: v.optional(v.number()),
  isoCurrencyCode: v.string(),
});

const aprValidator = v.object({
  aprPercentage: v.number(),
  aprType: v.string(),
  balanceSubjectToApr: v.optional(v.number()),
  interestChargeAmount: v.optional(v.number()),
});

// =============================================================================
// PLAID ITEMS QUERIES
// =============================================================================

/**
 * Get all plaidItems for a user.
 * NOTE: accessToken is excluded for security.
 */
export const getItemsByUser = query({
  args: { userId: v.string() },
  returns: v.array(
    v.object({
      _id: v.string(),
      userId: v.string(),
      itemId: v.string(),
      institutionId: v.optional(v.string()),
      institutionName: v.optional(v.string()),
      status: v.string(),
      syncError: v.optional(v.string()),
      createdAt: v.number(),
      lastSyncedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("plaidItems")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Exclude accessToken and cursor for security
    return items.map(({ accessToken, cursor, ...item }) => ({
      ...item,
      _id: String(item._id),
    }));
  },
});

/**
 * Get a single plaidItem by ID.
 * NOTE: accessToken is excluded for security.
 */
export const getItem = query({
  args: { plaidItemId: v.string() },
  returns: v.union(
    v.object({
      _id: v.string(),
      userId: v.string(),
      itemId: v.string(),
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
    const items = await ctx.db.query("plaidItems").collect();
    const item = items.find((i) => String(i._id) === args.plaidItemId);

    if (!item) return null;

    // Exclude accessToken and cursor
    const { accessToken, cursor, ...rest } = item;
    return {
      ...rest,
      _id: String(item._id),
    };
  },
});

// =============================================================================
// ACCOUNTS QUERIES
// =============================================================================

/**
 * Get all accounts for a user.
 */
export const getAccountsByUser = query({
  args: { userId: v.string() },
  returns: v.array(
    v.object({
      _id: v.string(),
      userId: v.string(),
      plaidItemId: v.string(),
      accountId: v.string(),
      name: v.string(),
      officialName: v.optional(v.string()),
      mask: v.optional(v.string()),
      type: v.string(),
      subtype: v.optional(v.string()),
      balances: balancesValidator,
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("plaidAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return accounts.map((acc) => ({
      ...acc,
      _id: String(acc._id),
    }));
  },
});

/**
 * Get all accounts for a specific plaidItem.
 */
export const getAccountsByItem = query({
  args: { plaidItemId: v.string() },
  returns: v.array(
    v.object({
      _id: v.string(),
      userId: v.string(),
      plaidItemId: v.string(),
      accountId: v.string(),
      name: v.string(),
      officialName: v.optional(v.string()),
      mask: v.optional(v.string()),
      type: v.string(),
      subtype: v.optional(v.string()),
      balances: balancesValidator,
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("plaidAccounts")
      .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .collect();

    return accounts.map((acc) => ({
      ...acc,
      _id: String(acc._id),
    }));
  },
});

// =============================================================================
// TRANSACTIONS QUERIES
// =============================================================================

/**
 * Get transactions for a specific account.
 * Returns most recent first.
 */
export const getTransactionsByAccount = query({
  args: {
    accountId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.string(),
      userId: v.string(),
      plaidItemId: v.string(),
      accountId: v.string(),
      transactionId: v.string(),
      amount: v.number(),
      isoCurrencyCode: v.string(),
      date: v.string(),
      datetime: v.optional(v.string()),
      name: v.string(),
      merchantName: v.optional(v.string()),
      pending: v.boolean(),
      categoryPrimary: v.optional(v.string()),
      categoryDetailed: v.optional(v.string()),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    let queryBuilder = ctx.db
      .query("plaidTransactions")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .order("desc");

    const transactions = args.limit
      ? await queryBuilder.take(args.limit)
      : await queryBuilder.collect();

    return transactions.map((txn) => ({
      _id: String(txn._id),
      userId: txn.userId,
      plaidItemId: txn.plaidItemId,
      accountId: txn.accountId,
      transactionId: txn.transactionId,
      amount: txn.amount,
      isoCurrencyCode: txn.isoCurrencyCode,
      date: txn.date,
      datetime: txn.datetime,
      name: txn.name,
      merchantName: txn.merchantName,
      pending: txn.pending,
      categoryPrimary: txn.categoryPrimary,
      categoryDetailed: txn.categoryDetailed,
      createdAt: txn.createdAt,
    }));
  },
});

/**
 * Get transactions for a user with date range filtering.
 */
export const getTransactionsByUser = query({
  args: {
    userId: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.string(),
      userId: v.string(),
      plaidItemId: v.string(),
      accountId: v.string(),
      transactionId: v.string(),
      amount: v.number(),
      isoCurrencyCode: v.string(),
      date: v.string(),
      datetime: v.optional(v.string()),
      name: v.string(),
      merchantName: v.optional(v.string()),
      pending: v.boolean(),
      categoryPrimary: v.optional(v.string()),
      categoryDetailed: v.optional(v.string()),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    // Query by userId, then filter by date range in JavaScript
    // This is simpler than trying to use compound index range queries
    let transactions = await ctx.db
      .query("plaidTransactions")
      .withIndex("by_date", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();

    // Apply date range filters
    if (args.startDate) {
      transactions = transactions.filter((t) => t.date >= args.startDate!);
    }
    if (args.endDate) {
      transactions = transactions.filter((t) => t.date <= args.endDate!);
    }

    // Apply limit
    if (args.limit) {
      transactions = transactions.slice(0, args.limit);
    }

    return transactions.map((txn) => ({
      _id: String(txn._id),
      userId: txn.userId,
      plaidItemId: txn.plaidItemId,
      accountId: txn.accountId,
      transactionId: txn.transactionId,
      amount: txn.amount,
      isoCurrencyCode: txn.isoCurrencyCode,
      date: txn.date,
      datetime: txn.datetime,
      name: txn.name,
      merchantName: txn.merchantName,
      pending: txn.pending,
      categoryPrimary: txn.categoryPrimary,
      categoryDetailed: txn.categoryDetailed,
      createdAt: txn.createdAt,
    }));
  },
});

// =============================================================================
// LIABILITIES QUERIES
// =============================================================================

/**
 * Get credit card liabilities for a specific plaidItem.
 */
export const getLiabilitiesByItem = query({
  args: { plaidItemId: v.string() },
  returns: v.array(
    v.object({
      _id: v.string(),
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
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const liabilities = await ctx.db
      .query("plaidCreditCardLiabilities")
      .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .collect();

    return liabilities.map((l) => ({
      ...l,
      _id: String(l._id),
    }));
  },
});

/**
 * Get all credit card liabilities for a user.
 */
export const getLiabilitiesByUser = query({
  args: { userId: v.string() },
  returns: v.array(
    v.object({
      _id: v.string(),
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
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const liabilities = await ctx.db
      .query("plaidCreditCardLiabilities")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return liabilities.map((l) => ({
      ...l,
      _id: String(l._id),
    }));
  },
});

// =============================================================================
// PUBLIC MUTATIONS
// =============================================================================

/**
 * Delete a plaidItem and all associated data.
 * Cascades to accounts, transactions, and liabilities.
 */
export const deletePlaidItem = mutation({
  args: { plaidItemId: v.string() },
  returns: v.object({
    deleted: v.object({
      items: v.number(),
      accounts: v.number(),
      transactions: v.number(),
      liabilities: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    // Find the item
    const items = await ctx.db.query("plaidItems").collect();
    const item = items.find((i) => String(i._id) === args.plaidItemId);

    if (!item) {
      return {
        deleted: { items: 0, accounts: 0, transactions: 0, liabilities: 0 },
      };
    }

    // Delete the item
    await ctx.db.delete(item._id);

    // Delete associated accounts
    const accounts = await ctx.db
      .query("plaidAccounts")
      .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .collect();

    for (const acc of accounts) {
      await ctx.db.delete(acc._id);
    }

    // Delete associated transactions
    const transactions = await ctx.db
      .query("plaidTransactions")
      .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .collect();

    for (const txn of transactions) {
      await ctx.db.delete(txn._id);
    }

    // Delete associated liabilities
    const liabilities = await ctx.db
      .query("plaidCreditCardLiabilities")
      .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .collect();

    for (const l of liabilities) {
      await ctx.db.delete(l._id);
    }

    return {
      deleted: {
        items: 1,
        accounts: accounts.length,
        transactions: transactions.length,
        liabilities: liabilities.length,
      },
    };
  },
});
