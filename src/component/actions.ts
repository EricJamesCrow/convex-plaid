/**
 * Plaid Component Actions
 *
 * Core Plaid API actions for Phase 1:
 * - createLinkToken: Initialize Plaid Link UI
 * - exchangePublicToken: Exchange token for access token
 * - fetchAccounts: Fetch and store account data
 * - syncTransactions: Cursor-based transaction sync
 * - fetchLiabilities: Fetch credit card liability data
 *
 * COMPONENT NOTE: All actions receive credentials as parameters.
 * No process.env access - the host app's client class provides config.
 */

import { v } from "convex/values";
import { action } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import {
  initPlaidClient,
  convertAmountToMilliunits,
  transformTransaction,
  syncTransactionsPaginated,
} from "./utils.js";
import { encryptToken, decryptToken } from "./encryption.js";
import { categorizeError, requiresReauth, formatErrorForLog } from "./errors.js";

// =============================================================================
// VALIDATORS (Reusable)
// =============================================================================

const plaidConfigArgs = {
  plaidClientId: v.string(),
  plaidSecret: v.string(),
  plaidEnv: v.string(),
  encryptionKey: v.string(),
};

// =============================================================================
// CREATE LINK TOKEN
// =============================================================================

/**
 * Create a link token for Plaid Link UI initialization.
 *
 * Link tokens are short-lived (30 minutes) and frontend-only.
 * The host app should call this before opening Plaid Link modal.
 */
export const createLinkToken = action({
  args: {
    userId: v.string(),
    products: v.optional(v.array(v.string())),
    countryCodes: v.optional(v.array(v.string())),
    language: v.optional(v.string()),
    clientName: v.optional(v.string()),
    webhookUrl: v.optional(v.string()),
    plaidClientId: v.string(),
    plaidSecret: v.string(),
    plaidEnv: v.string(),
  },
  returns: v.object({
    linkToken: v.string(),
  }),
  handler: async (_ctx, args) => {
    console.log("[Plaid Component] Creating link token for user:", args.userId);

    const plaidClient = initPlaidClient(
      args.plaidClientId,
      args.plaidSecret,
      args.plaidEnv
    );

    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: args.userId,
      },
      client_name: args.clientName ?? "App",
      products: (args.products ?? ["transactions", "liabilities"]) as any[],
      country_codes: (args.countryCodes ?? ["US"]) as any[],
      language: args.language ?? "en",
      transactions: {
        days_requested: 180,
      },
      webhook: args.webhookUrl,
    });

    console.log("[Plaid Component] Link token created successfully");

    return {
      linkToken: response.data.link_token,
    };
  },
});

// =============================================================================
// EXCHANGE PUBLIC TOKEN
// =============================================================================

/**
 * Exchange Plaid public token for access token and create plaidItem.
 *
 * Flow:
 * 1. Exchange public token with Plaid (~200ms)
 * 2. Fetch institution details
 * 3. Encrypt access token
 * 4. Create plaidItem in component database
 * 5. Return itemId and plaidItemId
 *
 * NOTE: Access token is NOT returned for security.
 */
export const exchangePublicToken = action({
  args: {
    publicToken: v.string(),
    userId: v.string(),
    products: v.optional(v.array(v.string())), // Products used for this connection
    ...plaidConfigArgs,
  },
  returns: v.object({
    success: v.boolean(),
    itemId: v.string(),
    plaidItemId: v.string(),
  }),
  handler: async (ctx, args): Promise<{ success: boolean; itemId: string; plaidItemId: string }> => {
    console.log("[Plaid Component] Exchanging public token...");

    const plaidClient = initPlaidClient(
      args.plaidClientId,
      args.plaidSecret,
      args.plaidEnv
    );

    // Exchange public token for access token
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token: args.publicToken,
    });

    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

    console.log("[Plaid Component] Token exchanged, item ID:", itemId);

    // Fetch item details to get institution_id
    const itemResponse = await plaidClient.itemGet({
      access_token: accessToken,
    });

    const institutionId = itemResponse.data.item.institution_id ?? undefined;

    // Fetch institution details and cache metadata (logo, branding)
    let institutionName: string | undefined;
    if (institutionId) {
      try {
        const instResponse = await plaidClient.institutionsGetById({
          institution_id: institutionId,
          country_codes: ["US"] as any[],
          options: {
            include_optional_metadata: true,
          },
        });
        const institution = instResponse.data.institution;
        institutionName = institution.name;
        console.log("[Plaid Component] Institution:", institutionName);

        // Cache institution metadata (shared across users for efficiency)
        await ctx.runMutation(internal.private.upsertInstitution, {
          institutionId,
          name: institution.name,
          logo: institution.logo ?? undefined,
          primaryColor: institution.primary_color ?? undefined,
          url: institution.url ?? undefined,
          products: institution.products ?? undefined,
        });
        console.log("[Plaid Component] Institution metadata cached");
      } catch (e) {
        console.warn("[Plaid Component] Failed to fetch institution details:", e);
      }
    }

    // Encrypt access token before storage
    console.log("[Plaid Component] Encrypting access token...");
    const encryptedToken = await encryptToken(accessToken, args.encryptionKey);

    // Create plaidItem in component database
    // products defaults to ["transactions"] if not specified
    const plaidItemId: string = await ctx.runMutation(internal.private.createPlaidItem, {
      userId: args.userId,
      itemId,
      accessToken: encryptedToken,
      institutionId,
      institutionName,
      products: args.products ?? ["transactions"],
      isActive: true, // Default to active when created
      status: "pending",
    });

    console.log("[Plaid Component] Created plaidItem:", plaidItemId);

    return {
      success: true,
      itemId,
      plaidItemId,
    };
  },
});

// =============================================================================
// FETCH ACCOUNTS
// =============================================================================

/**
 * Fetch and store account data from Plaid.
 *
 * Flow:
 * 1. Get plaidItem and decrypt access token
 * 2. Fetch accounts from Plaid API
 * 3. Transform to component format (with milliunits)
 * 4. Bulk upsert accounts
 */
export const fetchAccounts = action({
  args: {
    plaidItemId: v.string(),
    ...plaidConfigArgs,
  },
  returns: v.object({
    accountCount: v.number(),
  }),
  handler: async (ctx, args) => {
    // Get plaidItem
    const item = await ctx.runQuery(internal.private.getPlaidItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item) {
      throw new Error(`Plaid item not found: ${args.plaidItemId}`);
    }

    // Decrypt access token
    const accessToken = await decryptToken(item.accessToken, args.encryptionKey);

    // Create sync log entry
    const syncLogId = await ctx.runMutation(internal.private.createSyncLog, {
      plaidItemId: args.plaidItemId,
      userId: item.userId,
      syncType: "accounts",
      trigger: "manual",
    });

    console.log("[Plaid Component] Fetching accounts...");

    try {
      const plaidClient = initPlaidClient(
        args.plaidClientId,
        args.plaidSecret,
        args.plaidEnv
      );

      const accountsResponse = await plaidClient.accountsGet({
        access_token: accessToken,
      });

      // Transform accounts
      const accounts = accountsResponse.data.accounts.map((account) => ({
        accountId: account.account_id,
        name: account.name,
        officialName: account.official_name ?? undefined,
        mask: account.mask ?? undefined,
        type: account.type,
        subtype: account.subtype ?? undefined,
        balances: {
          current:
            account.balances.current !== null
              ? convertAmountToMilliunits(account.balances.current)
              : undefined,
          available:
            account.balances.available !== null
              ? convertAmountToMilliunits(account.balances.available)
              : undefined,
          limit:
            account.balances.limit !== null
              ? convertAmountToMilliunits(account.balances.limit)
              : undefined,
          isoCurrencyCode: account.balances.iso_currency_code ?? "USD",
        },
      }));

      // Bulk upsert accounts
      if (accounts.length > 0) {
        await ctx.runMutation(internal.private.bulkUpsertAccounts, {
          userId: item.userId,
          plaidItemId: args.plaidItemId,
          accounts,
        });

        console.log(`[Plaid Component] Stored ${accounts.length} accounts`);
      }

      // Complete sync log with success
      await ctx.runMutation(internal.private.completeSyncLogSuccess, {
        syncLogId,
        result: {
          accountsUpdated: accounts.length,
        },
      });

      return {
        accountCount: accounts.length,
      };
    } catch (error: unknown) {
      const plaidError = categorizeError(error);
      console.error(
        `[Plaid Component] Accounts error: ${formatErrorForLog(plaidError)}`
      );

      // Complete sync log with error
      await ctx.runMutation(internal.private.completeSyncLogError, {
        syncLogId,
        errorCode: plaidError.code,
        errorMessage: plaidError.message,
      });

      throw error;
    }
  },
});

// =============================================================================
// SYNC TRANSACTIONS
// =============================================================================

/**
 * Sync transactions using cursor-based pagination with optimistic locking.
 *
 * CRITICAL FIX: Uses sync locking to prevent race conditions from concurrent syncs
 * (e.g., webhook + scheduled sync running simultaneously).
 *
 * Flow:
 * 1. Acquire sync lock (prevents concurrent syncs)
 * 2. Decrypt access token from lock result
 * 3. Fetch pages of transactions (with limits to prevent memory explosion)
 * 4. Bulk upsert transactions (added/modified/removed)
 * 5. Complete sync atomically (update cursor with version check)
 *
 * Pagination:
 * - Default: 10 pages max, 5000 transactions max per sync
 * - If hasMore=true, caller should schedule another sync
 *
 * Error Handling:
 * - Lock conflict: Returns immediately without error
 * - Auth error: Marks status as 'needs_reauth'
 * - Other error: Marks status as 'error'
 */
export const syncTransactions = action({
  args: {
    plaidItemId: v.string(),
    maxPages: v.optional(v.number()),
    maxTransactions: v.optional(v.number()),
    ...plaidConfigArgs,
  },
  returns: v.object({
    added: v.number(),
    modified: v.number(),
    removed: v.number(),
    cursor: v.string(),
    hasMore: v.boolean(),
    pagesProcessed: v.number(),
    skipped: v.optional(v.boolean()), // True if sync was skipped due to lock conflict
    skipReason: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<{
    added: number;
    modified: number;
    removed: number;
    cursor: string;
    hasMore: boolean;
    pagesProcessed: number;
    skipped?: boolean;
    skipReason?: string;
  }> => {
    console.log("[Plaid Component] Starting transaction sync...");

    // Step 1: Acquire sync lock (prevents concurrent syncs)
    const lockResult: {
      acquired: boolean;
      reason?: string;
      syncVersion?: number;
      cursor?: string | null;
      accessToken?: string;
      userId?: string;
    } = await ctx.runMutation(internal.private.acquireSyncLock, {
      plaidItemId: args.plaidItemId,
    });

    if (!lockResult.acquired) {
      console.log(
        `[Plaid Component] Sync skipped: ${lockResult.reason}`
      );
      return {
        added: 0,
        modified: 0,
        removed: 0,
        cursor: "",
        hasMore: false,
        pagesProcessed: 0,
        skipped: true,
        skipReason: lockResult.reason,
      };
    }

    // These fields are guaranteed to be present when acquired is true
    const syncVersion = lockResult.syncVersion!;
    const initialCursor = lockResult.cursor;
    const encryptedToken = lockResult.accessToken!;
    const userId = lockResult.userId!;

    console.log(
      `[Plaid Component] Lock acquired (version ${syncVersion}), cursor: ${initialCursor?.substring(0, 20) || "empty"}...`
    );

    // Create sync log entry
    const syncLogId = await ctx.runMutation(internal.private.createSyncLog, {
      plaidItemId: args.plaidItemId,
      userId,
      syncType: "transactions",
      trigger: "manual", // Could be passed as arg in future
    });

    try {
      // Step 2: Decrypt access token
      const accessToken = await decryptToken(encryptedToken, args.encryptionKey);

      const plaidClient = initPlaidClient(
        args.plaidClientId,
        args.plaidSecret,
        args.plaidEnv
      );

      // Step 3: Fetch transaction pages (with limits to prevent memory explosion)
      const syncResult = await syncTransactionsPaginated(
        plaidClient,
        accessToken,
        initialCursor ?? "",
        {
          maxPages: args.maxPages,
          maxTransactions: args.maxTransactions,
        }
      );

      console.log(
        `[Plaid Component] Sync fetched: ${syncResult.added.length} added, ` +
          `${syncResult.modified.length} modified, ${syncResult.removed.length} removed ` +
          `(pages: ${syncResult.pagesProcessed}, hasMore: ${syncResult.hasMore})`
      );

      // Step 4: Transform and store transactions
      const addedData = syncResult.added.map((t) => transformTransaction(t));
      const modifiedData = syncResult.modified.map((t) => transformTransaction(t));
      const removedIds = syncResult.removed.map((t) => t.transaction_id);

      await ctx.runMutation(internal.private.bulkUpsertTransactions, {
        userId,
        plaidItemId: args.plaidItemId,
        added: addedData,
        modified: modifiedData,
        removed: removedIds,
      });

      // Step 5: Complete sync atomically (update cursor with version check)
      const completeResult = await ctx.runMutation(
        internal.private.completeSyncWithVersion,
        {
          plaidItemId: args.plaidItemId,
          syncVersion,
          cursor: syncResult.nextCursor,
        }
      );

      if (!completeResult.success) {
        // Another sync took over while we were processing
        console.warn(
          `[Plaid Component] Sync complete failed: ${completeResult.reason}`
        );
        // Transactions were stored but cursor wasn't updated
        // Next sync will re-process from old cursor (some duplicates but safe)
      } else {
        console.log("[Plaid Component] Sync completed successfully");
      }

      // Complete sync log with success
      await ctx.runMutation(internal.private.completeSyncLogSuccess, {
        syncLogId,
        result: {
          transactionsAdded: syncResult.added.length,
          transactionsModified: syncResult.modified.length,
          transactionsRemoved: syncResult.removed.length,
        },
      });

      return {
        added: syncResult.added.length,
        modified: syncResult.modified.length,
        removed: syncResult.removed.length,
        cursor: syncResult.nextCursor,
        hasMore: syncResult.hasMore,
        pagesProcessed: syncResult.pagesProcessed,
      };
    } catch (error: unknown) {
      const plaidError = categorizeError(error);
      console.error(
        `[Plaid Component] Sync error: ${formatErrorForLog(plaidError)}`
      );

      // Complete sync log with error
      await ctx.runMutation(internal.private.completeSyncLogError, {
        syncLogId,
        errorCode: plaidError.code,
        errorMessage: plaidError.message,
      });

      // Release lock with error status
      await ctx.runMutation(internal.private.releaseSyncLock, {
        plaidItemId: args.plaidItemId,
        syncVersion,
        status: requiresReauth(plaidError) ? "needs_reauth" : "error",
        syncError: plaidError.message,
      });

      throw error;
    }
  },
});

// =============================================================================
// FETCH LIABILITIES
// =============================================================================

/**
 * Fetch and store credit card liability data.
 *
 * Phase 1: Credit cards only.
 *
 * Flow:
 * 1. Get plaidItem and decrypt access token
 * 2. Fetch liabilities from Plaid API
 * 3. Upsert credit card liabilities (APR, balances, payments)
 */
export const fetchLiabilities = action({
  args: {
    plaidItemId: v.string(),
    ...plaidConfigArgs,
  },
  returns: v.object({
    creditCards: v.number(),
    mortgages: v.number(),
    studentLoans: v.number(),
  }),
  handler: async (ctx, args) => {
    // Get plaidItem
    const item = await ctx.runQuery(internal.private.getPlaidItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item) {
      throw new Error(`Plaid item not found: ${args.plaidItemId}`);
    }

    // Decrypt access token
    const accessToken = await decryptToken(item.accessToken, args.encryptionKey);

    // Create sync log entry
    const syncLogId = await ctx.runMutation(internal.private.createSyncLog, {
      plaidItemId: args.plaidItemId,
      userId: item.userId,
      syncType: "liabilities",
      trigger: "manual",
    });

    console.log("[Plaid Component] Fetching liabilities...");

    try {
      const plaidClient = initPlaidClient(
        args.plaidClientId,
        args.plaidSecret,
        args.plaidEnv
      );

      const liabilitiesResponse = await plaidClient.liabilitiesGet({
        access_token: accessToken,
      });

      const creditCards = liabilitiesResponse.data.liabilities?.credit ?? [];
      const mortgages = liabilitiesResponse.data.liabilities?.mortgage ?? [];
      const studentLoans = liabilitiesResponse.data.liabilities?.student ?? [];

      console.log(
        `[Plaid Component] Fetched ${creditCards.length} credit cards, ${mortgages.length} mortgages, ${studentLoans.length} student loans`
      );

      // Bulk upsert credit card liabilities (single mutation instead of N sequential mutations)
      if (creditCards.length > 0) {
        await ctx.runMutation(internal.private.bulkUpsertCreditCardLiabilities, {
          userId: item.userId,
          plaidItemId: args.plaidItemId,
          creditCards: creditCards.map((card) => ({
          accountId: card.account_id ?? "",
          aprs: card.aprs.map((apr) => ({
            aprPercentage: apr.apr_percentage ?? 0,
            aprType: apr.apr_type ?? "",
            balanceSubjectToApr:
              apr.balance_subject_to_apr != null
                ? convertAmountToMilliunits(apr.balance_subject_to_apr)
                : undefined,
            interestChargeAmount:
              apr.interest_charge_amount != null
                ? convertAmountToMilliunits(apr.interest_charge_amount)
                : undefined,
          })),
          isOverdue: card.is_overdue ?? false,
          lastPaymentAmount:
            card.last_payment_amount != null
              ? convertAmountToMilliunits(card.last_payment_amount)
              : undefined,
          lastPaymentDate: card.last_payment_date ?? undefined,
          lastStatementBalance:
            card.last_statement_balance != null
              ? convertAmountToMilliunits(card.last_statement_balance)
              : undefined,
          lastStatementIssueDate: card.last_statement_issue_date ?? undefined,
          minimumPaymentAmount:
            card.minimum_payment_amount != null
              ? convertAmountToMilliunits(card.minimum_payment_amount)
              : undefined,
          nextPaymentDueDate: card.next_payment_due_date ?? undefined,
        })),
        });
      }

      // Bulk upsert mortgage liabilities (single mutation instead of N sequential mutations)
      if (mortgages.length > 0) {
        await ctx.runMutation(internal.private.bulkUpsertMortgageLiabilities, {
          userId: item.userId,
          plaidItemId: args.plaidItemId,
          mortgages: mortgages.map((mortgage) => ({
          accountId: mortgage.account_id ?? "",
          accountNumber: mortgage.account_number ?? undefined,
          loanTerm: mortgage.loan_term ?? undefined,
          loanTypeDescription: mortgage.loan_type_description ?? undefined,
          originationDate: mortgage.origination_date ?? undefined,
          maturityDate: mortgage.maturity_date ?? undefined,
          interestRatePercentage: mortgage.interest_rate?.percentage ?? 0,
          interestRateType: mortgage.interest_rate?.type ?? undefined,
          lastPaymentAmount:
            mortgage.last_payment_amount != null
              ? convertAmountToMilliunits(mortgage.last_payment_amount)
              : undefined,
          lastPaymentDate: mortgage.last_payment_date ?? undefined,
          nextMonthlyPayment:
            mortgage.next_monthly_payment != null
              ? convertAmountToMilliunits(mortgage.next_monthly_payment)
              : undefined,
          nextPaymentDueDate: mortgage.next_payment_due_date ?? undefined,
          originationPrincipalAmount:
            mortgage.origination_principal_amount != null
              ? convertAmountToMilliunits(mortgage.origination_principal_amount)
              : undefined,
          currentLateFee:
            mortgage.current_late_fee != null
              ? convertAmountToMilliunits(mortgage.current_late_fee)
              : undefined,
          escrowBalance:
            mortgage.escrow_balance != null
              ? convertAmountToMilliunits(mortgage.escrow_balance)
              : undefined,
          pastDueAmount:
            mortgage.past_due_amount != null
              ? convertAmountToMilliunits(mortgage.past_due_amount)
              : undefined,
          ytdInterestPaid:
            mortgage.ytd_interest_paid != null
              ? convertAmountToMilliunits(mortgage.ytd_interest_paid)
              : undefined,
          ytdPrincipalPaid:
            mortgage.ytd_principal_paid != null
              ? convertAmountToMilliunits(mortgage.ytd_principal_paid)
              : undefined,
          hasPmi: mortgage.has_pmi ?? undefined,
          hasPrepaymentPenalty: mortgage.has_prepayment_penalty ?? undefined,
          propertyAddress: mortgage.property_address
            ? {
                street: mortgage.property_address.street ?? undefined,
                city: mortgage.property_address.city ?? undefined,
                region: mortgage.property_address.region ?? undefined,
                postalCode: mortgage.property_address.postal_code ?? undefined,
                country: mortgage.property_address.country ?? undefined,
              }
              : undefined,
          })),
        });
      }

      // Bulk upsert student loan liabilities (single mutation instead of N sequential mutations)
      if (studentLoans.length > 0) {
        await ctx.runMutation(internal.private.bulkUpsertStudentLoanLiabilities, {
          userId: item.userId,
          plaidItemId: args.plaidItemId,
          studentLoans: studentLoans.map((loan) => ({
          accountId: loan.account_id ?? "",
          accountNumber: loan.account_number ?? undefined,
          loanName: loan.loan_name ?? undefined,
          guarantor: loan.guarantor ?? undefined,
          sequenceNumber: loan.sequence_number ?? undefined,
          disbursementDates: loan.disbursement_dates ?? undefined,
          originationDate: loan.origination_date ?? undefined,
          expectedPayoffDate: loan.expected_payoff_date ?? undefined,
          lastStatementIssueDate: loan.last_statement_issue_date ?? undefined,
          interestRatePercentage: loan.interest_rate_percentage ?? 0,
          lastPaymentAmount:
            loan.last_payment_amount != null
              ? convertAmountToMilliunits(loan.last_payment_amount)
              : undefined,
          lastPaymentDate: loan.last_payment_date ?? undefined,
          minimumPaymentAmount:
            loan.minimum_payment_amount != null
              ? convertAmountToMilliunits(loan.minimum_payment_amount)
              : undefined,
          nextPaymentDueDate: loan.next_payment_due_date ?? undefined,
          paymentReferenceNumber: loan.payment_reference_number ?? undefined,
          originationPrincipalAmount:
            loan.origination_principal_amount != null
              ? convertAmountToMilliunits(loan.origination_principal_amount)
              : undefined,
          outstandingInterestAmount:
            loan.outstanding_interest_amount != null
              ? convertAmountToMilliunits(loan.outstanding_interest_amount)
              : undefined,
          lastStatementBalance:
            (loan as any).last_statement_balance != null
              ? convertAmountToMilliunits((loan as any).last_statement_balance)
              : undefined,
          ytdInterestPaid:
            loan.ytd_interest_paid != null
              ? convertAmountToMilliunits(loan.ytd_interest_paid)
              : undefined,
          ytdPrincipalPaid:
            loan.ytd_principal_paid != null
              ? convertAmountToMilliunits(loan.ytd_principal_paid)
              : undefined,
          isOverdue: loan.is_overdue ?? undefined,
          loanStatus: loan.loan_status
            ? {
                type: loan.loan_status.type ?? undefined,
                endDate: loan.loan_status.end_date ?? undefined,
              }
            : undefined,
          repaymentPlan: loan.repayment_plan
            ? {
                type: loan.repayment_plan.type ?? undefined,
                description: loan.repayment_plan.description ?? undefined,
              }
            : undefined,
          servicerAddress: loan.servicer_address
            ? {
                street: loan.servicer_address.street ?? undefined,
                city: loan.servicer_address.city ?? undefined,
                region: loan.servicer_address.region ?? undefined,
                postalCode: loan.servicer_address.postal_code ?? undefined,
                country: loan.servicer_address.country ?? undefined,
              }
              : undefined,
          })),
        });
      }

      console.log(
        `[Plaid Component] Stored ${creditCards.length} credit cards, ${mortgages.length} mortgages, ${studentLoans.length} student loans`
      );

      // Complete sync log with success
      await ctx.runMutation(internal.private.completeSyncLogSuccess, {
        syncLogId,
        result: {
          accountsUpdated: creditCards.length + mortgages.length + studentLoans.length,
        },
      });

      return {
        creditCards: creditCards.length,
        mortgages: mortgages.length,
        studentLoans: studentLoans.length,
      };
    } catch (error: unknown) {
      const plaidError = categorizeError(error);
      console.error(
        `[Plaid Component] Liabilities error: ${formatErrorForLog(plaidError)}`
      );

      // Complete sync log with error
      await ctx.runMutation(internal.private.completeSyncLogError, {
        syncLogId,
        errorCode: plaidError.code,
        errorMessage: plaidError.message,
      });

      throw error;
    }
  },
});

// =============================================================================
// FETCH RECURRING STREAMS
// =============================================================================

/**
 * Fetch and store recurring transaction streams from Plaid.
 *
 * Plaid's recurring detection API identifies:
 * - Subscriptions (Netflix, Spotify, etc.)
 * - Regular bills (rent, utilities, etc.)
 * - Recurring income (paychecks, deposits)
 *
 * Flow:
 * 1. Get plaidItem and decrypt access token
 * 2. Fetch recurring streams from Plaid API
 * 3. Transform to component format (with milliunits)
 * 4. Bulk upsert recurring streams
 */
export const fetchRecurringStreams = action({
  args: {
    plaidItemId: v.string(),
    ...plaidConfigArgs,
  },
  returns: v.object({
    inflows: v.number(),
    outflows: v.number(),
  }),
  handler: async (ctx, args) => {
    // Get plaidItem
    const item = await ctx.runQuery(internal.private.getPlaidItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item) {
      throw new Error(`Plaid item not found: ${args.plaidItemId}`);
    }

    // Decrypt access token
    const accessToken = await decryptToken(item.accessToken, args.encryptionKey);

    // Create sync log entry
    const syncLogId = await ctx.runMutation(internal.private.createSyncLog, {
      plaidItemId: args.plaidItemId,
      userId: item.userId,
      syncType: "recurring",
      trigger: "manual",
    });

    console.log("[Plaid Component] Fetching recurring streams...");

    try {
      const plaidClient = initPlaidClient(
        args.plaidClientId,
        args.plaidSecret,
        args.plaidEnv
      );

      const recurringResponse = await plaidClient.transactionsRecurringGet({
        access_token: accessToken,
      });

      const inflowStreams = recurringResponse.data.inflow_streams ?? [];
      const outflowStreams = recurringResponse.data.outflow_streams ?? [];

      console.log(
        `[Plaid Component] Fetched ${inflowStreams.length} inflows, ${outflowStreams.length} outflows`
      );

      // Transform and store inflow streams (income)
      const inflowData = inflowStreams.map((stream) => ({
        streamId: stream.stream_id,
        accountId: stream.account_id,
        description: stream.description,
        merchantName: stream.merchant_name ?? undefined,
        averageAmount: convertAmountToMilliunits(stream.average_amount?.amount ?? 0),
        lastAmount: convertAmountToMilliunits(stream.last_amount?.amount ?? 0),
        isoCurrencyCode: stream.average_amount?.iso_currency_code ?? "USD",
        frequency: stream.frequency,
        status: stream.status as "MATURE" | "EARLY_DETECTION" | "TOMBSTONED",
        isActive: stream.is_active,
        type: "inflow" as const,
        category: stream.personal_finance_category?.primary ?? undefined,
        firstDate: stream.first_date ?? undefined,
        lastDate: stream.last_date ?? undefined,
        predictedNextDate: (stream as any).predicted_next_date ?? undefined,
      }));

      // Transform and store outflow streams (expenses)
      const outflowData = outflowStreams.map((stream) => ({
        streamId: stream.stream_id,
        accountId: stream.account_id,
        description: stream.description,
        merchantName: stream.merchant_name ?? undefined,
        averageAmount: convertAmountToMilliunits(stream.average_amount?.amount ?? 0),
        lastAmount: convertAmountToMilliunits(stream.last_amount?.amount ?? 0),
        isoCurrencyCode: stream.average_amount?.iso_currency_code ?? "USD",
        frequency: stream.frequency,
        status: stream.status as "MATURE" | "EARLY_DETECTION" | "TOMBSTONED",
        isActive: stream.is_active,
        type: "outflow" as const,
        category: stream.personal_finance_category?.primary ?? undefined,
        firstDate: stream.first_date ?? undefined,
        lastDate: stream.last_date ?? undefined,
        predictedNextDate: (stream as any).predicted_next_date ?? undefined,
      }));

      // Bulk upsert all streams
      const allStreams = [...inflowData, ...outflowData];
      if (allStreams.length > 0) {
        await ctx.runMutation(internal.private.bulkUpsertRecurringStreams, {
          userId: item.userId,
          plaidItemId: args.plaidItemId,
          streams: allStreams,
        });

        console.log(`[Plaid Component] Stored ${allStreams.length} recurring streams`);
      }

      // Complete sync log with success
      await ctx.runMutation(internal.private.completeSyncLogSuccess, {
        syncLogId,
        result: {
          streamsUpdated: allStreams.length,
        },
      });

      return {
        inflows: inflowStreams.length,
        outflows: outflowStreams.length,
      };
    } catch (error: unknown) {
      const plaidError = categorizeError(error);
      console.error(
        `[Plaid Component] Recurring streams error: ${formatErrorForLog(plaidError)}`
      );

      // Complete sync log with error
      await ctx.runMutation(internal.private.completeSyncLogError, {
        syncLogId,
        errorCode: plaidError.code,
        errorMessage: plaidError.message,
      });

      throw error;
    }
  },
});

// =============================================================================
// CREATE UPDATE LINK TOKEN (Re-auth)
// =============================================================================

/**
 * Create an update link token for re-authentication.
 *
 * Used when a plaidItem is in 'needs_reauth' status.
 * Opens Plaid Link in update mode instead of creating a new connection.
 *
 * Flow:
 * 1. Get plaidItem and decrypt access token
 * 2. Create link token with access_token (update mode)
 * 3. Return link token for frontend
 */
export const createUpdateLinkToken = action({
  args: {
    plaidItemId: v.string(),
    ...plaidConfigArgs,
  },
  returns: v.object({
    linkToken: v.string(),
  }),
  handler: async (ctx, args) => {
    // Get plaidItem
    const item = await ctx.runQuery(internal.private.getPlaidItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item) {
      throw new Error(`Plaid item not found: ${args.plaidItemId}`);
    }

    // Decrypt access token
    const accessToken = await decryptToken(item.accessToken, args.encryptionKey);

    console.log("[Plaid Component] Creating update link token for re-auth...");

    const plaidClient = initPlaidClient(
      args.plaidClientId,
      args.plaidSecret,
      args.plaidEnv
    );

    // Create link token in update mode (with access_token)
    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: item.userId,
      },
      client_name: "App",
      access_token: accessToken, // This triggers update mode
      country_codes: ["US"] as any[],
      language: "en",
    });

    console.log("[Plaid Component] Update link token created successfully");

    return {
      linkToken: response.data.link_token,
    };
  },
});

// =============================================================================
// COMPLETE RE-AUTH
// =============================================================================

/**
 * Complete re-authentication after user has gone through update Link flow.
 *
 * Unlike initial connection, update flow doesn't return a new public token.
 * We just need to mark the item as active again.
 */
export const completeReauth = action({
  args: {
    plaidItemId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    console.log("[Plaid Component] Completing re-auth...");

    // Mark item as active again
    await ctx.runMutation(internal.private.updateItemStatus, {
      plaidItemId: args.plaidItemId,
      status: "active",
      syncError: undefined,
    });

    console.log("[Plaid Component] Re-auth complete, item marked as active");

    return {
      success: true,
    };
  },
});

// =============================================================================
// ENRICH TRANSACTIONS
// =============================================================================

/**
 * Enrich transactions with merchant data using Plaid Enrich API.
 *
 * Takes a batch of transactions and enriches them with:
 * - Counterparty name, type, and entity ID
 * - Merchant logo URL and website
 * - Confidence level
 *
 * Results are cached in merchantEnrichments table and linked to transactions.
 */
export const enrichTransactions = action({
  args: {
    transactions: v.array(
      v.object({
        id: v.string(),
        description: v.string(),
        amount: v.number(),
        direction: v.union(v.literal("INFLOW"), v.literal("OUTFLOW")),
        iso_currency_code: v.optional(v.string()),
        mcc: v.optional(v.string()),
        location: v.optional(
          v.object({
            city: v.optional(v.string()),
            region: v.optional(v.string()),
            postal_code: v.optional(v.string()),
            country: v.optional(v.string()),
          })
        ),
      })
    ),
    ...plaidConfigArgs,
  },
  returns: v.object({
    enriched: v.number(),
    failed: v.number(),
  }),
  handler: async (ctx, args) => {
    console.log(
      `[Plaid Component] Enriching ${args.transactions.length} transactions...`
    );

    if (args.transactions.length === 0) {
      return { enriched: 0, failed: 0 };
    }

    const plaidClient = initPlaidClient(
      args.plaidClientId,
      args.plaidSecret,
      args.plaidEnv
    );

    // Prepare transactions for Plaid Enrich API
    // Note: amount must be absolute value (>= 0), direction indicates flow
    const enrichmentTransactions = args.transactions.map((tx) => ({
      id: tx.id,
      description: tx.description,
      amount: Math.abs(tx.amount), // Plaid requires positive amounts
      direction: tx.direction,
      iso_currency_code: tx.iso_currency_code ?? "USD",
      mcc: tx.mcc,
      location: tx.location
        ? {
            city: tx.location.city,
            region: tx.location.region,
            postal_code: tx.location.postal_code,
            country: tx.location.country,
          }
        : undefined,
    }));

    try {
      const response = await plaidClient.transactionsEnrich({
        account_type: "depository",
        transactions: enrichmentTransactions as any,
      });

      let enriched = 0;
      let failed = 0;

      // Cast to any since Plaid SDK types may not include all enrichment properties
      for (const enrichedTx of response.data.enriched_transactions as any[]) {
        const counterparty = enrichedTx.counterparties?.[0];

        if (counterparty?.entity_id) {
          // Upsert merchant enrichment
          await ctx.runMutation(internal.private.upsertMerchantEnrichment, {
            merchantId: counterparty.entity_id,
            merchantName: counterparty.name,
            logoUrl: counterparty.logo_url ?? undefined,
            categoryPrimary: enrichedTx.personal_finance_category?.primary,
            categoryDetailed: enrichedTx.personal_finance_category?.detailed,
            categoryIconUrl:
              enrichedTx.personal_finance_category_icon_url ?? undefined,
            website: counterparty.website ?? undefined,
            phoneNumber: counterparty.phone_number ?? undefined,
            confidenceLevel:
              (counterparty.confidence_level as
                | "VERY_HIGH"
                | "HIGH"
                | "MEDIUM"
                | "LOW"
                | "UNKNOWN") ?? "UNKNOWN",
          });

          // Update transaction with enrichment data
          await ctx.runMutation(internal.private.updateTransactionEnrichment, {
            transactionId: enrichedTx.id,
            merchantId: counterparty.entity_id,
            enrichmentData: {
              counterpartyName: counterparty.name,
              counterpartyType: counterparty.type,
              counterpartyEntityId: counterparty.entity_id,
              counterpartyConfidence: counterparty.confidence_level,
              counterpartyLogoUrl: counterparty.logo_url ?? undefined,
              counterpartyWebsite: counterparty.website ?? undefined,
              counterpartyPhoneNumber: counterparty.phone_number ?? undefined,
              enrichedAt: Date.now(),
            },
          });

          enriched++;
        } else {
          failed++;
        }
      }

      console.log(
        `[Plaid Component] Enriched ${enriched} transactions, ${failed} failed`
      );

      return { enriched, failed };
    } catch (error: any) {
      console.error(
        "[Plaid Component] Transaction enrichment failed:",
        formatErrorForLog(error)
      );
      throw error;
    }
  },
});

// =============================================================================
// TRIGGER TRANSACTIONS REFRESH
// =============================================================================

/**
 * Trigger a transactions refresh for a Plaid item.
 *
 * Forces Plaid to fetch the latest transactions from the financial institution.
 * This is useful when you need up-to-date data without waiting for webhooks.
 *
 * Note: Some institutions (e.g., Capital One) don't support this endpoint
 * and will return PRODUCTS_NOT_SUPPORTED.
 */
export const triggerTransactionsRefresh = action({
  args: {
    plaidItemId: v.string(),
    ...plaidConfigArgs,
  },
  returns: v.object({
    success: v.boolean(),
    requestId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    console.log(
      "[Plaid Component] Triggering transactions refresh for item:",
      args.plaidItemId
    );

    // Get item to retrieve encrypted access token
    const item = await ctx.runQuery(internal.private.getPlaidItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item) {
      console.error("[Plaid Component] Item not found:", args.plaidItemId);
      return {
        success: false,
        error: "Item not found",
      };
    }

    // Decrypt access token
    const accessToken = await decryptToken(item.accessToken, args.encryptionKey);

    const plaidClient = initPlaidClient(
      args.plaidClientId,
      args.plaidSecret,
      args.plaidEnv
    );

    try {
      const response = await plaidClient.transactionsRefresh({
        access_token: accessToken,
      });

      console.log(
        "[Plaid Component] Transactions refresh triggered successfully:",
        response.data.request_id
      );

      return {
        success: true,
        requestId: response.data.request_id,
      };
    } catch (error: any) {
      const errorType = error?.response?.data?.error_type;
      const errorCode = error?.response?.data?.error_code;

      // Handle PRODUCTS_NOT_SUPPORTED gracefully (some institutions don't support refresh)
      if (
        errorCode === "PRODUCTS_NOT_SUPPORTED" ||
        errorType === "PRODUCTS_NOT_SUPPORTED"
      ) {
        console.warn(
          "[Plaid Component] Transactions refresh not supported for this institution"
        );
        return {
          success: false,
          error: "PRODUCTS_NOT_SUPPORTED",
        };
      }

      // Handle rate limiting
      if (errorCode === "RATE_LIMIT_EXCEEDED") {
        console.warn("[Plaid Component] Rate limit exceeded for refresh");
        return {
          success: false,
          error: "RATE_LIMIT_EXCEEDED",
        };
      }

      // Check if re-auth is needed
      if (requiresReauth(error)) {
        await ctx.runMutation(internal.private.updateItemStatus, {
          plaidItemId: args.plaidItemId,
          status: "needs_reauth",
          syncError: "Re-authentication required",
        });

        return {
          success: false,
          error: "REQUIRES_REAUTH",
        };
      }

      console.error(
        "[Plaid Component] Transactions refresh failed:",
        formatErrorForLog(error)
      );

      return {
        success: false,
        error: errorCode ?? "UNKNOWN_ERROR",
      };
    }
  },
});
