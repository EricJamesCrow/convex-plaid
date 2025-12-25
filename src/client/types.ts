/**
 * Plaid Component Type Definitions
 *
 * Type utilities and configuration types for the Plaid component client.
 */

import type {
  HttpRouter,
  GenericActionCtx,
  GenericMutationCtx,
  GenericDataModel,
  GenericQueryCtx,
} from "convex/server";

// =============================================================================
// CONTEXT TYPES
// =============================================================================

/**
 * Query context with runQuery capability.
 */
export type QueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;

/**
 * Mutation context with runQuery and runMutation capabilities.
 */
export type MutationCtx = Pick<
  GenericMutationCtx<GenericDataModel>,
  "runQuery" | "runMutation"
>;

/**
 * Action context with full capabilities (query, mutation, action).
 */
export type ActionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation" | "runAction"
>;

// =============================================================================
// PLAID CONFIGURATION
// =============================================================================

/**
 * Configuration for the Plaid component client.
 * All secrets must be provided - components cannot access process.env.
 */
export interface PlaidConfig {
  /**
   * Plaid Client ID from Plaid Dashboard.
   */
  PLAID_CLIENT_ID: string;

  /**
   * Plaid Secret Key from Plaid Dashboard.
   */
  PLAID_SECRET: string;

  /**
   * Plaid environment: "sandbox" | "development" | "production"
   */
  PLAID_ENV: string;

  /**
   * Base64-encoded 256-bit key for JWE encryption of access tokens.
   * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   */
  ENCRYPTION_KEY: string;
}

// =============================================================================
// WEBHOOK TYPES (Phase 2)
// =============================================================================

/**
 * Plaid webhook event types we handle.
 * Phase 1: Basic stub only.
 */
export type PlaidWebhookType =
  | "TRANSACTIONS"
  | "ITEM"
  | "AUTH"
  | "INVESTMENTS_TRANSACTIONS"
  | "LIABILITIES"
  | "HOLDINGS";

/**
 * Handler function for Plaid webhook events.
 */
export type PlaidWebhookHandler = (
  ctx: GenericActionCtx<GenericDataModel>,
  webhookType: PlaidWebhookType,
  webhookCode: string,
  itemId: string,
  payload: unknown
) => Promise<void>;

/**
 * Configuration for webhook registration.
 */
export interface RegisterRoutesConfig {
  /**
   * Optional webhook path. Defaults to "/plaid/webhook"
   */
  webhookPath?: string;

  /**
   * Plaid configuration (required for webhook processing).
   */
  plaidConfig?: PlaidConfig;

  /**
   * Optional custom webhook handler that runs after default processing.
   */
  onWebhook?: PlaidWebhookHandler;
}

// =============================================================================
// RESULT TYPES
// =============================================================================

/**
 * Result from createLinkToken.
 */
export interface CreateLinkTokenResult {
  linkToken: string;
}

/**
 * Result from exchangePublicToken.
 */
export interface ExchangePublicTokenResult {
  success: boolean;
  itemId: string;
  plaidItemId: string;
}

/**
 * Result from fetchAccounts.
 */
export interface FetchAccountsResult {
  accountCount: number;
}

/**
 * Result from syncTransactions.
 */
export interface SyncTransactionsResult {
  added: number;
  modified: number;
  removed: number;
  cursor: string;
}

/**
 * Result from fetchLiabilities.
 */
export interface FetchLiabilitiesResult {
  creditCards: number;
}

/**
 * Result from onboardItem (convenience method).
 */
export interface OnboardItemResult {
  accounts: FetchAccountsResult;
  transactions: SyncTransactionsResult;
  liabilities: FetchLiabilitiesResult;
}

// =============================================================================
// RE-EXPORTS
// =============================================================================

export type { HttpRouter };
