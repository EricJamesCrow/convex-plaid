/**
 * Plaid Component Schema
 *
 * Tables for storing Plaid integration data.
 * All monetary values stored as MILLIUNITS (amount × 1000) to avoid float precision errors.
 *
 * IMPORTANT: Component boundaries require string IDs, not v.id() types.
 * - userId: string (passed from host app, not from ctx.auth)
 * - plaidItemId: string (Convex document ID as string for crossing component boundary)
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  /**
   * Plaid Items - Connection metadata for each linked bank/institution
   *
   * Each plaidItem represents one Plaid Link connection.
   * Access tokens are encrypted using JWE (A256GCM) before storage.
   */
  plaidItems: defineTable({
    userId: v.string(), // Host app user ID (passed explicitly, NOT from ctx.auth)
    itemId: v.string(), // Plaid item_id (unique per connection)
    accessToken: v.string(), // JWE encrypted access token
    cursor: v.optional(v.string()), // For incremental /transactions/sync
    institutionId: v.optional(v.string()), // Bank/institution identifier
    institutionName: v.optional(v.string()), // Display name: "Chase", "Wells Fargo"
    status: v.union(
      v.literal("pending"),
      v.literal("syncing"),
      v.literal("active"),
      v.literal("error"),
      v.literal("needs_reauth")
    ),
    syncError: v.optional(v.string()), // Error message from last sync attempt
    createdAt: v.number(), // Unix timestamp
    lastSyncedAt: v.optional(v.number()), // Last successful sync timestamp
  })
    .index("by_user", ["userId"])
    .index("by_item_id", ["itemId"]),

  /**
   * Plaid Accounts - Bank/credit accounts from Plaid API
   *
   * Each account belongs to a plaidItem.
   * Balances stored in MILLIUNITS (amount × 1000).
   */
  plaidAccounts: defineTable({
    userId: v.string(),
    plaidItemId: v.string(), // String ID for component boundary (not v.id)
    accountId: v.string(), // Plaid account_id
    name: v.string(), // "Chase Freedom Unlimited"
    officialName: v.optional(v.string()), // Official account name from bank
    mask: v.optional(v.string()), // Last 4 digits: "1234"
    type: v.string(), // "credit", "depository", "loan"
    subtype: v.optional(v.string()), // "credit card", "checking", "savings"
    balances: v.object({
      available: v.optional(v.number()), // MILLIUNITS
      current: v.optional(v.number()), // MILLIUNITS
      limit: v.optional(v.number()), // Credit limit (MILLIUNITS)
      isoCurrencyCode: v.string(),
    }),
    createdAt: v.number(),
  })
    .index("by_plaid_item", ["plaidItemId"])
    .index("by_account_id", ["accountId"])
    .index("by_user", ["userId"]),

  /**
   * Plaid Transactions - Transaction history from Plaid API
   *
   * Uses cursor-based /transactions/sync for incremental updates.
   * Amounts stored in MILLIUNITS (amount × 1000).
   */
  plaidTransactions: defineTable({
    userId: v.string(),
    plaidItemId: v.string(), // String ID for component boundary
    accountId: v.string(), // Plaid account_id
    transactionId: v.string(), // Plaid transaction_id (unique)

    // Core transaction data
    amount: v.number(), // MILLIUNITS (integer) - multiply Plaid amount by 1000
    isoCurrencyCode: v.string(),
    date: v.string(), // ISO date string: "2025-01-15"
    datetime: v.optional(v.string()), // ISO datetime if available

    // Display fields
    name: v.string(), // Raw transaction name from Plaid
    merchantName: v.optional(v.string()), // Cleaned merchant name
    pending: v.boolean(),
    pendingTransactionId: v.optional(v.string()),

    // Categorization (Personal Finance Categories)
    categoryPrimary: v.optional(v.string()), // "FOOD_AND_DRINK"
    categoryDetailed: v.optional(v.string()), // "FOOD_AND_DRINK_COFFEE"

    // Additional data
    paymentChannel: v.optional(v.string()), // "online", "in store"

    createdAt: v.number(),
    updatedAt: v.optional(v.number()), // Track modifications from sync
  })
    .index("by_account", ["accountId"])
    .index("by_transaction_id", ["transactionId"])
    .index("by_date", ["userId", "date"])
    .index("by_plaid_item", ["plaidItemId"]),

  /**
   * Plaid Credit Card Liabilities - APRs, payment info, due dates
   *
   * From Plaid /liabilities/get API (credit card product).
   * One record per credit card account.
   * All monetary values in MILLIUNITS.
   */
  plaidCreditCardLiabilities: defineTable({
    userId: v.string(),
    plaidItemId: v.string(), // String ID for component boundary
    accountId: v.string(), // Plaid account_id

    // APR data (multiple APRs possible: purchase, cash, balance transfer)
    aprs: v.array(
      v.object({
        aprPercentage: v.number(), // e.g., 15.99 for 15.99%
        aprType: v.string(), // 'balance_transfer_apr' | 'cash_apr' | 'purchase_apr'
        balanceSubjectToApr: v.optional(v.number()), // MILLIUNITS
        interestChargeAmount: v.optional(v.number()), // MILLIUNITS
      })
    ),

    // Payment status
    isOverdue: v.boolean(),

    // Payment history
    lastPaymentAmount: v.optional(v.number()), // MILLIUNITS
    lastPaymentDate: v.optional(v.string()), // ISO date

    // Statement info
    lastStatementBalance: v.optional(v.number()), // MILLIUNITS
    lastStatementIssueDate: v.optional(v.string()), // ISO date

    // Upcoming payment
    minimumPaymentAmount: v.optional(v.number()), // MILLIUNITS
    nextPaymentDueDate: v.optional(v.string()), // ISO date

    // Metadata
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_plaid_item", ["plaidItemId"])
    .index("by_user", ["userId"]),
});
