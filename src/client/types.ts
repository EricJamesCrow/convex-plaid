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

/**
 * Account filters passed to Plaid Link token creation.
 * Uses a loose shape to support Plaid's evolving filter schema without
 * requiring frequent library updates.
 */
export type PlaidAccountFilters = Record<string, unknown>;

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
  /** True if more pages remain (caller should schedule another sync) */
  hasMore: boolean;
  /** Number of pages processed in this sync */
  pagesProcessed: number;
  /** True if sync was skipped due to lock conflict (another sync in progress) */
  skipped?: boolean;
  /** Reason for skipping if skipped=true */
  skipReason?: string;
}

/**
 * Options for syncTransactions pagination.
 */
export interface SyncTransactionsOptions {
  /** Maximum number of pages to fetch (default: 10) */
  maxPages?: number;
  /** Maximum transactions to accumulate before stopping (default: 5000) */
  maxTransactions?: number;
}

/**
 * Result from backfillTransactionEnrichments.
 */
export interface BackfillTransactionEnrichmentsResult {
  scanned: number;
  matched: number;
  updated: number;
  merchantsUpserted: number;
  /** True if more historical pages remain */
  hasMore: boolean;
  /** Number of pages processed in this backfill */
  pagesProcessed: number;
}

/**
 * Result from fetchLiabilities.
 */
export interface FetchLiabilitiesResult {
  creditCards: number;
  mortgages: number;
  studentLoans: number;
}

/**
 * Result from onboardItem (convenience method).
 */
export interface OnboardItemResult {
  accounts: FetchAccountsResult;
  transactions: SyncTransactionsResult;
  liabilities: FetchLiabilitiesResult;
  /** Recurring streams result if successful */
  recurringStreams?: FetchRecurringStreamsResult;
  /** Errors that occurred during onboarding (non-fatal) */
  errors?: {
    /** Error message if recurring streams fetch failed */
    recurringStreams?: string;
  };
}

/**
 * Result from fetchRecurringStreams.
 */
export interface FetchRecurringStreamsResult {
  inflows: number;
  outflows: number;
}

/**
 * Result from createUpdateLinkToken.
 */
export interface CreateUpdateLinkTokenResult {
  linkToken: string;
}

/**
 * Result from completeReauth.
 */
export interface CompleteReauthResult {
  success: boolean;
}

/**
 * Result from triggerTransactionsRefresh.
 */
export interface TriggerTransactionsRefreshResult {
  success: boolean;
  requestId?: string;
  error?: string;
}

/**
 * Result from enrichTransactions.
 */
export interface EnrichTransactionsResult {
  enriched: number;
  failed: number;
}

// =============================================================================
// SYNC LOG TYPES
// =============================================================================

/**
 * Type of sync operation.
 */
export type SyncType =
  | "transactions"
  | "liabilities"
  | "recurring"
  | "accounts"
  | "onboard";

/**
 * What triggered the sync.
 */
export type SyncTrigger = "webhook" | "scheduled" | "manual" | "onboard";

/**
 * Status of a sync operation.
 */
export type SyncStatus =
  | "started"
  | "success"
  | "error"
  | "rate_limited"
  | "circuit_open";

/**
 * Result counts from a sync operation.
 */
export interface SyncResult {
  transactionsAdded?: number;
  transactionsModified?: number;
  transactionsRemoved?: number;
  accountsUpdated?: number;
  streamsUpdated?: number;
}

/**
 * Sync statistics for monitoring.
 */
export interface SyncStats {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  averageDurationMs: number;
  lastSyncAt: number | null;
}

// =============================================================================
// PLAID ITEM TYPES
// =============================================================================

/**
 * Status of a plaidItem connection.
 */
export type PlaidItemStatus =
  | "pending"
  | "syncing"
  | "active"
  | "error"
  | "needs_reauth"
  | "deleting";

/**
 * Circuit breaker state for resilience.
 */
export type CircuitState = "closed" | "open" | "half_open";

/**
 * PlaidItem returned from queries (accessToken excluded for security).
 */
export interface PlaidItem {
  _id: string;
  userId: string;
  itemId: string;
  institutionId?: string;
  institutionName?: string;
  products: string[];
  isActive?: boolean;
  status: PlaidItemStatus;
  syncError?: string;
  createdAt: number;
  lastSyncedAt?: number;
  activatedAt?: number;
  // Error tracking
  errorCode?: string;
  errorMessage?: string;
  errorAt?: number;
  // Re-auth tracking
  reauthReason?: string;
  reauthAt?: number;
  // Disconnect tracking
  disconnectedReason?: string;
  disconnectedAt?: number;
  // Circuit breaker state (for monitoring)
  circuitState?: CircuitState;
  consecutiveFailures?: number;
  lastFailureAt?: number;
  nextRetryAt?: number;
}

/**
 * Plaid account returned from queries.
 */
export interface PlaidAccount {
  _id: string;
  userId: string;
  plaidItemId: string;
  accountId: string;
  name: string;
  officialName?: string;
  mask?: string;
  type: string;
  subtype?: string;
  balances: {
    available?: number;
    current?: number;
    limit?: number;
    isoCurrencyCode: string;
  };
  createdAt: number;
}

// =============================================================================
// INSTITUTION TYPES
// =============================================================================

/**
 * Cached institution metadata.
 */
export interface InstitutionMetadata {
  institutionId: string;
  name: string;
  logo?: string;
  primaryColor?: string;
  url?: string;
  products?: string[];
  lastFetched: number;
}

// =============================================================================
// AUTHENTICATION TYPES
// =============================================================================

/**
 * User identity from Convex authentication.
 *
 * The `subject` field is the unique user ID and is always present.
 * Other fields may be available depending on the auth provider.
 *
 * @see https://docs.convex.dev/auth
 */
export type UserIdentity = {
  /** Unique user identifier (userId) */
  subject: string;
  /** User's email address (if available) */
  email?: string;
  /** User's display name (if available) */
  name?: string;
  /** Additional fields from auth provider */
  [key: string]: unknown;
};

/**
 * Context with Convex auth available (for host app wrapper functions).
 *
 * This type represents the minimal auth-capable context that Convex provides
 * to queries and mutations in the host app.
 *
 * @example
 * ```typescript
 * import type { AuthenticatedContext } from "@crowdevelopment/convex-plaid/helpers";
 *
 * export const getMyItems = query({
 *   handler: async (ctx: AuthenticatedContext) => {
 *     const userId = await requireAuth(ctx);
 *     return await ctx.runQuery(api.plaid.getItemsByUser, { userId });
 *   },
 * });
 * ```
 */
export type AuthenticatedContext = {
  auth: {
    getUserIdentity: () => Promise<UserIdentity | null>;
  };
  runQuery: <T>(fn: any, args: any) => Promise<T>;
  runMutation: <T>(fn: any, args: any) => Promise<T>;
};

/**
 * Secure wrapper function signature.
 *
 * This type represents a function that accepts an authenticated context
 * and optional arguments, and returns a promise.
 *
 * Use this type for wrapper functions that require authentication.
 *
 * @template TArgs - Optional arguments type
 * @template TReturn - Return value type
 *
 * @example
 * ```typescript
 * const getMyItems: SecureWrapper<void, PlaidItem[]> = async (ctx) => {
 *   const userId = await requireAuth(ctx);
 *   return await ctx.runQuery(api.plaid.getItemsByUser, { userId });
 * };
 * ```
 */
export type SecureWrapper<TArgs = void, TReturn = unknown> = (
  ctx: AuthenticatedContext,
  args: TArgs
) => Promise<TReturn>;

// =============================================================================
// RE-EXPORTS
// =============================================================================

export type { HttpRouter };
