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
import { internal } from "./_generated/api.js";

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
 * Validator for plaidItem return type (excludes accessToken for security)
 */
const plaidItemReturnValidator = v.object({
  _id: v.string(),
  userId: v.string(),
  itemId: v.string(),
  institutionId: v.optional(v.string()),
  institutionName: v.optional(v.string()),
  products: v.array(v.string()),
  isActive: v.optional(v.boolean()),
  status: v.string(),
  syncError: v.optional(v.string()),
  createdAt: v.number(),
  lastSyncedAt: v.optional(v.number()),
  activatedAt: v.optional(v.number()),
  // Error tracking
  errorCode: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  errorAt: v.optional(v.number()),
  // Re-auth tracking
  reauthReason: v.optional(v.string()),
  reauthAt: v.optional(v.number()),
  // Disconnect tracking
  disconnectedReason: v.optional(v.string()),
  disconnectedAt: v.optional(v.number()),
  // Circuit breaker state (for monitoring)
  circuitState: v.optional(v.string()),
  consecutiveFailures: v.optional(v.number()),
  lastFailureAt: v.optional(v.number()),
  nextRetryAt: v.optional(v.number()),
});

/**
 * Get all plaidItems for a user.
 *
 * @security Components cannot access ctx.auth. Host apps must validate userId
 * before calling this query.
 * NOTE: accessToken is excluded for security.
 */
export const getItemsByUser = query({
  args: { userId: v.string() },
  returns: v.array(plaidItemReturnValidator),
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("plaidItems")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Explicitly map fields to avoid complex type inference
    return items.map((item) => ({
      _id: String(item._id),
      userId: item.userId,
      itemId: item.itemId,
      institutionId: item.institutionId,
      institutionName: item.institutionName,
      products: item.products,
      isActive: item.isActive,
      status: item.status,
      syncError: item.syncError,
      createdAt: item.createdAt,
      lastSyncedAt: item.lastSyncedAt,
      activatedAt: item.activatedAt,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
      errorAt: item.errorAt,
      reauthReason: item.reauthReason,
      reauthAt: item.reauthAt,
      disconnectedReason: item.disconnectedReason,
      disconnectedAt: item.disconnectedAt,
      circuitState: item.circuitState,
      consecutiveFailures: item.consecutiveFailures,
      lastFailureAt: item.lastFailureAt,
      nextRetryAt: item.nextRetryAt,
    }));
  },
});

/**
 * Get a single plaidItem by component document ID.
 *
 * @security Components cannot access ctx.auth. Host apps must verify the caller
 * owns this item before returning data.
 * NOTE: accessToken is excluded for security.
 */
export const getItem = query({
  args: { plaidItemId: v.string() },
  returns: v.union(plaidItemReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const normalizedId = ctx.db.normalizeId("plaidItems", args.plaidItemId);
    if (!normalizedId) return null;

    const item = await ctx.db.get(normalizedId);
    if (!item) return null;

    // Explicitly return fields to avoid complex type inference
    return {
      _id: String(item._id),
      userId: item.userId,
      itemId: item.itemId,
      institutionId: item.institutionId,
      institutionName: item.institutionName,
      products: item.products,
      isActive: item.isActive,
      status: item.status,
      syncError: item.syncError,
      createdAt: item.createdAt,
      lastSyncedAt: item.lastSyncedAt,
      activatedAt: item.activatedAt,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
      errorAt: item.errorAt,
      reauthReason: item.reauthReason,
      reauthAt: item.reauthAt,
      disconnectedReason: item.disconnectedReason,
      disconnectedAt: item.disconnectedAt,
      circuitState: item.circuitState,
      consecutiveFailures: item.consecutiveFailures,
      lastFailureAt: item.lastFailureAt,
      nextRetryAt: item.nextRetryAt,
    };
  },
});

/**
 * Get a single plaidItem by Plaid's item_id.
 * Used by webhook handlers to look up items by Plaid's identifier.
 *
 * @security Components cannot access ctx.auth. Host apps must not expose this
 * query directly to clients.
 * NOTE: accessToken is excluded for security.
 */
export const getItemByPlaidItemId = query({
  args: { itemId: v.string() },
  returns: v.union(plaidItemReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("plaidItems")
      .withIndex("by_item_id", (q) => q.eq("itemId", args.itemId))
      .unique();

    if (!item) return null;

    return {
      _id: String(item._id),
      userId: item.userId,
      itemId: item.itemId,
      institutionId: item.institutionId,
      institutionName: item.institutionName,
      products: item.products,
      isActive: item.isActive,
      status: item.status,
      syncError: item.syncError,
      createdAt: item.createdAt,
      lastSyncedAt: item.lastSyncedAt,
      activatedAt: item.activatedAt,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
      errorAt: item.errorAt,
      reauthReason: item.reauthReason,
      reauthAt: item.reauthAt,
      disconnectedReason: item.disconnectedReason,
      disconnectedAt: item.disconnectedAt,
      circuitState: item.circuitState,
      consecutiveFailures: item.consecutiveFailures,
      lastFailureAt: item.lastFailureAt,
      nextRetryAt: item.nextRetryAt,
    };
  },
});

/**
 * Get all active plaidItems across all users.
 * Used by scheduled sync jobs to find items that need syncing.
 *
 * @security Returns data for all users. Only call from trusted server-side code.
 * NOTE: accessToken is excluded for security.
 */
export const getAllActiveItems = query({
  args: {},
  returns: v.array(plaidItemReturnValidator),
  handler: async (ctx) => {
    const items = await ctx.db
      .query("plaidItems")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    // Filter to only active items (isActive !== false for backward compat)
    const activeItems = items.filter((item) => item.isActive !== false);

    // Explicitly map fields to avoid complex type inference
    return activeItems.map((item) => ({
      _id: String(item._id),
      userId: item.userId,
      itemId: item.itemId,
      institutionId: item.institutionId,
      institutionName: item.institutionName,
      products: item.products,
      isActive: item.isActive,
      status: item.status,
      syncError: item.syncError,
      createdAt: item.createdAt,
      lastSyncedAt: item.lastSyncedAt,
      activatedAt: item.activatedAt,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
      errorAt: item.errorAt,
      reauthReason: item.reauthReason,
      reauthAt: item.reauthAt,
      disconnectedReason: item.disconnectedReason,
      disconnectedAt: item.disconnectedAt,
      circuitState: item.circuitState,
      consecutiveFailures: item.consecutiveFailures,
      lastFailureAt: item.lastFailureAt,
      nextRetryAt: item.nextRetryAt,
    }));
  },
});

// =============================================================================
// ACCOUNTS QUERIES
// =============================================================================

/**
 * Get all accounts for a user.
 *
 * @security Components cannot access ctx.auth. Host apps must validate userId
 * before calling this query.
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

    // Explicitly map fields to avoid including _creationTime from Convex
    return accounts.map((acc) => ({
      _id: String(acc._id),
      userId: acc.userId,
      plaidItemId: acc.plaidItemId,
      accountId: acc.accountId,
      name: acc.name,
      officialName: acc.officialName,
      mask: acc.mask,
      type: acc.type,
      subtype: acc.subtype,
      balances: acc.balances,
      createdAt: acc.createdAt,
    }));
  },
});

/**
 * Get all accounts for a specific plaidItem.
 *
 * @security Components cannot access ctx.auth. Host apps must verify ownership
 * of the plaidItem before calling this query.
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

    // Explicitly map fields to avoid including _creationTime from Convex
    return accounts.map((acc) => ({
      _id: String(acc._id),
      userId: acc.userId,
      plaidItemId: acc.plaidItemId,
      accountId: acc.accountId,
      name: acc.name,
      officialName: acc.officialName,
      mask: acc.mask,
      type: acc.type,
      subtype: acc.subtype,
      balances: acc.balances,
      createdAt: acc.createdAt,
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
/**
 * Get transactions for a specific account.
 *
 * @security Components cannot access ctx.auth. Host apps must verify ownership
 * of the account before calling this query.
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
      enrichmentData: v.optional(
        v.object({
          counterpartyName: v.optional(v.string()),
          counterpartyType: v.optional(v.string()),
          counterpartyEntityId: v.optional(v.string()),
          counterpartyConfidence: v.optional(v.string()),
          counterpartyLogoUrl: v.optional(v.string()),
          counterpartyWebsite: v.optional(v.string()),
          counterpartyPhoneNumber: v.optional(v.string()),
          enrichedAt: v.optional(v.number()),
        })
      ),
      merchantId: v.optional(v.string()),
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
      enrichmentData: txn.enrichmentData,
      merchantId: txn.merchantId,
      createdAt: txn.createdAt,
    }));
  },
});

/**
 * Get transactions for a user with date range filtering.
 *
 * @security Components cannot access ctx.auth. Host apps must validate userId
 * before calling this query.
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
      enrichmentData: v.optional(
        v.object({
          counterpartyName: v.optional(v.string()),
          counterpartyType: v.optional(v.string()),
          counterpartyEntityId: v.optional(v.string()),
          counterpartyConfidence: v.optional(v.string()),
          counterpartyLogoUrl: v.optional(v.string()),
          counterpartyWebsite: v.optional(v.string()),
          counterpartyPhoneNumber: v.optional(v.string()),
          enrichedAt: v.optional(v.number()),
        })
      ),
      merchantId: v.optional(v.string()),
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
      enrichmentData: txn.enrichmentData,
      merchantId: txn.merchantId,
      createdAt: txn.createdAt,
    }));
  },
});

// =============================================================================
// LIABILITIES QUERIES
// =============================================================================

/**
 * Get credit card liabilities for a specific plaidItem.
 *
 * @security Components cannot access ctx.auth. Host apps must verify ownership
 * of the plaidItem before calling this query.
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

    // Explicitly map fields to avoid including _creationTime from Convex
    return liabilities.map((l) => ({
      _id: String(l._id),
      userId: l.userId,
      plaidItemId: l.plaidItemId,
      accountId: l.accountId,
      aprs: l.aprs,
      isOverdue: l.isOverdue,
      lastPaymentAmount: l.lastPaymentAmount,
      lastPaymentDate: l.lastPaymentDate,
      lastStatementBalance: l.lastStatementBalance,
      lastStatementIssueDate: l.lastStatementIssueDate,
      minimumPaymentAmount: l.minimumPaymentAmount,
      nextPaymentDueDate: l.nextPaymentDueDate,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    }));
  },
});

/**
 * Get all credit card liabilities for a user.
 *
 * @security Components cannot access ctx.auth. Host apps must validate userId
 * before calling this query.
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

    // Explicitly map fields to avoid including _creationTime from Convex
    return liabilities.map((l) => ({
      _id: String(l._id),
      userId: l.userId,
      plaidItemId: l.plaidItemId,
      accountId: l.accountId,
      aprs: l.aprs,
      isOverdue: l.isOverdue,
      lastPaymentAmount: l.lastPaymentAmount,
      lastPaymentDate: l.lastPaymentDate,
      lastStatementBalance: l.lastStatementBalance,
      lastStatementIssueDate: l.lastStatementIssueDate,
      minimumPaymentAmount: l.minimumPaymentAmount,
      nextPaymentDueDate: l.nextPaymentDueDate,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    }));
  },
});

// =============================================================================
// MORTGAGE LIABILITIES QUERIES
// =============================================================================

const propertyAddressValidator = v.optional(
  v.object({
    street: v.optional(v.string()),
    city: v.optional(v.string()),
    region: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.optional(v.string()),
  })
);

const mortgageLiabilityReturnValidator = v.object({
  _id: v.string(),
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
  propertyAddress: propertyAddressValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
});

/**
 * Get all mortgage liabilities for a user.
 *
 * @security Components cannot access ctx.auth. Host apps must validate userId
 * before calling this query.
 */
export const getMortgageLiabilitiesByUser = query({
  args: { userId: v.string() },
  returns: v.array(mortgageLiabilityReturnValidator),
  handler: async (ctx, args) => {
    const mortgages = await ctx.db
      .query("plaidMortgageLiabilities")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Explicitly map fields to avoid including _creationTime from Convex
    return mortgages.map((m) => ({
      _id: String(m._id),
      userId: m.userId,
      plaidItemId: m.plaidItemId,
      accountId: m.accountId,
      accountNumber: m.accountNumber,
      loanTerm: m.loanTerm,
      loanTypeDescription: m.loanTypeDescription,
      originationDate: m.originationDate,
      maturityDate: m.maturityDate,
      interestRatePercentage: m.interestRatePercentage,
      interestRateType: m.interestRateType,
      lastPaymentAmount: m.lastPaymentAmount,
      lastPaymentDate: m.lastPaymentDate,
      nextMonthlyPayment: m.nextMonthlyPayment,
      nextPaymentDueDate: m.nextPaymentDueDate,
      originationPrincipalAmount: m.originationPrincipalAmount,
      currentLateFee: m.currentLateFee,
      escrowBalance: m.escrowBalance,
      pastDueAmount: m.pastDueAmount,
      ytdInterestPaid: m.ytdInterestPaid,
      ytdPrincipalPaid: m.ytdPrincipalPaid,
      hasPmi: m.hasPmi,
      hasPrepaymentPenalty: m.hasPrepaymentPenalty,
      propertyAddress: m.propertyAddress,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }));
  },
});

/**
 * Get mortgage liability for a specific account.
 *
 * @security Components cannot access ctx.auth. Host apps must verify ownership
 * of the account before calling this query.
 */
export const getMortgageLiabilityByAccount = query({
  args: { accountId: v.string() },
  returns: v.union(mortgageLiabilityReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const mortgage = await ctx.db
      .query("plaidMortgageLiabilities")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();

    if (!mortgage) return null;

    // Explicitly map fields to avoid including _creationTime from Convex
    return {
      _id: String(mortgage._id),
      userId: mortgage.userId,
      plaidItemId: mortgage.plaidItemId,
      accountId: mortgage.accountId,
      accountNumber: mortgage.accountNumber,
      loanTerm: mortgage.loanTerm,
      loanTypeDescription: mortgage.loanTypeDescription,
      originationDate: mortgage.originationDate,
      maturityDate: mortgage.maturityDate,
      interestRatePercentage: mortgage.interestRatePercentage,
      interestRateType: mortgage.interestRateType,
      lastPaymentAmount: mortgage.lastPaymentAmount,
      lastPaymentDate: mortgage.lastPaymentDate,
      nextMonthlyPayment: mortgage.nextMonthlyPayment,
      nextPaymentDueDate: mortgage.nextPaymentDueDate,
      originationPrincipalAmount: mortgage.originationPrincipalAmount,
      currentLateFee: mortgage.currentLateFee,
      escrowBalance: mortgage.escrowBalance,
      pastDueAmount: mortgage.pastDueAmount,
      ytdInterestPaid: mortgage.ytdInterestPaid,
      ytdPrincipalPaid: mortgage.ytdPrincipalPaid,
      hasPmi: mortgage.hasPmi,
      hasPrepaymentPenalty: mortgage.hasPrepaymentPenalty,
      propertyAddress: mortgage.propertyAddress,
      createdAt: mortgage.createdAt,
      updatedAt: mortgage.updatedAt,
    };
  },
});

// =============================================================================
// STUDENT LOAN LIABILITIES QUERIES
// =============================================================================

const servicerAddressValidator = v.optional(
  v.object({
    street: v.optional(v.string()),
    city: v.optional(v.string()),
    region: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.optional(v.string()),
  })
);

const loanStatusValidator = v.optional(
  v.object({
    type: v.optional(v.string()),
    endDate: v.optional(v.string()),
  })
);

const repaymentPlanValidator = v.optional(
  v.object({
    type: v.optional(v.string()),
    description: v.optional(v.string()),
  })
);

const studentLoanLiabilityReturnValidator = v.object({
  _id: v.string(),
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
  loanStatus: loanStatusValidator,
  repaymentPlan: repaymentPlanValidator,
  servicerAddress: servicerAddressValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
});

/**
 * Get all student loan liabilities for a user.
 *
 * @security Components cannot access ctx.auth. Host apps must validate userId
 * before calling this query.
 */
export const getStudentLoanLiabilitiesByUser = query({
  args: { userId: v.string() },
  returns: v.array(studentLoanLiabilityReturnValidator),
  handler: async (ctx, args) => {
    const studentLoans = await ctx.db
      .query("plaidStudentLoanLiabilities")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Explicitly map fields to avoid including _creationTime from Convex
    return studentLoans.map((sl) => ({
      _id: String(sl._id),
      userId: sl.userId,
      plaidItemId: sl.plaidItemId,
      accountId: sl.accountId,
      accountNumber: sl.accountNumber,
      loanName: sl.loanName,
      guarantor: sl.guarantor,
      sequenceNumber: sl.sequenceNumber,
      disbursementDates: sl.disbursementDates,
      originationDate: sl.originationDate,
      expectedPayoffDate: sl.expectedPayoffDate,
      lastStatementIssueDate: sl.lastStatementIssueDate,
      interestRatePercentage: sl.interestRatePercentage,
      lastPaymentAmount: sl.lastPaymentAmount,
      lastPaymentDate: sl.lastPaymentDate,
      minimumPaymentAmount: sl.minimumPaymentAmount,
      nextPaymentDueDate: sl.nextPaymentDueDate,
      paymentReferenceNumber: sl.paymentReferenceNumber,
      originationPrincipalAmount: sl.originationPrincipalAmount,
      outstandingInterestAmount: sl.outstandingInterestAmount,
      lastStatementBalance: sl.lastStatementBalance,
      ytdInterestPaid: sl.ytdInterestPaid,
      ytdPrincipalPaid: sl.ytdPrincipalPaid,
      isOverdue: sl.isOverdue,
      loanStatus: sl.loanStatus,
      repaymentPlan: sl.repaymentPlan,
      servicerAddress: sl.servicerAddress,
      createdAt: sl.createdAt,
      updatedAt: sl.updatedAt,
    }));
  },
});

/**
 * Get student loan liability for a specific account.
 *
 * @security Components cannot access ctx.auth. Host apps must verify ownership
 * of the account before calling this query.
 */
export const getStudentLoanLiabilityByAccount = query({
  args: { accountId: v.string() },
  returns: v.union(studentLoanLiabilityReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const studentLoan = await ctx.db
      .query("plaidStudentLoanLiabilities")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();

    if (!studentLoan) return null;

    // Explicitly map fields to avoid including _creationTime from Convex
    return {
      _id: String(studentLoan._id),
      userId: studentLoan.userId,
      plaidItemId: studentLoan.plaidItemId,
      accountId: studentLoan.accountId,
      accountNumber: studentLoan.accountNumber,
      loanName: studentLoan.loanName,
      guarantor: studentLoan.guarantor,
      sequenceNumber: studentLoan.sequenceNumber,
      disbursementDates: studentLoan.disbursementDates,
      originationDate: studentLoan.originationDate,
      expectedPayoffDate: studentLoan.expectedPayoffDate,
      lastStatementIssueDate: studentLoan.lastStatementIssueDate,
      interestRatePercentage: studentLoan.interestRatePercentage,
      lastPaymentAmount: studentLoan.lastPaymentAmount,
      lastPaymentDate: studentLoan.lastPaymentDate,
      minimumPaymentAmount: studentLoan.minimumPaymentAmount,
      nextPaymentDueDate: studentLoan.nextPaymentDueDate,
      paymentReferenceNumber: studentLoan.paymentReferenceNumber,
      originationPrincipalAmount: studentLoan.originationPrincipalAmount,
      outstandingInterestAmount: studentLoan.outstandingInterestAmount,
      lastStatementBalance: studentLoan.lastStatementBalance,
      ytdInterestPaid: studentLoan.ytdInterestPaid,
      ytdPrincipalPaid: studentLoan.ytdPrincipalPaid,
      isOverdue: studentLoan.isOverdue,
      loanStatus: studentLoan.loanStatus,
      repaymentPlan: studentLoan.repaymentPlan,
      servicerAddress: studentLoan.servicerAddress,
      createdAt: studentLoan.createdAt,
      updatedAt: studentLoan.updatedAt,
    };
  },
});

// =============================================================================
// MERCHANT ENRICHMENT QUERIES
// =============================================================================

const merchantEnrichmentReturnValidator = v.object({
  _id: v.string(),
  merchantId: v.string(),
  merchantName: v.string(),
  logoUrl: v.optional(v.string()),
  categoryPrimary: v.optional(v.string()),
  categoryDetailed: v.optional(v.string()),
  categoryIconUrl: v.optional(v.string()),
  website: v.optional(v.string()),
  phoneNumber: v.optional(v.string()),
  confidenceLevel: v.string(),
  lastEnriched: v.number(),
});

/**
 * Get merchant enrichment data by merchant ID.
 */
export const getMerchantEnrichment = query({
  args: { merchantId: v.string() },
  returns: v.union(merchantEnrichmentReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const merchant = await ctx.db
      .query("merchantEnrichments")
      .withIndex("by_merchant", (q) => q.eq("merchantId", args.merchantId))
      .first();

    if (!merchant) return null;

    // Explicitly map fields to avoid including _creationTime from Convex
    return {
      _id: String(merchant._id),
      merchantId: merchant.merchantId,
      merchantName: merchant.merchantName,
      logoUrl: merchant.logoUrl,
      categoryPrimary: merchant.categoryPrimary,
      categoryDetailed: merchant.categoryDetailed,
      categoryIconUrl: merchant.categoryIconUrl,
      website: merchant.website,
      phoneNumber: merchant.phoneNumber,
      confidenceLevel: merchant.confidenceLevel,
      lastEnriched: merchant.lastEnriched,
    };
  },
});

// =============================================================================
// PUBLIC MUTATIONS
// =============================================================================

/**
 * Delete a Plaid item and all associated data.
 *
 * Uses recursive batched deletion to handle large datasets without timeout.
 * The item is immediately marked as "deleting" (fast response to caller),
 * then background workers delete associated data in batches.
 *
 * @param plaidItemId - The ID of the plaidItem to delete
 * @returns Status of deletion (scheduled or not found)
 *
 * @security Components cannot access ctx.auth. Host apps must verify ownership
 * before allowing this mutation.
 */
export const deletePlaidItem = mutation({
  args: { plaidItemId: v.string() },
  returns: v.object({
    status: v.union(v.literal("scheduled"), v.literal("not_found")),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    // Find the item
    const normalizedId = ctx.db.normalizeId("plaidItems", args.plaidItemId);
    if (!normalizedId) {
      return {
        status: "not_found" as const,
        message: "Plaid item not found",
      };
    }

    const item = await ctx.db.get(normalizedId);

    if (!item) {
      return {
        status: "not_found" as const,
        message: "Plaid item not found",
      };
    }

    // Mark as "deleting" immediately (user sees fast response)
    await ctx.db.patch(item._id, {
      status: "deleting" as const,
    });

    // Schedule background cleanup (runs in batches to avoid timeout)
    await ctx.scheduler.runAfter(0, internal.private.cleanupDeletedItem, {
      plaidItemId: args.plaidItemId,
      batchSize: 500,
    });

    return {
      status: "scheduled" as const,
      message: "Deletion scheduled - associated data will be removed in background",
    };
  },
});

/**
 * Toggle the isActive state of a plaidItem.
 * Used to pause/resume syncing for a bank connection.
 *
 * @security Components cannot access ctx.auth. Host apps must verify ownership
 * before allowing this mutation.
 */
export const togglePlaidItemActive = mutation({
  args: { itemId: v.string() },
  returns: v.object({ isActive: v.boolean() }),
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("plaidItems")
      .withIndex("by_item_id", (q) => q.eq("itemId", args.itemId))
      .unique();

    if (!item) throw new Error("Item not found");

    const newIsActive = !(item.isActive ?? true);
    await ctx.db.patch(item._id, { isActive: newIsActive });

    return { isActive: newIsActive };
  },
});

/**
 * Explicitly set the isActive state of a plaidItem.
 * Used when you need to set a specific state rather than toggle.
 *
 * @security Components cannot access ctx.auth. Host apps must verify ownership
 * before allowing this mutation.
 */
export const setPlaidItemActive = mutation({
  args: {
    itemId: v.string(),
    isActive: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("plaidItems")
      .withIndex("by_item_id", (q) => q.eq("itemId", args.itemId))
      .unique();

    if (!item) throw new Error("Item not found");

    await ctx.db.patch(item._id, { isActive: args.isActive });
    return null;
  },
});

// =============================================================================
// RECURRING STREAMS QUERIES
// =============================================================================

const recurringStreamReturnValidator = v.object({
  _id: v.string(),
  userId: v.string(),
  plaidItemId: v.string(),
  streamId: v.string(),
  accountId: v.string(),
  description: v.string(),
  merchantName: v.optional(v.string()),
  averageAmount: v.number(),
  lastAmount: v.number(),
  isoCurrencyCode: v.string(),
  frequency: v.string(),
  status: v.string(),
  isActive: v.boolean(),
  type: v.string(),
  category: v.optional(v.string()),
  firstDate: v.optional(v.string()),
  lastDate: v.optional(v.string()),
  predictedNextDate: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/**
 * Get all recurring streams for a user.
 *
 * @security Components cannot access ctx.auth. Host apps must validate userId
 * before calling this query.
 */
export const getRecurringStreamsByUser = query({
  args: { userId: v.string() },
  returns: v.array(recurringStreamReturnValidator),
  handler: async (ctx, args) => {
    const streams = await ctx.db
      .query("plaidRecurringStreams")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Explicitly map fields to avoid including _creationTime from Convex
    return streams.map((stream) => ({
      _id: String(stream._id),
      userId: stream.userId,
      plaidItemId: stream.plaidItemId,
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
      createdAt: stream.createdAt,
      updatedAt: stream.updatedAt,
    }));
  },
});

/**
 * Get recurring streams for a specific plaidItem.
 *
 * @security Components cannot access ctx.auth. Host apps must verify ownership
 * of the plaidItem before calling this query.
 */
export const getRecurringStreamsByItem = query({
  args: { plaidItemId: v.string() },
  returns: v.array(recurringStreamReturnValidator),
  handler: async (ctx, args) => {
    const streams = await ctx.db
      .query("plaidRecurringStreams")
      .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .collect();

    // Explicitly map fields to avoid including _creationTime from Convex
    return streams.map((stream) => ({
      _id: String(stream._id),
      userId: stream.userId,
      plaidItemId: stream.plaidItemId,
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
      createdAt: stream.createdAt,
      updatedAt: stream.updatedAt,
    }));
  },
});

/**
 * Get active subscriptions (MATURE + outflow + isActive).
 * These are established recurring expenses like Netflix, Spotify, etc.
 *
 * @security Components cannot access ctx.auth. Host apps must validate userId
 * before calling this query.
 */
export const getActiveSubscriptions = query({
  args: { userId: v.string() },
  returns: v.array(recurringStreamReturnValidator),
  handler: async (ctx, args) => {
    const streams = await ctx.db
      .query("plaidRecurringStreams")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Filter for active subscriptions
    const subscriptions = streams.filter(
      (s) => s.status === "MATURE" && s.type === "outflow" && s.isActive
    );

    // Explicitly map fields to avoid including _creationTime from Convex
    return subscriptions.map((stream) => ({
      _id: String(stream._id),
      userId: stream.userId,
      plaidItemId: stream.plaidItemId,
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
      createdAt: stream.createdAt,
      updatedAt: stream.updatedAt,
    }));
  },
});

/**
 * Get recurring income streams (MATURE + inflow + isActive).
 * These are established recurring income like paychecks, deposits, etc.
 *
 * @security Components cannot access ctx.auth. Host apps must validate userId
 * before calling this query.
 */
export const getRecurringIncome = query({
  args: { userId: v.string() },
  returns: v.array(recurringStreamReturnValidator),
  handler: async (ctx, args) => {
    const streams = await ctx.db
      .query("plaidRecurringStreams")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Filter for active income streams
    const income = streams.filter(
      (s) => s.status === "MATURE" && s.type === "inflow" && s.isActive
    );

    // Explicitly map fields to avoid including _creationTime from Convex
    return income.map((stream) => ({
      _id: String(stream._id),
      userId: stream.userId,
      plaidItemId: stream.plaidItemId,
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
      createdAt: stream.createdAt,
      updatedAt: stream.updatedAt,
    }));
  },
});

/**
 * Get subscriptions summary for a user.
 * Returns count and estimated monthly total.
 *
 * @security Components cannot access ctx.auth. Host apps must validate userId
 * before calling this query.
 */
export const getSubscriptionsSummary = query({
  args: { userId: v.string() },
  returns: v.object({
    count: v.number(),
    monthlyTotal: v.number(), // MILLIUNITS
    weeklyCount: v.number(),
    biweeklyCount: v.number(),
    monthlyCount: v.number(),
    annualCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const streams = await ctx.db
      .query("plaidRecurringStreams")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Filter for active subscriptions
    const subscriptions = streams.filter(
      (s) => s.status === "MATURE" && s.type === "outflow" && s.isActive
    );

    let monthlyTotal = 0;
    let weeklyCount = 0;
    let biweeklyCount = 0;
    let monthlyCount = 0;
    let annualCount = 0;

    for (const sub of subscriptions) {
      // Normalize to monthly equivalent
      switch (sub.frequency) {
        case "WEEKLY":
          monthlyTotal += sub.averageAmount * 4.33; // ~4.33 weeks per month
          weeklyCount++;
          break;
        case "BIWEEKLY":
          monthlyTotal += sub.averageAmount * 2.17; // ~2.17 bi-weeks per month
          biweeklyCount++;
          break;
        case "SEMI_MONTHLY":
          monthlyTotal += sub.averageAmount * 2;
          biweeklyCount++; // Close enough
          break;
        case "MONTHLY":
          monthlyTotal += sub.averageAmount;
          monthlyCount++;
          break;
        case "ANNUALLY":
          monthlyTotal += sub.averageAmount / 12;
          annualCount++;
          break;
        default:
          monthlyTotal += sub.averageAmount; // Assume monthly
          monthlyCount++;
      }
    }

    return {
      count: subscriptions.length,
      monthlyTotal: Math.round(monthlyTotal),
      weeklyCount,
      biweeklyCount,
      monthlyCount,
      annualCount,
    };
  },
});

// =============================================================================
// SYNC LOGS QUERIES
// =============================================================================

const syncResultValidator = v.optional(
  v.object({
    transactionsAdded: v.optional(v.number()),
    transactionsModified: v.optional(v.number()),
    transactionsRemoved: v.optional(v.number()),
    accountsUpdated: v.optional(v.number()),
    streamsUpdated: v.optional(v.number()),
    creditCardsUpdated: v.optional(v.number()),
    mortgagesUpdated: v.optional(v.number()),
    studentLoansUpdated: v.optional(v.number()),
  })
);

const syncLogReturnValidator = v.object({
  _id: v.string(),
  plaidItemId: v.string(),
  userId: v.string(),
  syncType: v.string(),
  trigger: v.string(),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  durationMs: v.optional(v.number()),
  status: v.string(),
  result: syncResultValidator,
  errorCode: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  retryCount: v.optional(v.number()),
});

/**
 * Get sync logs for a specific plaidItem.
 * Returns most recent first.
 *
 * @security Components cannot access ctx.auth. Host apps must verify ownership
 * of the plaidItem before calling this query.
 */
export const getSyncLogsByItem = query({
  args: {
    plaidItemId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(syncLogReturnValidator),
  handler: async (ctx, args) => {
    let queryBuilder = ctx.db
      .query("syncLogs")
      .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .order("desc");

    const logs = args.limit
      ? await queryBuilder.take(args.limit)
      : await queryBuilder.collect();

    // Explicitly map fields to avoid including _creationTime from Convex
    return logs.map((log) => ({
      _id: String(log._id),
      plaidItemId: log.plaidItemId,
      userId: log.userId,
      syncType: log.syncType,
      trigger: log.trigger,
      startedAt: log.startedAt,
      completedAt: log.completedAt,
      durationMs: log.durationMs,
      status: log.status,
      result: log.result,
      errorCode: log.errorCode,
      errorMessage: log.errorMessage,
      retryCount: log.retryCount,
    }));
  },
});

/**
 * Get sync logs for a user.
 * Returns most recent first.
 *
 * @security Components cannot access ctx.auth. Host apps must validate userId
 * before calling this query.
 */
export const getSyncLogsByUser = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(syncLogReturnValidator),
  handler: async (ctx, args) => {
    let queryBuilder = ctx.db
      .query("syncLogs")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc");

    const logs = args.limit
      ? await queryBuilder.take(args.limit)
      : await queryBuilder.collect();

    // Explicitly map fields to avoid including _creationTime from Convex
    return logs.map((log) => ({
      _id: String(log._id),
      plaidItemId: log.plaidItemId,
      userId: log.userId,
      syncType: log.syncType,
      trigger: log.trigger,
      startedAt: log.startedAt,
      completedAt: log.completedAt,
      durationMs: log.durationMs,
      status: log.status,
      result: log.result,
      errorCode: log.errorCode,
      errorMessage: log.errorMessage,
      retryCount: log.retryCount,
    }));
  },
});

/**
 * Get sync statistics for a plaidItem.
 * Useful for monitoring sync health.
 *
 * @security Components cannot access ctx.auth. Host apps must verify ownership
 * of the plaidItem before calling this query.
 */
export const getSyncStats = query({
  args: {
    plaidItemId: v.string(),
    daysBack: v.optional(v.number()), // Default: 7 days
  },
  returns: v.object({
    totalSyncs: v.number(),
    successCount: v.number(),
    errorCount: v.number(),
    successRate: v.number(), // 0-100 percentage
    averageDurationMs: v.optional(v.number()),
    lastSyncAt: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()),
    lastErrorAt: v.optional(v.number()),
    lastErrorMessage: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const daysBack = args.daysBack ?? 7;
    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

    const logs = await ctx.db
      .query("syncLogs")
      .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .collect();

    // Filter to recent logs
    const recentLogs = logs.filter((log) => log.startedAt >= cutoff);

    const successLogs = recentLogs.filter((log) => log.status === "success");
    const errorLogs = recentLogs.filter(
      (log) =>
        log.status === "error" ||
        log.status === "rate_limited" ||
        log.status === "circuit_open"
    );

    // Calculate average duration for completed syncs
    const completedLogs = recentLogs.filter((log) => log.durationMs != null);
    const averageDurationMs =
      completedLogs.length > 0
        ? Math.round(
            completedLogs.reduce((sum, log) => sum + (log.durationMs ?? 0), 0) /
              completedLogs.length
          )
        : undefined;

    // Find last sync times
    const sortedByStart = [...recentLogs].sort(
      (a, b) => b.startedAt - a.startedAt
    );
    const lastSync = sortedByStart[0];
    const lastSuccess = successLogs.sort(
      (a, b) => b.startedAt - a.startedAt
    )[0];
    const lastError = errorLogs.sort((a, b) => b.startedAt - a.startedAt)[0];

    return {
      totalSyncs: recentLogs.length,
      successCount: successLogs.length,
      errorCount: errorLogs.length,
      successRate:
        recentLogs.length > 0
          ? Math.round((successLogs.length / recentLogs.length) * 100)
          : 100,
      averageDurationMs,
      lastSyncAt: lastSync?.startedAt,
      lastSuccessAt: lastSuccess?.startedAt,
      lastErrorAt: lastError?.startedAt,
      lastErrorMessage: lastError?.errorMessage,
    };
  },
});

// =============================================================================
// INSTITUTION QUERIES
// =============================================================================

const institutionReturnValidator = v.object({
  _id: v.string(),
  institutionId: v.string(),
  name: v.string(),
  logo: v.optional(v.string()),
  primaryColor: v.optional(v.string()),
  url: v.optional(v.string()),
  products: v.optional(v.array(v.string())),
  lastFetched: v.number(),
});

/**
 * Get institution metadata by institutionId.
 * Returns cached institution data including logo and branding.
 */
export const getInstitution = query({
  args: { institutionId: v.string() },
  returns: v.union(institutionReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const institution = await ctx.db
      .query("plaidInstitutions")
      .withIndex("by_institution_id", (q) =>
        q.eq("institutionId", args.institutionId)
      )
      .first();

    if (!institution) return null;

    // Explicitly map fields to avoid including _creationTime from Convex
    return {
      _id: String(institution._id),
      institutionId: institution.institutionId,
      name: institution.name,
      logo: institution.logo,
      primaryColor: institution.primaryColor,
      url: institution.url,
      products: institution.products,
      lastFetched: institution.lastFetched,
    };
  },
});

/**
 * Get all cached institutions.
 * Useful for displaying a list of known institutions.
 */
export const getAllInstitutions = query({
  args: {},
  returns: v.array(institutionReturnValidator),
  handler: async (ctx) => {
    const institutions = await ctx.db.query("plaidInstitutions").collect();

    // Explicitly map fields to avoid including _creationTime from Convex
    return institutions.map((inst) => ({
      _id: String(inst._id),
      institutionId: inst.institutionId,
      name: inst.name,
      logo: inst.logo,
      primaryColor: inst.primaryColor,
      url: inst.url,
      products: inst.products,
      lastFetched: inst.lastFetched,
    }));
  },
});
