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
    products: v.array(v.string()), // Plaid products enabled: ["transactions", "liabilities"]
    isActive: v.optional(v.boolean()), // User toggle (default true) - allows pausing sync
    status: v.union(
      v.literal("pending"),
      v.literal("syncing"),
      v.literal("active"),
      v.literal("error"),
      v.literal("needs_reauth"),
      v.literal("deleting") // Item is being deleted (cascading delete in progress)
    ),
    syncError: v.optional(v.string()), // Error message from last sync attempt
    createdAt: v.number(), // Unix timestamp
    lastSyncedAt: v.optional(v.number()), // Last successful sync timestamp
    activatedAt: v.optional(v.number()), // When item was first activated (completed onboarding)

    // Error tracking (from webhook ERROR events)
    errorCode: v.optional(v.string()), // Plaid error code: "ITEM_LOGIN_REQUIRED"
    errorMessage: v.optional(v.string()), // Human-readable error message
    errorAt: v.optional(v.number()), // Timestamp when error occurred

    // Re-auth tracking (for expired credentials)
    reauthReason: v.optional(v.string()), // Why re-auth is needed
    reauthAt: v.optional(v.number()), // When re-auth was marked as needed

    // Disconnect tracking (for revoked access)
    disconnectedReason: v.optional(v.string()), // Why item was disconnected
    disconnectedAt: v.optional(v.number()), // When item was disconnected

    // Optimistic locking for transaction sync (prevents race conditions)
    syncVersion: v.optional(v.number()), // Incremented on each sync start
    syncStartedAt: v.optional(v.number()), // When current sync started (for timeout detection)

    // Circuit breaker state (for resilience)
    circuitState: v.optional(
      v.union(v.literal("closed"), v.literal("open"), v.literal("half_open"))
    ),
    consecutiveFailures: v.optional(v.number()), // Failures before circuit opens
    consecutiveSuccesses: v.optional(v.number()), // Successes in half_open before closing
    lastFailureAt: v.optional(v.number()), // Unix timestamp of last failure
    nextRetryAt: v.optional(v.number()), // When circuit transitions to half_open
  })
    .index("by_user", ["userId"])
    .index("by_item_id", ["itemId"])
    .index("by_status", ["status"]),

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

    // Merchant enrichment (from Plaid Enrich API)
    merchantId: v.optional(v.string()), // FK to merchantEnrichments table
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

    createdAt: v.number(),
    updatedAt: v.optional(v.number()), // Track modifications from sync
  })
    .index("by_account", ["accountId"])
    .index("by_transaction_id", ["transactionId"])
    .index("by_date", ["userId", "date"])
    .index("by_plaid_item", ["plaidItemId"])
    .index("by_merchant", ["merchantId"]),

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

  /**
   * Plaid Recurring Streams - Detected recurring transactions
   *
   * From Plaid /transactions/recurring/get API.
   * Identifies subscriptions, regular bills, and recurring income.
   * All monetary values in MILLIUNITS.
   */
  plaidRecurringStreams: defineTable({
    userId: v.string(),
    plaidItemId: v.string(), // String ID for component boundary
    streamId: v.string(), // Plaid stream_id (unique per stream)
    accountId: v.string(), // Plaid account_id

    // Stream details
    description: v.string(), // Description/name of the recurring transaction
    merchantName: v.optional(v.string()), // Cleaned merchant name

    // Amount & frequency
    averageAmount: v.number(), // MILLIUNITS - average transaction amount
    lastAmount: v.number(), // MILLIUNITS - most recent transaction amount
    isoCurrencyCode: v.string(),
    frequency: v.string(), // WEEKLY, BIWEEKLY, SEMI_MONTHLY, MONTHLY, ANNUALLY

    // Status
    status: v.union(
      v.literal("MATURE"), // Established recurring pattern
      v.literal("EARLY_DETECTION"), // Newly detected, not yet established
      v.literal("TOMBSTONED") // No longer active
    ),
    isActive: v.boolean(), // Quick filter for active streams

    // Type
    type: v.union(v.literal("inflow"), v.literal("outflow")), // Income vs expense
    category: v.optional(v.string()), // Category from Plaid

    // Dates
    firstDate: v.optional(v.string()), // ISO date of first occurrence
    lastDate: v.optional(v.string()), // ISO date of most recent occurrence
    predictedNextDate: v.optional(v.string()), // ISO date of predicted next occurrence

    // Metadata
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_stream_id", ["streamId"])
    .index("by_plaid_item", ["plaidItemId"])
    .index("by_status", ["userId", "status", "isActive"]),

  /**
   * Plaid Mortgage Liabilities - Mortgage loan details
   *
   * From Plaid /liabilities/get API (mortgage product).
   * All monetary values in MILLIUNITS.
   */
  plaidMortgageLiabilities: defineTable({
    userId: v.string(),
    plaidItemId: v.string(), // String ID for component boundary
    accountId: v.string(), // Plaid account_id

    // Loan details
    accountNumber: v.optional(v.string()),
    loanTerm: v.optional(v.string()), // e.g., "30 year"
    loanTypeDescription: v.optional(v.string()),

    // Dates
    originationDate: v.optional(v.string()), // ISO date
    maturityDate: v.optional(v.string()), // ISO date

    // Interest
    interestRatePercentage: v.number(), // e.g., 6.5 for 6.5%
    interestRateType: v.optional(v.string()), // "fixed" or "variable"

    // Payments (MILLIUNITS)
    lastPaymentAmount: v.optional(v.number()),
    lastPaymentDate: v.optional(v.string()),
    nextMonthlyPayment: v.optional(v.number()),
    nextPaymentDueDate: v.optional(v.string()),

    // Financial details (MILLIUNITS)
    originationPrincipalAmount: v.optional(v.number()),
    currentLateFee: v.optional(v.number()),
    escrowBalance: v.optional(v.number()),
    pastDueAmount: v.optional(v.number()),
    ytdInterestPaid: v.optional(v.number()),
    ytdPrincipalPaid: v.optional(v.number()),

    // Flags
    hasPmi: v.optional(v.boolean()),
    hasPrepaymentPenalty: v.optional(v.boolean()),

    // Property address
    propertyAddress: v.optional(
      v.object({
        street: v.optional(v.string()),
        city: v.optional(v.string()),
        region: v.optional(v.string()),
        postalCode: v.optional(v.string()),
        country: v.optional(v.string()),
      })
    ),

    // Metadata
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_account", ["accountId"])
    .index("by_plaid_item", ["plaidItemId"]),

  /**
   * Plaid Student Loan Liabilities - Student loan details
   *
   * From Plaid /liabilities/get API (student loan product).
   * All monetary values in MILLIUNITS.
   */
  plaidStudentLoanLiabilities: defineTable({
    userId: v.string(),
    plaidItemId: v.string(), // String ID for component boundary
    accountId: v.string(), // Plaid account_id

    // Loan details
    accountNumber: v.optional(v.string()),
    loanName: v.optional(v.string()),
    guarantor: v.optional(v.string()),
    sequenceNumber: v.optional(v.string()),

    // Dates
    disbursementDates: v.optional(v.array(v.string())), // Array of ISO dates
    originationDate: v.optional(v.string()),
    expectedPayoffDate: v.optional(v.string()),
    lastStatementIssueDate: v.optional(v.string()),

    // Interest
    interestRatePercentage: v.number(), // e.g., 5.5 for 5.5%

    // Payments (MILLIUNITS)
    lastPaymentAmount: v.optional(v.number()),
    lastPaymentDate: v.optional(v.string()),
    minimumPaymentAmount: v.optional(v.number()),
    nextPaymentDueDate: v.optional(v.string()),
    paymentReferenceNumber: v.optional(v.string()),

    // Financial details (MILLIUNITS)
    originationPrincipalAmount: v.optional(v.number()),
    outstandingInterestAmount: v.optional(v.number()),
    lastStatementBalance: v.optional(v.number()),
    ytdInterestPaid: v.optional(v.number()),
    ytdPrincipalPaid: v.optional(v.number()),

    // Status
    isOverdue: v.optional(v.boolean()),
    loanStatus: v.optional(
      v.object({
        type: v.optional(v.string()), // e.g., "repayment", "deferment"
        endDate: v.optional(v.string()),
      })
    ),

    // Repayment plan
    repaymentPlan: v.optional(
      v.object({
        type: v.optional(v.string()), // e.g., "standard", "income-driven"
        description: v.optional(v.string()),
      })
    ),

    // Servicer address
    servicerAddress: v.optional(
      v.object({
        street: v.optional(v.string()),
        city: v.optional(v.string()),
        region: v.optional(v.string()),
        postalCode: v.optional(v.string()),
        country: v.optional(v.string()),
      })
    ),

    // Metadata
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_account", ["accountId"])
    .index("by_plaid_item", ["plaidItemId"]),

  /**
   * Merchant Enrichments - Cached merchant data from Plaid Enrich API
   *
   * Shared across all users - one record per unique merchant.
   * Used for displaying logos, websites, and merchant details.
   */
  merchantEnrichments: defineTable({
    merchantId: v.string(), // Plaid entity_id (unique per merchant)
    merchantName: v.string(), // Cleaned merchant name
    logoUrl: v.optional(v.string()), // 100x100 PNG from Plaid CDN
    categoryPrimary: v.optional(v.string()), // "FOOD_AND_DRINK"
    categoryDetailed: v.optional(v.string()), // "FOOD_AND_DRINK_COFFEE"
    categoryIconUrl: v.optional(v.string()), // Fallback category icon
    website: v.optional(v.string()),
    phoneNumber: v.optional(v.string()), // E.164 format
    confidenceLevel: v.union(
      v.literal("VERY_HIGH"),
      v.literal("HIGH"),
      v.literal("MEDIUM"),
      v.literal("LOW"),
      v.literal("UNKNOWN")
    ),
    lastEnriched: v.number(), // Timestamp of last enrichment
  }).index("by_merchant", ["merchantId"]),

  /**
   * Webhook Logs - Audit trail for Plaid webhooks
   *
   * Used for deduplication (24-hour window) and debugging.
   * Run pruneOldWebhookLogs periodically (e.g., hourly cron) to prevent table growth.
   */
  webhookLogs: defineTable({
    webhookId: v.string(), // Unique identifier (itemId_code_timestamp)
    itemId: v.string(), // Plaid item_id
    webhookType: v.string(), // TRANSACTIONS, LIABILITIES, ITEM
    webhookCode: v.string(), // SYNC_UPDATES_AVAILABLE, etc.
    bodyHash: v.string(), // SHA-256 of request body (for deduplication)
    receivedAt: v.number(), // Unix timestamp when received
    processedAt: v.optional(v.number()), // Unix timestamp when processed
    status: v.union(
      v.literal("received"),
      v.literal("processing"),
      v.literal("processed"),
      v.literal("duplicate"),
      v.literal("failed")
    ),
    errorMessage: v.optional(v.string()),
    scheduledFunctionId: v.optional(v.string()), // Convex scheduled function ID
  })
    .index("by_body_hash", ["bodyHash"])
    .index("by_received_at", ["receivedAt"])
    .index("by_item", ["itemId"])
    .index("by_status", ["status"]),

  /**
   * Sync Logs - Audit trail for sync operations
   *
   * Tracks every sync operation for debugging and monitoring.
   * Use getSyncLogsByItem, getSyncStats queries to analyze sync health.
   * Run pruneOldSyncLogs periodically (e.g., daily cron) to prevent table growth.
   */
  syncLogs: defineTable({
    plaidItemId: v.string(), // Reference to plaidItem
    userId: v.string(), // Host app user ID
    syncType: v.union(
      v.literal("transactions"),
      v.literal("liabilities"),
      v.literal("recurring"),
      v.literal("accounts"),
      v.literal("onboard")
    ),
    trigger: v.union(
      v.literal("webhook"),
      v.literal("scheduled"),
      v.literal("manual"),
      v.literal("onboard")
    ),
    startedAt: v.number(), // Unix timestamp when sync started
    completedAt: v.optional(v.number()), // Unix timestamp when sync completed
    durationMs: v.optional(v.number()), // Duration in milliseconds
    status: v.union(
      v.literal("started"),
      v.literal("success"),
      v.literal("error"),
      v.literal("rate_limited"),
      v.literal("circuit_open")
    ),
    result: v.optional(
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
    ),
    errorCode: v.optional(v.string()), // Plaid error code if applicable
    errorMessage: v.optional(v.string()), // Error message
    retryCount: v.optional(v.number()), // Number of retries attempted
  })
    .index("by_plaid_item", ["plaidItemId"])
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_started_at", ["startedAt"])
    .index("by_trigger", ["trigger"]),

  /**
   * Plaid Institutions - Cached institution metadata
   *
   * Shared cache of bank logos and branding - same Chase logo not duplicated per user.
   * Auto-populated during exchangePublicToken, refreshed if stale (> 24 hours).
   */
  plaidInstitutions: defineTable({
    institutionId: v.string(), // Plaid institution_id (unique)
    name: v.string(), // "Chase", "Wells Fargo"
    logo: v.optional(v.string()), // Base64 encoded PNG
    primaryColor: v.optional(v.string()), // Hex color "#0074C8"
    url: v.optional(v.string()), // "https://www.chase.com"
    products: v.optional(v.array(v.string())), // ["transactions", "liabilities"]
    lastFetched: v.number(), // Timestamp for cache invalidation
  }).index("by_institution_id", ["institutionId"]),
});
