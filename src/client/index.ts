/**
 * Plaid Component Client
 *
 * Main client class for the Plaid component.
 * Provides methods for Plaid Link, account syncing, transactions, and liabilities.
 *
 * IMPORTANT: Components cannot access process.env.
 * All configuration must be provided via PlaidConfig.
 */

import { httpActionGeneric } from "convex/server";
import type {
  ActionCtx,
  PlaidConfig,
  HttpRouter,
  RegisterRoutesConfig,
  CreateLinkTokenResult,
  ExchangePublicTokenResult,
  FetchAccountsResult,
  SyncTransactionsResult,
  SyncTransactionsOptions,
  FetchLiabilitiesResult,
  OnboardItemResult,
  FetchRecurringStreamsResult,
  CreateUpdateLinkTokenResult,
  CompleteReauthResult,
  TriggerTransactionsRefreshResult,
  EnrichTransactionsResult,
  SyncType,
  SyncTrigger,
  SyncStatus,
  SyncResult,
  SyncStats,
  InstitutionMetadata,
  PlaidAccount,
  PlaidItem,
  PlaidItemStatus,
  CircuitState,
  UserIdentity,
  AuthenticatedContext,
  SecureWrapper,
} from "./types.js";
import {
  verifyPlaidWebhook,
  parseWebhookPayload,
  isTransactionSyncWebhook,
  isItemErrorWebhook,
  isPendingExpirationWebhook,
  isUserPermissionRevokedWebhook,
  isLiabilitiesUpdateWebhook,
} from "../component/webhooks.js";
import type { ComponentApi } from "../component/_generated/component.js";

// =============================================================================
// CONFIG VALIDATION
// =============================================================================

/**
 * Error thrown when Plaid configuration is invalid.
 */
export class PlaidConfigError extends Error {
  constructor(message: string) {
    super(`[Plaid Config] ${message}`);
    this.name = "PlaidConfigError";
  }
}

/**
 * Valid Plaid environment values.
 */
const VALID_PLAID_ENVS = ["sandbox", "development", "production"] as const;

/**
 * Validate Plaid configuration.
 * @throws PlaidConfigError if config is invalid
 */
function validatePlaidConfig(config: PlaidConfig): void {
  // Check required fields exist and are non-empty strings
  const requiredFields: (keyof PlaidConfig)[] = [
    "PLAID_CLIENT_ID",
    "PLAID_SECRET",
    "PLAID_ENV",
    "ENCRYPTION_KEY",
  ];

  for (const field of requiredFields) {
    const value = config[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new PlaidConfigError(
        `${field} is required and must be a non-empty string`
      );
    }
  }

  // Validate PLAID_ENV
  if (!VALID_PLAID_ENVS.includes(config.PLAID_ENV as typeof VALID_PLAID_ENVS[number])) {
    throw new PlaidConfigError(
      `PLAID_ENV must be one of: ${VALID_PLAID_ENVS.join(", ")}. Got: "${config.PLAID_ENV}"`
    );
  }

  // Validate ENCRYPTION_KEY is valid base64 and correct length
  try {
    // Handle both Node.js Buffer and browser atob
    let decoded: Uint8Array;
    if (typeof Buffer !== "undefined") {
      decoded = Buffer.from(config.ENCRYPTION_KEY, "base64");
    } else {
      const binaryString = atob(config.ENCRYPTION_KEY);
      decoded = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        decoded[i] = binaryString.charCodeAt(i);
      }
    }

    if (decoded.length !== 32) {
      throw new PlaidConfigError(
        `ENCRYPTION_KEY must be a base64-encoded 256-bit (32 byte) key. Got ${decoded.length} bytes.`
      );
    }
  } catch (e) {
    if (e instanceof PlaidConfigError) throw e;
    throw new PlaidConfigError(
      `ENCRYPTION_KEY is not valid base64: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

/**
 * Type for the Plaid component API used by the Plaid client class.
 * Uses Pick to only require the parts actually used by the Plaid client.
 * This allows host apps to use the component without needing access to private internals.
 *
 * NOTE: registerRoutes() needs the full ComponentApi including private functions
 * for webhook handling.
 */
export type PlaidComponent = Pick<ComponentApi, "actions" | "public">;

/**
 * Full component API type for use with registerRoutes().
 * Re-exported for convenience.
 */
export type { ComponentApi };

export type {
  PlaidConfig,
  RegisterRoutesConfig,
  CreateLinkTokenResult,
  ExchangePublicTokenResult,
  FetchAccountsResult,
  SyncTransactionsResult,
  SyncTransactionsOptions,
  FetchLiabilitiesResult,
  OnboardItemResult,
  FetchRecurringStreamsResult,
  CreateUpdateLinkTokenResult,
  CompleteReauthResult,
  TriggerTransactionsRefreshResult,
  EnrichTransactionsResult,
  ActionCtx,
  // Sync log types
  SyncType,
  SyncTrigger,
  SyncStatus,
  SyncResult,
  SyncStats,
  // Institution types
  InstitutionMetadata,
  // Account types
  PlaidAccount,
  // PlaidItem types
  PlaidItem,
  PlaidItemStatus,
  CircuitState,
  // Authentication types
  UserIdentity,
  AuthenticatedContext,
  SecureWrapper,
};

// =============================================================================
// PLAID CLIENT CLASS
// =============================================================================

/**
 * Plaid Component Client
 *
 * Provides methods for managing Plaid Link, accounts, transactions,
 * and liabilities through Convex.
 *
 * @example
 * ```typescript
 * // In your convex/plaid.ts
 * import { Plaid } from "@crowdevelopment/convex-plaid";
 * import { components } from "./_generated/api";
 *
 * const plaid = new Plaid(components.plaid, {
 *   PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID!,
 *   PLAID_SECRET: process.env.PLAID_SECRET!,
 *   PLAID_ENV: process.env.PLAID_ENV!,
 *   ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
 * });
 *
 * export const createLinkToken = action({
 *   args: { userId: v.string() },
 *   handler: async (ctx, args) => {
 *     return await plaid.createLinkToken(ctx, args);
 *   },
 * });
 * ```
 */
export class Plaid {
  private config: PlaidConfig;

  constructor(
    public component: PlaidComponent,
    config: PlaidConfig
  ) {
    validatePlaidConfig(config);
    this.config = config;
  }

  // ===========================================================================
  // LINK FLOW
  // ===========================================================================

  /**
   * Create a link token for Plaid Link UI initialization.
   *
   * Link tokens are short-lived (30 minutes) and frontend-only.
   * Call this before opening the Plaid Link modal.
   */
  async createLinkToken(
    ctx: ActionCtx,
    args: {
      userId: string;
      products?: string[];
      countryCodes?: string[];
      language?: string;
      clientName?: string;
      webhookUrl?: string;
    }
  ): Promise<CreateLinkTokenResult> {
    return await ctx.runAction(this.component.actions.createLinkToken, {
      userId: args.userId,
      products: args.products,
      countryCodes: args.countryCodes,
      language: args.language,
      clientName: args.clientName,
      webhookUrl: args.webhookUrl,
      plaidClientId: this.config.PLAID_CLIENT_ID,
      plaidSecret: this.config.PLAID_SECRET,
      plaidEnv: this.config.PLAID_ENV,
    });
  }

  /**
   * Exchange Plaid public token for access token and create plaidItem.
   *
   * Flow:
   * 1. Exchange public token with Plaid
   * 2. Encrypt access token
   * 3. Create plaidItem in component database
   *
   * NOTE: Access token is NOT returned for security.
   */
  async exchangePublicToken(
    ctx: ActionCtx,
    args: {
      publicToken: string;
      userId: string;
    }
  ): Promise<ExchangePublicTokenResult> {
    return await ctx.runAction(this.component.actions.exchangePublicToken, {
      publicToken: args.publicToken,
      userId: args.userId,
      plaidClientId: this.config.PLAID_CLIENT_ID,
      plaidSecret: this.config.PLAID_SECRET,
      plaidEnv: this.config.PLAID_ENV,
      encryptionKey: this.config.ENCRYPTION_KEY,
    });
  }

  // ===========================================================================
  // SYNC OPERATIONS
  // ===========================================================================

  /**
   * Fetch and store account data from Plaid.
   *
   * @param plaidItemId - Convex document ID of the plaidItem (as string)
   */
  async fetchAccounts(
    ctx: ActionCtx,
    args: {
      plaidItemId: string;
    }
  ): Promise<FetchAccountsResult> {
    return await ctx.runAction(this.component.actions.fetchAccounts, {
      plaidItemId: args.plaidItemId,
      plaidClientId: this.config.PLAID_CLIENT_ID,
      plaidSecret: this.config.PLAID_SECRET,
      plaidEnv: this.config.PLAID_ENV,
      encryptionKey: this.config.ENCRYPTION_KEY,
    });
  }

  /**
   * Sync transactions using cursor-based pagination with race condition protection.
   *
   * Features:
   * - Optimistic locking prevents concurrent syncs from causing duplicates
   * - Pagination limits prevent memory explosion on large syncs
   * - If hasMore=true, caller should schedule another sync
   *
   * @param plaidItemId - Convex document ID of the plaidItem (as string)
   * @param options - Optional pagination limits (maxPages, maxTransactions)
   */
  async syncTransactions(
    ctx: ActionCtx,
    args: {
      plaidItemId: string;
    } & SyncTransactionsOptions
  ): Promise<SyncTransactionsResult> {
    // Cast to any since generated types may not include new args yet
    const actions = this.component.actions as any;
    const result = await ctx.runAction(actions.syncTransactions, {
      plaidItemId: args.plaidItemId,
      maxPages: args.maxPages,
      maxTransactions: args.maxTransactions,
      plaidClientId: this.config.PLAID_CLIENT_ID,
      plaidSecret: this.config.PLAID_SECRET,
      plaidEnv: this.config.PLAID_ENV,
      encryptionKey: this.config.ENCRYPTION_KEY,
    });
    return result as SyncTransactionsResult;
  }

  /**
   * Fetch and store liability data (credit cards, mortgages, student loans).
   *
   * @param plaidItemId - Convex document ID of the plaidItem (as string)
   */
  async fetchLiabilities(
    ctx: ActionCtx,
    args: {
      plaidItemId: string;
    }
  ): Promise<FetchLiabilitiesResult> {
    // Cast to any to handle generated types not being updated yet
    const result = await ctx.runAction(this.component.actions.fetchLiabilities, {
      plaidItemId: args.plaidItemId,
      plaidClientId: this.config.PLAID_CLIENT_ID,
      plaidSecret: this.config.PLAID_SECRET,
      plaidEnv: this.config.PLAID_ENV,
      encryptionKey: this.config.ENCRYPTION_KEY,
    });
    return result as FetchLiabilitiesResult;
  }

  /**
   * Trigger a transactions refresh for a Plaid item.
   *
   * Forces Plaid to fetch the latest transactions from the financial institution.
   * This is useful when you need up-to-date data without waiting for webhooks.
   *
   * Note: Some institutions (e.g., Capital One) don't support this endpoint
   * and will return PRODUCTS_NOT_SUPPORTED.
   *
   * @param plaidItemId - Convex document ID of the plaidItem (as string)
   */
  async triggerTransactionsRefresh(
    ctx: ActionCtx,
    args: {
      plaidItemId: string;
    }
  ): Promise<TriggerTransactionsRefreshResult> {
    // Cast to any since generated types may not include this action yet
    const actions = this.component.actions as any;
    return await ctx.runAction(actions.triggerTransactionsRefresh, {
      plaidItemId: args.plaidItemId,
      plaidClientId: this.config.PLAID_CLIENT_ID,
      plaidSecret: this.config.PLAID_SECRET,
      plaidEnv: this.config.PLAID_ENV,
      encryptionKey: this.config.ENCRYPTION_KEY,
    });
  }

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
  async enrichTransactions(
    ctx: ActionCtx,
    args: {
      transactions: Array<{
        id: string;
        description: string;
        amount: number;
        direction: "INFLOW" | "OUTFLOW";
        iso_currency_code?: string;
        mcc?: string;
        location?: {
          city?: string;
          region?: string;
          postal_code?: string;
          country?: string;
        };
      }>;
    }
  ): Promise<EnrichTransactionsResult> {
    // Cast to any since generated types may not include this action yet
    const actions = this.component.actions as any;
    return await ctx.runAction(actions.enrichTransactions, {
      transactions: args.transactions,
      plaidClientId: this.config.PLAID_CLIENT_ID,
      plaidSecret: this.config.PLAID_SECRET,
      plaidEnv: this.config.PLAID_ENV,
      encryptionKey: this.config.ENCRYPTION_KEY,
    });
  }

  /**
   * Fetch and store recurring transaction streams.
   *
   * Identifies subscriptions, regular bills, and recurring income.
   *
   * @param plaidItemId - Convex document ID of the plaidItem (as string)
   */
  async fetchRecurringStreams(
    ctx: ActionCtx,
    args: {
      plaidItemId: string;
    }
  ): Promise<FetchRecurringStreamsResult> {
    return await ctx.runAction(this.component.actions.fetchRecurringStreams, {
      plaidItemId: args.plaidItemId,
      plaidClientId: this.config.PLAID_CLIENT_ID,
      plaidSecret: this.config.PLAID_SECRET,
      plaidEnv: this.config.PLAID_ENV,
      encryptionKey: this.config.ENCRYPTION_KEY,
    });
  }

  // ===========================================================================
  // RE-AUTH FLOW
  // ===========================================================================

  /**
   * Create an update link token for re-authentication.
   *
   * Use this when a plaidItem is in 'needs_reauth' status.
   * Opens Plaid Link in update mode instead of creating a new connection.
   *
   * @param plaidItemId - Convex document ID of the plaidItem (as string)
   */
  async createUpdateLinkToken(
    ctx: ActionCtx,
    args: {
      plaidItemId: string;
    }
  ): Promise<CreateUpdateLinkTokenResult> {
    return await ctx.runAction(this.component.actions.createUpdateLinkToken, {
      plaidItemId: args.plaidItemId,
      plaidClientId: this.config.PLAID_CLIENT_ID,
      plaidSecret: this.config.PLAID_SECRET,
      plaidEnv: this.config.PLAID_ENV,
      encryptionKey: this.config.ENCRYPTION_KEY,
    });
  }

  /**
   * Complete re-authentication after user has gone through update Link flow.
   *
   * Unlike initial connection, update flow doesn't return a new public token.
   * This marks the item as active again.
   *
   * @param plaidItemId - Convex document ID of the plaidItem (as string)
   */
  async completeReauth(
    ctx: ActionCtx,
    args: {
      plaidItemId: string;
    }
  ): Promise<CompleteReauthResult> {
    return await ctx.runAction(this.component.actions.completeReauth, {
      plaidItemId: args.plaidItemId,
    });
  }

  // ===========================================================================
  // CONVENIENCE METHODS
  // ===========================================================================

  /**
   * Onboard a new Plaid item by fetching all data.
   *
   * Convenience method that runs all sync operations:
   * 1. Fetch accounts
   * 2. Sync transactions
   * 3. Fetch liabilities
   * 4. Fetch recurring streams
   *
   * Call this after exchangePublicToken completes.
   *
   * @param plaidItemId - Convex document ID from exchangePublicToken
   */
  async onboardItem(
    ctx: ActionCtx,
    args: {
      plaidItemId: string;
    }
  ): Promise<OnboardItemResult> {
    // Run all sync operations sequentially
    const accounts = await this.fetchAccounts(ctx, args);
    const transactions = await this.syncTransactions(ctx, args);
    const liabilities = await this.fetchLiabilities(ctx, args);

    // Also fetch recurring streams (Phase 2)
    // This may fail for some accounts, so we capture success/failure
    let recurringStreams: FetchRecurringStreamsResult | undefined;
    let recurringStreamsError: string | undefined;

    try {
      recurringStreams = await this.fetchRecurringStreams(ctx, args);
    } catch (e) {
      // Recurring streams may not be available for all accounts
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.warn("[Plaid Component] Failed to fetch recurring streams:", errorMessage);
      recurringStreamsError = errorMessage;
    }

    const result: OnboardItemResult = {
      accounts,
      transactions,
      liabilities,
    };

    // Add optional fields only if they have values
    if (recurringStreams) {
      result.recurringStreams = recurringStreams;
    }

    if (recurringStreamsError) {
      result.errors = {
        recurringStreams: recurringStreamsError,
      };
    }

    return result;
  }

  // ===========================================================================
  // QUERY HELPERS
  // ===========================================================================

  /**
   * Get the public queries/mutations API for use in query/mutation handlers.
   *
   * @example
   * ```typescript
   * // In a query handler
   * const items = await ctx.runQuery(plaid.api.getItemsByUser, { userId });
   * ```
   */
  get api() {
    return this.component.public;
  }
}

// =============================================================================
// WEBHOOK REGISTRATION (Full Implementation)
// =============================================================================

/**
 * Register Plaid webhook routes with the HTTP router.
 *
 * Handles:
 * - JWT signature verification (when plaidConfig provided)
 * - Auto-sync triggers for SYNC_UPDATES_AVAILABLE
 * - Item status updates for errors and re-auth
 * - Liabilities sync triggers
 *
 * @param http - The HTTP router instance
 * @param component - The Plaid component API
 * @param config - Configuration including plaidConfig for verification and sync
 *
 * @example
 * ```typescript
 * // convex/http.ts
 * import { httpRouter } from "convex/server";
 * import { registerRoutes } from "@crowdevelopment/convex-plaid";
 * import { components } from "./_generated/api";
 *
 * const http = httpRouter();
 *
 * registerRoutes(http, components.plaid, {
 *   webhookPath: "/plaid/webhook",
 *   plaidConfig: {
 *     PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID!,
 *     PLAID_SECRET: process.env.PLAID_SECRET!,
 *     PLAID_ENV: process.env.PLAID_ENV!,
 *     ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
 *   },
 * });
 *
 * export default http;
 * ```
 */
export function registerRoutes(
  http: HttpRouter,
  component: ComponentApi,
  config?: RegisterRoutesConfig
) {
  const webhookPath = config?.webhookPath ?? "/plaid/webhook";

  http.route({
    path: webhookPath,
    method: "POST",
    handler: httpActionGeneric(async (ctx, req) => {
      // Get raw body for signature verification
      const rawBody = await req.text();

      // Step 1: Verify webhook signature (if plaidConfig provided)
      const signedJwt = req.headers.get("plaid-verification");
      if (config?.plaidConfig && signedJwt) {
        const verification = await verifyPlaidWebhook(signedJwt, rawBody, {
          plaidClientId: config.plaidConfig.PLAID_CLIENT_ID,
          plaidSecret: config.plaidConfig.PLAID_SECRET,
          plaidEnv: config.plaidConfig.PLAID_ENV,
        });

        if (!verification.isValid) {
          console.error(
            `[Plaid Webhook] Signature verification failed: ${verification.error}`
          );
          return new Response(
            JSON.stringify({ error: "Invalid signature" }),
            { status: 401, headers: { "Content-Type": "application/json" } }
          );
        }

        console.log("[Plaid Webhook] Signature verified successfully");
      }

      // Step 2: Parse webhook payload
      let payload;
      try {
        payload = parseWebhookPayload(rawBody);
      } catch (e) {
        console.error("[Plaid Webhook] Failed to parse payload:", e);
        return new Response(
          JSON.stringify({ error: "Invalid payload" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const { webhook_type, webhook_code, item_id, error: plaidError } = payload;

      console.log("[Plaid Webhook] Received:", {
        webhook_type,
        webhook_code,
        item_id,
      });

      // Cast component to access private functions (internal functions are not exposed in ComponentApi type)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componentInternal = component as any;

      // Step 3: Look up the plaidItem by Plaid's item_id
      const plaidItem = await ctx.runQuery(
        componentInternal.private.getPlaidItemByItemId,
        { itemId: item_id }
      );

      if (!plaidItem) {
        console.warn(`[Plaid Webhook] No plaidItem found for item_id: ${item_id}`);
        // Still return 200 to prevent Plaid from retrying
        return new Response(
          JSON.stringify({ received: true, warning: "Item not found" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      const plaidItemId = String(plaidItem._id);

      // Step 4: Handle webhook by type
      if (isTransactionSyncWebhook(webhook_type, webhook_code)) {
        console.log(
          `[Plaid Webhook] Transaction updates available for item: ${item_id}`
        );

        // Auto-trigger sync if plaidConfig provided
        if (config?.plaidConfig) {
          try {
            await ctx.runAction(component.actions.syncTransactions, {
              plaidItemId,
              plaidClientId: config.plaidConfig.PLAID_CLIENT_ID,
              plaidSecret: config.plaidConfig.PLAID_SECRET,
              plaidEnv: config.plaidConfig.PLAID_ENV,
              encryptionKey: config.plaidConfig.ENCRYPTION_KEY,
            });
            console.log(`[Plaid Webhook] Auto-sync triggered for item: ${item_id}`);
          } catch (e) {
            console.error(`[Plaid Webhook] Auto-sync failed for item ${item_id}:`, e);
          }
        }
      } else if (isItemErrorWebhook(webhook_type, webhook_code)) {
        const errorCode = plaidError?.error_code ?? "UNKNOWN";
        const errorMessage = plaidError?.error_message ?? "Unknown error";

        console.error(
          `[Plaid Webhook] Item error for ${item_id}: ${errorCode} - ${errorMessage}`
        );

        // Update item status to error
        await ctx.runMutation(componentInternal.private.setItemError, {
          itemId: item_id,
          errorCode,
          errorMessage,
        });
      } else if (isPendingExpirationWebhook(webhook_type, webhook_code)) {
        console.log(
          `[Plaid Webhook] Item ${item_id} access token expiring soon`
        );

        // Mark item as needing re-auth
        await ctx.runMutation(componentInternal.private.markNeedsReauth, {
          itemId: item_id,
          reason: "Access token expiring - user must re-authenticate",
        });
      } else if (isUserPermissionRevokedWebhook(webhook_type, webhook_code)) {
        console.log(`[Plaid Webhook] User revoked permission for item: ${item_id}`);

        // Deactivate the item
        await ctx.runMutation(componentInternal.private.deactivateItem, {
          itemId: item_id,
          reason: "User revoked permission",
        });
      } else if (isLiabilitiesUpdateWebhook(webhook_type, webhook_code)) {
        console.log(
          `[Plaid Webhook] Liability updates available for item: ${item_id}`
        );

        // Auto-trigger liabilities fetch if plaidConfig provided
        if (config?.plaidConfig) {
          try {
            await ctx.runAction(component.actions.fetchLiabilities, {
              plaidItemId,
              plaidClientId: config.plaidConfig.PLAID_CLIENT_ID,
              plaidSecret: config.plaidConfig.PLAID_SECRET,
              plaidEnv: config.plaidConfig.PLAID_ENV,
              encryptionKey: config.plaidConfig.ENCRYPTION_KEY,
            });
            console.log(`[Plaid Webhook] Auto-liabilities fetch for item: ${item_id}`);
          } catch (e) {
            console.error(`[Plaid Webhook] Auto-liabilities failed for ${item_id}:`, e);
          }
        }
      } else {
        console.log(
          `[Plaid Webhook] Unhandled webhook: ${webhook_type}.${webhook_code}`
        );
      }

      // Step 5: Call custom handler if provided
      if (config?.onWebhook) {
        try {
          await config.onWebhook(
            ctx as any,
            webhook_type as any,
            webhook_code,
            item_id,
            payload
          );
        } catch (e) {
          console.error("[Plaid Webhook] Custom handler error:", e);
        }
      }

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  });
}

// =============================================================================
// DEFAULT EXPORT
// =============================================================================

export default Plaid;
