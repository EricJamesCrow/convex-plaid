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
  FetchLiabilitiesResult,
  OnboardItemResult,
} from "./types.js";
import type { ComponentApi } from "../component/_generated/component.js";

// =============================================================================
// EXPORTS
// =============================================================================

export type PlaidComponent = ComponentApi;

export type {
  PlaidConfig,
  RegisterRoutesConfig,
  CreateLinkTokenResult,
  ExchangePublicTokenResult,
  FetchAccountsResult,
  SyncTransactionsResult,
  FetchLiabilitiesResult,
  OnboardItemResult,
  ActionCtx,
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
 * import { Plaid } from "@smartpockets/convex-plaid";
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
   * Sync transactions using cursor-based pagination.
   *
   * Handles added, modified, and removed transactions.
   * Updates cursor only after successful storage.
   *
   * @param plaidItemId - Convex document ID of the plaidItem (as string)
   */
  async syncTransactions(
    ctx: ActionCtx,
    args: {
      plaidItemId: string;
    }
  ): Promise<SyncTransactionsResult> {
    return await ctx.runAction(this.component.actions.syncTransactions, {
      plaidItemId: args.plaidItemId,
      plaidClientId: this.config.PLAID_CLIENT_ID,
      plaidSecret: this.config.PLAID_SECRET,
      plaidEnv: this.config.PLAID_ENV,
      encryptionKey: this.config.ENCRYPTION_KEY,
    });
  }

  /**
   * Fetch and store credit card liability data.
   *
   * Phase 1: Credit cards only.
   *
   * @param plaidItemId - Convex document ID of the plaidItem (as string)
   */
  async fetchLiabilities(
    ctx: ActionCtx,
    args: {
      plaidItemId: string;
    }
  ): Promise<FetchLiabilitiesResult> {
    return await ctx.runAction(this.component.actions.fetchLiabilities, {
      plaidItemId: args.plaidItemId,
      plaidClientId: this.config.PLAID_CLIENT_ID,
      plaidSecret: this.config.PLAID_SECRET,
      plaidEnv: this.config.PLAID_ENV,
      encryptionKey: this.config.ENCRYPTION_KEY,
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

    return {
      accounts,
      transactions,
      liabilities,
    };
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
// WEBHOOK REGISTRATION (Phase 1 Stub)
// =============================================================================

/**
 * Register Plaid webhook routes with the HTTP router.
 *
 * Phase 1: Basic stub that logs incoming webhooks.
 * Phase 2 will add signature verification and full event processing.
 *
 * @param http - The HTTP router instance
 * @param component - The Plaid component API
 * @param config - Optional configuration
 *
 * @example
 * ```typescript
 * // convex/http.ts
 * import { httpRouter } from "convex/server";
 * import { registerRoutes } from "@smartpockets/convex-plaid";
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
      // Phase 1: Basic logging stub
      // Phase 2 will add:
      // - Signature verification (PLAID_WEBHOOK_SECRET)
      // - Full event processing (SYNC_UPDATES_AVAILABLE, etc.)
      // - Triggering automatic syncs

      const body = await req.json();

      console.log("[Plaid Webhook] Received:", {
        webhook_type: body.webhook_type,
        webhook_code: body.webhook_code,
        item_id: body.item_id,
      });

      // Extract webhook info
      const webhookType = body.webhook_type as string;
      const webhookCode = body.webhook_code as string;
      const itemId = body.item_id as string;

      // Handle known webhook types
      if (webhookType === "TRANSACTIONS") {
        if (webhookCode === "SYNC_UPDATES_AVAILABLE") {
          console.log(
            `[Plaid Webhook] Transaction updates available for item: ${itemId}`
          );
          // Phase 2: Auto-trigger sync via ctx.runAction
        } else if (webhookCode === "INITIAL_UPDATE") {
          console.log(
            `[Plaid Webhook] Initial transaction sync complete for item: ${itemId}`
          );
        } else if (webhookCode === "HISTORICAL_UPDATE") {
          console.log(
            `[Plaid Webhook] Historical transaction sync complete for item: ${itemId}`
          );
        }
      } else if (webhookType === "ITEM") {
        if (webhookCode === "ERROR") {
          console.log(
            `[Plaid Webhook] Item error for ${itemId}:`,
            body.error
          );
          // Phase 2: Update item status via ctx.runMutation
        } else if (webhookCode === "PENDING_EXPIRATION") {
          console.log(
            `[Plaid Webhook] Item ${itemId} access token expiring soon`
          );
        }
      } else if (webhookType === "LIABILITIES") {
        if (webhookCode === "DEFAULT_UPDATE") {
          console.log(
            `[Plaid Webhook] Liability updates available for item: ${itemId}`
          );
          // Phase 2: Auto-trigger fetchLiabilities
        }
      }

      // Call custom handler if provided
      if (config?.onWebhook) {
        await config.onWebhook(
          ctx as any,
          webhookType as any,
          webhookCode,
          itemId,
          body
        );
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
