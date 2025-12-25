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
    ...plaidConfigArgs,
  },
  returns: v.object({
    success: v.boolean(),
    itemId: v.string(),
    plaidItemId: v.string(),
  }),
  handler: async (ctx, args) => {
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

    // Fetch institution name if available
    let institutionName: string | undefined;
    if (institutionId) {
      try {
        const instResponse = await plaidClient.institutionsGetById({
          institution_id: institutionId,
          country_codes: ["US"] as any[],
        });
        institutionName = instResponse.data.institution.name;
        console.log("[Plaid Component] Institution:", institutionName);
      } catch (e) {
        console.warn("[Plaid Component] Failed to fetch institution name:", e);
      }
    }

    // Encrypt access token before storage
    console.log("[Plaid Component] Encrypting access token...");
    const encryptedToken = await encryptToken(accessToken, args.encryptionKey);

    // Create plaidItem in component database
    const plaidItemId = await ctx.runMutation(internal.private.createPlaidItem, {
      userId: args.userId,
      itemId,
      accessToken: encryptedToken,
      institutionId,
      institutionName,
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

    console.log("[Plaid Component] Fetching accounts...");

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

    return {
      accountCount: accounts.length,
    };
  },
});

// =============================================================================
// SYNC TRANSACTIONS
// =============================================================================

/**
 * Sync transactions using cursor-based pagination.
 *
 * Flow:
 * 1. Get plaidItem and decrypt access token
 * 2. Mark plaidItem as 'syncing'
 * 3. Fetch all pages of transactions (accumulate)
 * 4. Bulk upsert transactions (added/modified/removed)
 * 5. Update cursor and mark as 'active'
 *
 * Error Handling:
 * - On auth error: Marks status as 'needs_reauth'
 * - On other error: Marks status as 'error'
 */
export const syncTransactions = action({
  args: {
    plaidItemId: v.string(),
    ...plaidConfigArgs,
  },
  returns: v.object({
    added: v.number(),
    modified: v.number(),
    removed: v.number(),
    cursor: v.string(),
  }),
  handler: async (ctx, args) => {
    // Get plaidItem
    const item = await ctx.runQuery(internal.private.getPlaidItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item) {
      throw new Error(`Plaid item not found: ${args.plaidItemId}`);
    }

    const userId = item.userId;
    const initialCursor = item.cursor ?? "";

    // Decrypt access token
    const accessToken = await decryptToken(item.accessToken, args.encryptionKey);

    // Mark as syncing
    await ctx.runMutation(internal.private.updateItemStatus, {
      plaidItemId: args.plaidItemId,
      status: "syncing",
    });

    console.log("[Plaid Component] Starting transaction sync...");
    console.log(
      `[Plaid Component] Initial cursor: ${initialCursor?.substring(0, 20) || "empty"}...`
    );

    try {
      const plaidClient = initPlaidClient(
        args.plaidClientId,
        args.plaidSecret,
        args.plaidEnv
      );

      // Fetch all transaction pages
      const syncResult = await syncTransactionsPaginated(
        plaidClient,
        accessToken,
        initialCursor
      );

      console.log(
        `[Plaid Component] Sync complete: ${syncResult.added.length} added, ` +
          `${syncResult.modified.length} modified, ${syncResult.removed.length} removed`
      );

      // Transform transactions
      const addedData = syncResult.added.map((t) => transformTransaction(t));
      const modifiedData = syncResult.modified.map((t) => transformTransaction(t));
      const removedIds = syncResult.removed.map((t) => t.transaction_id);

      // Bulk upsert transactions
      await ctx.runMutation(internal.private.bulkUpsertTransactions, {
        userId,
        plaidItemId: args.plaidItemId,
        added: addedData,
        modified: modifiedData,
        removed: removedIds,
      });

      // Update cursor and mark as active (CRITICAL: only after all pages stored)
      await ctx.runMutation(internal.private.updateItemCursor, {
        plaidItemId: args.plaidItemId,
        cursor: syncResult.nextCursor,
      });

      console.log("[Plaid Component] Updated cursor and marked as active");

      return {
        added: syncResult.added.length,
        modified: syncResult.modified.length,
        removed: syncResult.removed.length,
        cursor: syncResult.nextCursor,
      };
    } catch (error: unknown) {
      const plaidError = categorizeError(error);
      console.error(
        `[Plaid Component] Sync error: ${formatErrorForLog(plaidError)}`
      );

      // Update status based on error type
      await ctx.runMutation(internal.private.updateItemStatus, {
        plaidItemId: args.plaidItemId,
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

    console.log("[Plaid Component] Fetching liabilities...");

    const plaidClient = initPlaidClient(
      args.plaidClientId,
      args.plaidSecret,
      args.plaidEnv
    );

    const liabilitiesResponse = await plaidClient.liabilitiesGet({
      access_token: accessToken,
    });

    const creditCards = liabilitiesResponse.data.liabilities?.credit ?? [];

    console.log(`[Plaid Component] Fetched ${creditCards.length} credit cards`);

    // Upsert credit card liabilities
    for (const card of creditCards) {
      await ctx.runMutation(internal.private.upsertCreditCardLiability, {
        userId: item.userId,
        plaidItemId: args.plaidItemId,
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
      });
    }

    console.log(`[Plaid Component] Stored ${creditCards.length} credit card liabilities`);

    return {
      creditCards: creditCards.length,
    };
  },
});
