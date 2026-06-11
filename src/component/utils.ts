/**
 * Plaid Component Utilities
 *
 * Contains:
 * - Plaid SDK client initialization
 * - Amount/currency conversion (milliunits)
 * - Transaction transformation helpers
 *
 * COMPONENT NOTE: All functions receive credentials as parameters,
 * not from process.env. This enables component isolation.
 */

import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  type Transaction,
  type RemovedTransaction,
} from "plaid";

export const DEFAULT_PLAID_PRODUCTS = ["transactions", "liabilities"] as const;

const CONFIDENCE_LEVELS = new Set([
  "VERY_HIGH",
  "HIGH",
  "MEDIUM",
  "LOW",
  "UNKNOWN",
]);

type ConfidenceLevel = "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

type PlaidCounterparty = {
  name?: string | null;
  type?: string | null;
  logo_url?: string | null;
  website?: string | null;
  entity_id?: string | null;
  confidence_level?: string | null;
  phone_number?: string | null;
};

type PlaidTransactionWithEnrichment = Transaction & {
  merchant_entity_id?: string | null;
  logo_url?: string | null;
  website?: string | null;
  personal_finance_category_icon_url?: string | null;
  counterparties?: PlaidCounterparty[] | null;
  original_description?: string | null;
};

type TransactionMerchantEnrichment = {
  merchantId: string;
  merchantName: string;
  logoUrl?: string;
  categoryPrimary?: string;
  categoryDetailed?: string;
  categoryIconUrl?: string;
  website?: string;
  phoneNumber?: string;
  confidenceLevel: ConfidenceLevel;
};

// =============================================================================
// PLAID CLIENT INITIALIZATION
// =============================================================================

/**
 * Initialize Plaid client with provided credentials.
 *
 * @param clientId - Plaid client ID
 * @param secret - Plaid secret key
 * @param env - Plaid environment: "sandbox" | "development" | "production"
 * @returns Initialized PlaidApi client
 */
export function initPlaidClient(
  clientId: string,
  secret: string,
  env: string
): PlaidApi {
  const configuration = new Configuration({
    basePath: PlaidEnvironments[env as keyof typeof PlaidEnvironments],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });

  return new PlaidApi(configuration);
}

/**
 * Normalize the Plaid products this component needs for credit-card tracking.
 *
 * Transactions power balances/activity and liabilities power APR/payment data,
 * so both must be persisted on component items even when the host app omits
 * products during public-token exchange.
 */
export function normalizePlaidProducts(products?: string[]): string[] {
  return Array.from(new Set([...(products ?? []), ...DEFAULT_PLAID_PRODUCTS]));
}

// =============================================================================
// AMOUNT & CURRENCY UTILITIES
// =============================================================================

/**
 * Convert dollar amount to milliunits (× 1000).
 * Avoids floating point precision errors by storing as integers.
 *
 * @param amount - Dollar amount from Plaid API
 * @returns Integer milliunits value
 */
export function convertAmountToMilliunits(amount: number): number {
  return Math.round(amount * 1000);
}

/**
 * Convert milliunits back to dollars.
 *
 * @param milliunits - Stored milliunits value
 * @returns Dollar amount for display
 */
export function convertMilliunitsToDollars(milliunits: number): number {
  return milliunits / 1000;
}

// =============================================================================
// TRANSACTION TRANSFORMATION
// =============================================================================

function optionalString(value: string | null | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function normalizeConfidenceLevel(value: string | null | undefined): ConfidenceLevel {
  return value && CONFIDENCE_LEVELS.has(value) ? (value as ConfidenceLevel) : "UNKNOWN";
}

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  VERY_HIGH: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  UNKNOWN: 0,
};

/**
 * Pick the most likely merchant counterparty from a Plaid counterparties array.
 *
 * Resolution order:
 *   1. Filter to entries with `type === "merchant"` and `entity_id` set, then
 *      pick the highest `confidence_level`. Stable for equal confidences.
 *   2. If no merchant-typed entry exists, fall back to the first counterparty
 *      with any `entity_id` (e.g. marketplaces, processors).
 *   3. Otherwise return undefined.
 *
 * Plaid's payment-processor flows (Square, Stripe, DoorDash) often place the
 * processor at index 0 with the actual merchant later in the array, so a
 * blind `[0]` pick misses the merchant entirely.
 */
export function selectMerchantCounterparty(
  counterparties: PlaidCounterparty[] | null | undefined
): PlaidCounterparty | undefined {
  if (!counterparties?.length) return undefined;
  let bestMerchant: PlaidCounterparty | undefined;
  let bestRank = -1;
  for (const counterparty of counterparties) {
    if (counterparty.type !== "merchant" || !counterparty.entity_id) continue;
    const rank = CONFIDENCE_RANK[normalizeConfidenceLevel(counterparty.confidence_level)];
    if (rank > bestRank) {
      bestMerchant = counterparty;
      bestRank = rank;
    }
  }
  if (bestMerchant) return bestMerchant;
  return counterparties.find((counterparty) => counterparty.entity_id);
}

/**
 * Extract merchant enrichment fields that Plaid already returns from
 * /transactions/sync. This avoids a separate Enrich API call for Plaid-sourced
 * transactions while preserving the same normalized merchant storage model.
 */
export function extractTransactionMerchantEnrichment(txn: Transaction): TransactionMerchantEnrichment | undefined {
  const enrichedTxn = txn as PlaidTransactionWithEnrichment;
  const counterparty = selectMerchantCounterparty(enrichedTxn.counterparties);
  const merchantId = optionalString(enrichedTxn.merchant_entity_id) ?? optionalString(counterparty?.entity_id);
  const merchantName = optionalString(enrichedTxn.merchant_name) ?? optionalString(counterparty?.name);

  if (!merchantId || !merchantName) {
    return undefined;
  }

  return {
    merchantId,
    merchantName,
    logoUrl: optionalString(enrichedTxn.logo_url) ?? optionalString(counterparty?.logo_url),
    categoryPrimary: optionalString(txn.personal_finance_category?.primary),
    categoryDetailed: optionalString(txn.personal_finance_category?.detailed),
    categoryIconUrl: optionalString(enrichedTxn.personal_finance_category_icon_url),
    website: optionalString(enrichedTxn.website) ?? optionalString(counterparty?.website),
    phoneNumber: optionalString(counterparty?.phone_number),
    confidenceLevel: normalizeConfidenceLevel(counterparty?.confidence_level),
  };
}

/**
 * Transform Plaid transaction to component storage format.
 *
 * @param txn - Raw Plaid Transaction object
 * @returns Transformed transaction data for storage
 */
export function transformTransaction(txn: Transaction) {
  const enrichedTxn = txn as PlaidTransactionWithEnrichment;
  const merchantEnrichment = extractTransactionMerchantEnrichment(txn);
  const transformed = {
    accountId: txn.account_id,
    transactionId: txn.transaction_id,
    amount: convertAmountToMilliunits(txn.amount),
    isoCurrencyCode: txn.iso_currency_code ?? "USD",
    date: txn.date,
    datetime: txn.datetime ?? undefined,
    name: txn.name,
    merchantName: txn.merchant_name ?? undefined,
    originalDescription: optionalString(enrichedTxn.original_description),
    pending: txn.pending,
    pendingTransactionId: txn.pending_transaction_id ?? undefined,
    categoryPrimary: txn.personal_finance_category?.primary ?? undefined,
    categoryDetailed: txn.personal_finance_category?.detailed ?? undefined,
    paymentChannel: txn.payment_channel ?? undefined,
  };

  if (!merchantEnrichment) {
    return transformed;
  }

  return {
    ...transformed,
    merchantId: merchantEnrichment.merchantId,
    enrichmentData: {
      counterpartyName: merchantEnrichment.merchantName,
      counterpartyType: "merchant",
      counterpartyEntityId: merchantEnrichment.merchantId,
      counterpartyConfidence: merchantEnrichment.confidenceLevel,
      counterpartyLogoUrl: merchantEnrichment.logoUrl,
      counterpartyWebsite: merchantEnrichment.website,
      counterpartyPhoneNumber: merchantEnrichment.phoneNumber,
      enrichedAt: Date.now(),
    },
    merchantEnrichment,
  };
}

// =============================================================================
// /transactions/enrich INPUT PARTITIONING
// =============================================================================

/**
 * Account types Plaid `/transactions/enrich` accepts. Other Plaid account
 * subtypes (loan, investment, other) are rejected by the API.
 */
export type EnrichAccountType = "credit" | "depository";

/**
 * Single transaction in a `/transactions/enrich` request. The API requires
 * `account_type` to be a single value per request, so callers tag each
 * transaction with its source account type and the partition splits them
 * into one batch per type.
 */
export interface EnrichInputTransaction {
  id: string;
  description: string;
  amount: number;
  direction: "INFLOW" | "OUTFLOW";
  account_type: EnrichAccountType;
  iso_currency_code?: string;
  mcc?: string;
  location?: {
    city?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
}

const SUPPORTED_ENRICH_ACCOUNT_TYPES: ReadonlySet<string> = new Set(["credit", "depository"]);

/**
 * Partition `/transactions/enrich` input into one batch per account_type.
 * Transactions with unsupported account types (e.g. "loan", "investment",
 * "other") land in `skipped` so the caller can log/report them rather than
 * sending an API call that would reject them.
 */
export function partitionEnrichmentInput(
  transactions: ReadonlyArray<EnrichInputTransaction & { account_type: string }>
): {
  credit: EnrichInputTransaction[];
  depository: EnrichInputTransaction[];
  skipped: EnrichInputTransaction[];
} {
  const credit: EnrichInputTransaction[] = [];
  const depository: EnrichInputTransaction[] = [];
  const skipped: EnrichInputTransaction[] = [];

  for (const txn of transactions) {
    if (!SUPPORTED_ENRICH_ACCOUNT_TYPES.has(txn.account_type)) {
      skipped.push(txn as EnrichInputTransaction);
      continue;
    }
    if (txn.account_type === "credit") {
      credit.push(txn as EnrichInputTransaction);
    } else {
      depository.push(txn as EnrichInputTransaction);
    }
  }

  return { credit, depository, skipped };
}

// =============================================================================
// SYNC HELPER TYPES
// =============================================================================

/** Result from transaction sync pagination */
export interface TransactionSyncResult {
  added: Transaction[];
  modified: Transaction[];
  removed: RemovedTransaction[];
  nextCursor: string;
  hasMore: boolean; // True if more pages remain (hit page limit)
  pagesProcessed: number;
}

/** Default pagination limits */
export const SYNC_PAGINATION_DEFAULTS = {
  maxPages: 10, // Maximum pages to fetch in one sync call
  maxTransactions: 5000, // Maximum transactions to accumulate before stopping
} as const;

// =============================================================================
// SYNC HELPERS
// =============================================================================

/** Options for transaction sync pagination */
export interface SyncPaginationOptions {
  maxPages?: number; // Maximum pages to fetch (default: 10)
  maxTransactions?: number; // Maximum transactions before stopping (default: 5000)
}

/**
 * Sync transactions with cursor-based pagination.
 *
 * Fetches pages of transaction updates from Plaid with configurable limits.
 * Stops when:
 * - No more pages available (has_more = false)
 * - maxPages limit reached
 * - maxTransactions limit reached
 *
 * When stopped due to limits, hasMore=true signals that more syncs are needed.
 * Pure function - no side effects (caller handles storage).
 *
 * @param plaidClient - Initialized Plaid client
 * @param accessToken - Decrypted access token
 * @param cursor - Starting cursor (empty string for initial sync)
 * @param options - Pagination limits
 * @returns Accumulated transactions, cursor, and continuation status
 */
export async function syncTransactionsPaginated(
  plaidClient: PlaidApi,
  accessToken: string,
  cursor: string = "",
  options: SyncPaginationOptions = {}
): Promise<TransactionSyncResult> {
  const maxPages = options.maxPages ?? SYNC_PAGINATION_DEFAULTS.maxPages;
  const maxTransactions = options.maxTransactions ?? SYNC_PAGINATION_DEFAULTS.maxTransactions;

  let currentCursor = cursor;
  let added: Transaction[] = [];
  let modified: Transaction[] = [];
  let removed: RemovedTransaction[] = [];
  let pagesProcessed = 0;
  let hasMore = false;

  // Pagination loop with limits
  while (pagesProcessed < maxPages) {
    const syncResponse = await plaidClient.transactionsSync({
      access_token: accessToken,
      cursor: currentCursor,
      options: {
        include_personal_finance_category: true,
        // Surfaces Plaid's `original_description` field — the raw bank-statement
        // descriptor (e.g. "AMAZON MKTPL*B90VX7M20") — on each returned
        // transaction. Required input for /transactions/enrich to maximize
        // merchant match rate; persisted on the transaction row for backfill.
        include_original_description: true,
      },
    });

    pagesProcessed++;

    // Accumulate results using push (more memory-efficient than concat)
    added.push(...syncResponse.data.added);
    modified.push(...syncResponse.data.modified);
    removed.push(...syncResponse.data.removed);

    // Update cursor for next iteration
    currentCursor = syncResponse.data.next_cursor;

    const totalTransactions = added.length + modified.length;

    console.log(
      `[Plaid Component] Page ${pagesProcessed}/${maxPages}: ` +
        `${syncResponse.data.added.length} added, ` +
        `${syncResponse.data.modified.length} modified, ` +
        `${syncResponse.data.removed.length} removed ` +
        `(total: ${totalTransactions}, has_more: ${syncResponse.data.has_more})`
    );

    // Check if we should stop
    if (!syncResponse.data.has_more) {
      // Plaid says no more data
      hasMore = false;
      break;
    }

    // Check transaction limit
    if (totalTransactions >= maxTransactions) {
      console.log(
        `[Plaid Component] Reached transaction limit (${totalTransactions}/${maxTransactions}), ` +
          `will continue in next sync`
      );
      hasMore = true;
      break;
    }

    // Check page limit (loop condition will catch this too)
    if (pagesProcessed >= maxPages) {
      console.log(
        `[Plaid Component] Reached page limit (${pagesProcessed}/${maxPages}), ` +
          `will continue in next sync`
      );
      hasMore = true;
      break;
    }

    // If there are more pages, continue
    hasMore = syncResponse.data.has_more;
  }

  return {
    added,
    modified,
    removed,
    nextCursor: currentCursor,
    hasMore,
    pagesProcessed,
  };
}

// =============================================================================
// ARRAY UTILITIES
// =============================================================================

/**
 * Split an array into equally-sized chunks (last chunk may be smaller).
 *
 * @param items - Array to chunk
 * @param chunkSize - Maximum size of each chunk
 * @returns Array of chunks
 */
export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}
