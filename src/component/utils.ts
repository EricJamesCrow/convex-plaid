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

/**
 * Transform Plaid transaction to component storage format.
 *
 * @param txn - Raw Plaid Transaction object
 * @returns Transformed transaction data for storage
 */
export function transformTransaction(txn: Transaction) {
  return {
    accountId: txn.account_id,
    transactionId: txn.transaction_id,
    amount: convertAmountToMilliunits(txn.amount),
    isoCurrencyCode: txn.iso_currency_code ?? "USD",
    date: txn.date,
    datetime: txn.datetime ?? undefined,
    name: txn.name,
    merchantName: txn.merchant_name ?? undefined,
    pending: txn.pending,
    pendingTransactionId: txn.pending_transaction_id ?? undefined,
    categoryPrimary: txn.personal_finance_category?.primary ?? undefined,
    categoryDetailed: txn.personal_finance_category?.detailed ?? undefined,
    paymentChannel: txn.payment_channel ?? undefined,
  };
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
}

// =============================================================================
// SYNC HELPERS
// =============================================================================

/**
 * Sync transactions with cursor-based pagination.
 *
 * Fetches all pages of transaction updates from Plaid.
 * Pure function - no side effects (caller handles storage).
 *
 * @param plaidClient - Initialized Plaid client
 * @param accessToken - Decrypted access token
 * @param cursor - Starting cursor (empty string for initial sync)
 * @returns Accumulated transactions and final cursor
 */
export async function syncTransactionsPaginated(
  plaidClient: PlaidApi,
  accessToken: string,
  cursor: string = ""
): Promise<TransactionSyncResult> {
  let currentCursor = cursor;
  let added: Transaction[] = [];
  let modified: Transaction[] = [];
  let removed: RemovedTransaction[] = [];

  // Pagination loop - fetch all pages
  while (true) {
    const syncResponse = await plaidClient.transactionsSync({
      access_token: accessToken,
      cursor: currentCursor,
      options: {
        include_personal_finance_category: true,
      },
    });

    // Accumulate results
    added = added.concat(syncResponse.data.added);
    modified = modified.concat(syncResponse.data.modified);
    removed = removed.concat(syncResponse.data.removed);

    // Update cursor for next iteration
    currentCursor = syncResponse.data.next_cursor;

    console.log(
      `[Plaid Component] Fetched: ${syncResponse.data.added.length} added, ` +
        `${syncResponse.data.modified.length} modified, ` +
        `${syncResponse.data.removed.length} removed ` +
        `(has_more: ${syncResponse.data.has_more})`
    );

    // Exit when no more pages
    if (!syncResponse.data.has_more) break;
  }

  return {
    added,
    modified,
    removed,
    nextCursor: currentCursor,
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
