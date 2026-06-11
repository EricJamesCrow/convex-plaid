/**
 * Plaid Component Private/Internal Functions
 *
 * Internal mutations and queries used by actions and webhooks.
 * These are NOT exposed to the host app directly.
 *
 * COMPONENT NOTE: Uses internalMutation/internalQuery for component isolation.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { QueryCtx, MutationCtx } from "./_generated/server.js";

// =============================================================================
// HELPER: Safe Upsert Pattern (TOCTOU Protection)
// =============================================================================

/**
 * Safe upsert pattern to handle TOCTOU (Time-of-Check-Time-of-Use) race conditions.
 *
 * Problem: In concurrent upsert operations, two calls might both:
 * 1. Query and find no existing record
 * 2. Both insert, creating duplicates
 *
 * Solution: Insert-first approach with duplicate detection and cleanup.
 * 1. Try to insert first (optimistic)
 * 2. After insert, check if duplicates exist (same key, different _id)
 * 3. If duplicates found, keep the one with earliest _creationTime, delete others
 * 4. If we deleted our insert, update the surviving record
 *
 * This ensures exactly one record per unique key, even under concurrent inserts.
 *
 * Alternative approach for existing records:
 * - Query first, if exists, update it
 * - If not exists, do insert-then-verify pattern above
 *
 * @param ctx - Mutation context
 * @param queryFn - Function to query for existing record(s) by unique key
 * @param insertFn - Function to insert a new record
 * @param updateFn - Function to update an existing record
 * @returns { created: boolean; id: string } - Whether record was created or updated
 */
function compareByCreationTimeThenId<T extends { _id: any; _creationTime: number }>(
  a: T,
  b: T
) {
  const createdDelta = a._creationTime - b._creationTime;
  if (createdDelta !== 0) return createdDelta;
  const aId = String(a._id);
  const bId = String(b._id);
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

async function safeUpsertWithDedup<T extends { _id: any; _creationTime: number }>(
  ctx: MutationCtx,
  queryFn: () => Promise<T | null>,
  queryAllFn: () => Promise<T[]>,
  insertFn: () => Promise<string>,
  updateFn: (id: any) => Promise<void>
): Promise<{ created: boolean; id: string }> {
  // First check if record exists
  const existing = await queryFn();

  if (existing) {
    const allMatching = await queryAllFn();
    const sorted = allMatching.length > 0
      ? allMatching.sort(compareByCreationTimeThenId)
      : [existing];
    const survivor = sorted[0];
    const duplicates = sorted.slice(1);

    for (const dup of duplicates) {
      await ctx.db.delete(dup._id);
    }

    await updateFn(survivor._id);
    return { created: false, id: String(survivor._id) };
  }

  // No existing record - insert new one
  const newId = await insertFn();

  // CRITICAL: After insert, check for duplicates created by concurrent mutations
  // This handles the race condition where another mutation inserted between
  // our query and insert
  const allMatching = await queryAllFn();

  if (allMatching.length > 1) {
    // Duplicates detected! Keep the one with earliest creation time
    const sorted = allMatching.sort(compareByCreationTimeThenId);
    const survivor = sorted[0];
    const duplicates = sorted.slice(1);

    // Delete all duplicates
    for (const dup of duplicates) {
      await ctx.db.delete(dup._id);
    }

    // If our insert was a duplicate (not the survivor), update the survivor
    if (String(survivor._id) !== newId) {
      await updateFn(survivor._id);
      return { created: false, id: String(survivor._id) };
    }
  }

  return { created: true, id: newId };
}

// =============================================================================
// HELPER: Efficient ID Lookup
// =============================================================================

/**
 * Helper to get a plaidItem by its string ID efficiently using O(1) lookup.
 * Uses ctx.db.normalizeId() + ctx.db.get() instead of full table scan.
 */
async function getPlaidItemById(
  ctx: QueryCtx | MutationCtx,
  plaidItemId: string
) {
  // normalizeId converts string to proper Id type, returns null if invalid
  const id = ctx.db.normalizeId("plaidItems", plaidItemId);
  if (!id) return null;
  return await ctx.db.get(id);
}

// =============================================================================
// VALIDATORS (Reusable)
// =============================================================================

const balancesValidator = v.object({
  available: v.optional(v.number()),
  current: v.optional(v.number()),
  limit: v.optional(v.number()),
  isoCurrencyCode: v.string(),
});

const accountValidator = v.object({
  accountId: v.string(),
  name: v.string(),
  officialName: v.optional(v.string()),
  mask: v.optional(v.string()),
  type: v.string(),
  subtype: v.optional(v.string()),
  balances: balancesValidator,
});

const confidenceLevelValidator = v.union(
  v.literal("VERY_HIGH"),
  v.literal("HIGH"),
  v.literal("MEDIUM"),
  v.literal("LOW"),
  v.literal("UNKNOWN")
);

const enrichmentDataValidator = v.object({
  counterpartyName: v.optional(v.string()),
  counterpartyType: v.optional(v.string()),
  counterpartyEntityId: v.optional(v.string()),
  counterpartyConfidence: v.optional(v.string()),
  counterpartyLogoUrl: v.optional(v.string()),
  counterpartyWebsite: v.optional(v.string()),
  counterpartyPhoneNumber: v.optional(v.string()),
  enrichedAt: v.optional(v.number()),
});

const transactionMerchantEnrichmentValidator = v.object({
  merchantId: v.string(),
  merchantName: v.string(),
  logoUrl: v.optional(v.string()),
  categoryPrimary: v.optional(v.string()),
  categoryDetailed: v.optional(v.string()),
  categoryIconUrl: v.optional(v.string()),
  website: v.optional(v.string()),
  phoneNumber: v.optional(v.string()),
  confidenceLevel: confidenceLevelValidator,
});

const transactionValidator = v.object({
  accountId: v.string(),
  transactionId: v.string(),
  amount: v.number(),
  isoCurrencyCode: v.string(),
  date: v.string(),
  datetime: v.optional(v.string()),
  name: v.string(),
  merchantName: v.optional(v.string()),
  originalDescription: v.optional(v.string()),
  pending: v.boolean(),
  pendingTransactionId: v.optional(v.string()),
  categoryPrimary: v.optional(v.string()),
  categoryDetailed: v.optional(v.string()),
  paymentChannel: v.optional(v.string()),
  merchantId: v.optional(v.string()),
  enrichmentData: v.optional(enrichmentDataValidator),
  merchantEnrichment: v.optional(transactionMerchantEnrichmentValidator),
});

const aprValidator = v.object({
  aprPercentage: v.number(),
  aprType: v.string(),
  balanceSubjectToApr: v.optional(v.number()),
  interestChargeAmount: v.optional(v.number()),
});

const recurringStreamValidator = v.object({
  streamId: v.string(),
  accountId: v.string(),
  description: v.string(),
  merchantName: v.optional(v.string()),
  averageAmount: v.number(),
  lastAmount: v.number(),
  isoCurrencyCode: v.string(),
  frequency: v.string(),
  status: v.union(
    v.literal("MATURE"),
    v.literal("EARLY_DETECTION"),
    v.literal("TOMBSTONED")
  ),
  isActive: v.boolean(),
  type: v.union(v.literal("inflow"), v.literal("outflow")),
  category: v.optional(v.string()),
  firstDate: v.optional(v.string()),
  lastDate: v.optional(v.string()),
  predictedNextDate: v.optional(v.string()),
});

type ConfidenceLevel = "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

type MerchantEnrichmentInput = {
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

type EnrichmentDataInput = {
  counterpartyName?: string;
  counterpartyType?: string;
  counterpartyEntityId?: string;
  counterpartyConfidence?: string;
  counterpartyLogoUrl?: string;
  counterpartyWebsite?: string;
  counterpartyPhoneNumber?: string;
  enrichedAt?: number;
};

type TransactionInput = {
  accountId: string;
  transactionId: string;
  amount: number;
  isoCurrencyCode: string;
  date: string;
  datetime?: string;
  name: string;
  merchantName?: string;
  pending: boolean;
  pendingTransactionId?: string;
  categoryPrimary?: string;
  categoryDetailed?: string;
  paymentChannel?: string;
  merchantId?: string;
  enrichmentData?: EnrichmentDataInput;
  merchantEnrichment?: MerchantEnrichmentInput;
};

type StoredTransactionDoc = TransactionInput & {
  _id: any;
  _creationTime: number;
  userId: string;
  plaidItemId: string;
  createdAt: number;
  updatedAt?: number;
};

type MerchantEnrichmentDoc = MerchantEnrichmentInput & {
  _id: unknown;
  _creationTime: number;
  lastEnriched: number;
};

function buildMerchantEnrichmentPatch(
  merchant: MerchantEnrichmentInput,
  now: number,
  existing?: Partial<MerchantEnrichmentDoc> | null
) {
  return {
    merchantId: merchant.merchantId,
    merchantName: merchant.merchantName,
    logoUrl: merchant.logoUrl ?? existing?.logoUrl,
    categoryPrimary: merchant.categoryPrimary ?? existing?.categoryPrimary,
    categoryDetailed: merchant.categoryDetailed ?? existing?.categoryDetailed,
    categoryIconUrl: merchant.categoryIconUrl ?? existing?.categoryIconUrl,
    website: merchant.website ?? existing?.website,
    phoneNumber: merchant.phoneNumber ?? existing?.phoneNumber,
    confidenceLevel:
      merchant.confidenceLevel !== "UNKNOWN"
        ? merchant.confidenceLevel
        : existing?.confidenceLevel ?? "UNKNOWN",
    lastEnriched: now,
  };
}

async function upsertMerchantEnrichmentRecord(
  ctx: MutationCtx,
  merchant: MerchantEnrichmentInput
): Promise<string> {
  const now = Date.now();

  const result = await safeUpsertWithDedup(
    ctx,
    () =>
      ctx.db
        .query("merchantEnrichments")
        .withIndex("by_merchant", (q) => q.eq("merchantId", merchant.merchantId))
        .first(),
    () =>
      ctx.db
        .query("merchantEnrichments")
        .withIndex("by_merchant", (q) => q.eq("merchantId", merchant.merchantId))
        .collect(),
    async () => {
      const id = await ctx.db.insert(
        "merchantEnrichments",
        buildMerchantEnrichmentPatch(merchant, now)
      );
      return String(id);
    },
    async (id) => {
      const existing = (await ctx.db.get(id)) as Partial<MerchantEnrichmentDoc> | null;
      await ctx.db.patch(id, buildMerchantEnrichmentPatch(merchant, now, existing));
    }
  );

  return result.id;
}

function splitTransactionForStorage(transaction: TransactionInput) {
  const { merchantEnrichment, merchantId, enrichmentData, ...transactionDoc } = transaction;
  return {
    merchantEnrichment,
    transactionDoc: {
      ...transactionDoc,
      ...(merchantId ? { merchantId } : {}),
      ...(enrichmentData ? { enrichmentData } : {}),
    },
  };
}

async function prepareTransactionDocument(
  ctx: MutationCtx,
  transaction: TransactionInput
) {
  const { merchantEnrichment, transactionDoc } = splitTransactionForStorage(transaction);
  if (merchantEnrichment) {
    await upsertMerchantEnrichmentRecord(ctx, merchantEnrichment);
  }
  return transactionDoc;
}

async function removeDuplicateTransactionRows(
  ctx: MutationCtx,
  docs: StoredTransactionDoc[]
): Promise<StoredTransactionDoc | null> {
  if (docs.length === 0) return null;

  const sorted = [...docs].sort(compareByCreationTimeThenId);
  const survivor = sorted[0];

  for (const duplicate of sorted.slice(1)) {
    await ctx.db.delete(duplicate._id);
  }

  return survivor;
}

async function reassignPlaidItemReferences(
  ctx: MutationCtx,
  fromPlaidItemId: string,
  toPlaidItemId: string
) {
  const mergeDuplicateRowPayload = <
    T extends {
      _id: any;
      _creationTime: number;
      plaidItemId: string;
      [key: string]: unknown;
    },
  >(
    rows: T[]
  ) => {
    const merged: Record<string, unknown> = {};

    for (const row of [...rows].sort(compareByCreationTimeThenId)) {
      for (const [key, value] of Object.entries(row)) {
        if (key === "_id" || key === "_creationTime" || key === "createdAt") {
          continue;
        }
        if (value !== undefined) {
          merged[key] = value;
        }
      }
    }

    merged.plaidItemId = toPlaidItemId;
    return merged;
  };

  const mergeRowsByNaturalKey = async <
    T extends {
      _id: any;
      _creationTime: number;
      plaidItemId: string;
      [key: string]: unknown;
    },
  >(
    fromRows: T[],
    toRows: T[],
    naturalKey: (row: T) => string
  ) => {
    const rowsByKey = new Map<string, { rows: T[]; hasSourceRow: boolean }>();
    const addRow = (row: T, sourceRow: boolean) => {
      const key = naturalKey(row);
      const current = rowsByKey.get(key);
      if (!current) {
        rowsByKey.set(key, { rows: [row], hasSourceRow: sourceRow });
        return;
      }

      current.rows.push(row);
      current.hasSourceRow ||= sourceRow;
    };

    for (const target of toRows) addRow(target, false);
    for (const source of fromRows) addRow(source, true);

    for (const { rows, hasSourceRow } of rowsByKey.values()) {
      if (!hasSourceRow) continue;

      const sorted = [...rows].sort(compareByCreationTimeThenId);
      const survivor = sorted[0];

      await ctx.db.patch(
        survivor._id,
        mergeDuplicateRowPayload(sorted) as any
      );

      for (const duplicate of sorted.slice(1)) {
        await ctx.db.delete(duplicate._id);
      }
    }
  };

  const accounts = await ctx.db
    .query("plaidAccounts")
    .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", fromPlaidItemId))
    .collect();
  const targetAccounts = await ctx.db
    .query("plaidAccounts")
    .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", toPlaidItemId))
    .collect();
  await mergeRowsByNaturalKey(accounts, targetAccounts, (account) => account.accountId);

  const transactions = await ctx.db
    .query("plaidTransactions")
    .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", fromPlaidItemId))
    .collect();
  const targetTransactions = await ctx.db
    .query("plaidTransactions")
    .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", toPlaidItemId))
    .collect();
  await mergeRowsByNaturalKey(transactions, targetTransactions, (transaction) => transaction.transactionId);

  const creditCardLiabilities = await ctx.db
    .query("plaidCreditCardLiabilities")
    .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", fromPlaidItemId))
    .collect();
  const targetCreditCardLiabilities = await ctx.db
    .query("plaidCreditCardLiabilities")
    .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", toPlaidItemId))
    .collect();
  await mergeRowsByNaturalKey(
    creditCardLiabilities,
    targetCreditCardLiabilities,
    (liability) => liability.accountId
  );

  const mortgageLiabilities = await ctx.db
    .query("plaidMortgageLiabilities")
    .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", fromPlaidItemId))
    .collect();
  const targetMortgageLiabilities = await ctx.db
    .query("plaidMortgageLiabilities")
    .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", toPlaidItemId))
    .collect();
  await mergeRowsByNaturalKey(
    mortgageLiabilities,
    targetMortgageLiabilities,
    (liability) => liability.accountId
  );

  const studentLoanLiabilities = await ctx.db
    .query("plaidStudentLoanLiabilities")
    .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", fromPlaidItemId))
    .collect();
  const targetStudentLoanLiabilities = await ctx.db
    .query("plaidStudentLoanLiabilities")
    .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", toPlaidItemId))
    .collect();
  await mergeRowsByNaturalKey(
    studentLoanLiabilities,
    targetStudentLoanLiabilities,
    (liability) => liability.accountId
  );

  const recurringStreams = await ctx.db
    .query("plaidRecurringStreams")
    .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", fromPlaidItemId))
    .collect();
  const targetRecurringStreams = await ctx.db
    .query("plaidRecurringStreams")
    .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", toPlaidItemId))
    .collect();
  await mergeRowsByNaturalKey(recurringStreams, targetRecurringStreams, (stream) => stream.streamId);

  const syncLogs = await ctx.db
    .query("syncLogs")
    .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", fromPlaidItemId))
    .collect();
  const targetSyncLogs = await ctx.db
    .query("syncLogs")
    .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", toPlaidItemId))
    .collect();
  await mergeRowsByNaturalKey(
    syncLogs,
    targetSyncLogs,
    (syncLog) => `${syncLog.syncType}:${syncLog.trigger}:${syncLog.startedAt}`
  );
}

// =============================================================================
// INTERNAL QUERIES
// =============================================================================

/**
 * Get a plaidItem by its Convex document ID.
 * Returns the item with its encrypted access token.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const getPlaidItem = internalQuery({
  args: { plaidItemId: v.string() },
  returns: v.union(
    v.object({
      _id: v.any(),
      userId: v.string(),
      itemId: v.string(),
      accessToken: v.string(),
      cursor: v.optional(v.string()),
      institutionId: v.optional(v.string()),
      institutionName: v.optional(v.string()),
      status: v.string(),
      syncError: v.optional(v.string()),
      createdAt: v.number(),
      lastSyncedAt: v.optional(v.number()),
      syncVersion: v.optional(v.number()),
      syncStartedAt: v.optional(v.number()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    // O(1) lookup using normalizeId + get
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) return null;

    return {
      _id: item._id,
      userId: item.userId,
      itemId: item.itemId,
      accessToken: item.accessToken,
      cursor: item.cursor,
      institutionId: item.institutionId,
      institutionName: item.institutionName,
      status: item.status,
      syncError: item.syncError,
      createdAt: item.createdAt,
      lastSyncedAt: item.lastSyncedAt,
      syncVersion: item.syncVersion,
      syncStartedAt: item.syncStartedAt,
    };
  },
});

/**
 * Get a plaidItem by Plaid's item_id (for webhooks).
 */
export const getPlaidItemByItemId = internalQuery({
  args: { itemId: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("plaidItems")
      .withIndex("by_item_id", (q) => q.eq("itemId", args.itemId))
      .first();
  },
});

// =============================================================================
// INTERNAL MUTATIONS - PlaidItems
// =============================================================================

/**
 * Create a new plaidItem.
 * Returns the Convex document ID as a string.
 */
export const createPlaidItem = internalMutation({
  args: {
    userId: v.string(),
    itemId: v.string(),
    accessToken: v.string(),
    institutionId: v.optional(v.string()),
    institutionName: v.optional(v.string()),
    products: v.array(v.string()),
    isActive: v.optional(v.boolean()),
    status: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const itemUpdate = {
      userId: args.userId,
      accessToken: args.accessToken,
      institutionId: args.institutionId,
      institutionName: args.institutionName,
      products: args.products,
      isActive: args.isActive ?? true,
      status: args.status as any,
      syncError: undefined,
    };
    const consolidateMatchingItems = async (
      matchingItems: Array<{
        _id: any;
        _creationTime: number;
        status: string;
        syncVersion?: number;
      }>
    ) => {
      const sorted = matchingItems
        .filter((item) => item.status !== "deleting")
        .sort(compareByCreationTimeThenId);
      const survivor = sorted[0];

      if (!survivor) return null;

      for (const duplicate of sorted.slice(1)) {
        await reassignPlaidItemReferences(
          ctx,
          String(duplicate._id),
          String(survivor._id)
        );
        await ctx.db.delete(duplicate._id);
      }

      await ctx.db.patch(survivor._id, {
        ...itemUpdate,
        ...(survivor.syncVersion === undefined ? { syncVersion: 0 } : {}),
      });

      return String(survivor._id);
    };

    const matchingItems = await ctx.db
      .query("plaidItems")
      .withIndex("by_item_id", (q) => q.eq("itemId", args.itemId))
      .collect();

    const existingSurvivorId = await consolidateMatchingItems(matchingItems);
    if (existingSurvivorId) return existingSurvivorId;

    const id = await ctx.db.insert("plaidItems", {
      userId: args.userId,
      itemId: args.itemId,
      accessToken: args.accessToken,
      institutionId: args.institutionId,
      institutionName: args.institutionName,
      products: args.products,
      isActive: args.isActive ?? true,
      status: args.status as any,
      createdAt: now,
      syncVersion: 0,
    });

    const itemsAfterInsert = await ctx.db
      .query("plaidItems")
      .withIndex("by_item_id", (q) => q.eq("itemId", args.itemId))
      .collect();
    return (await consolidateMatchingItems(itemsAfterInsert)) ?? String(id);
  },
});

/**
 * Update plaidItem status.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const updateItemStatus = internalMutation({
  args: {
    plaidItemId: v.string(),
    status: v.string(),
    syncError: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // O(1) lookup using normalizeId + get
    const item = await getPlaidItemById(ctx, args.plaidItemId);

    if (item) {
      // Skip update for items being deleted - prevents race with cleanup
      if (item.status === "deleting") {
        return null;
      }
      await ctx.db.patch(item._id, {
        status: args.status as any,
        syncError: args.syncError,
      });
    }

    return null;
  },
});

/**
 * Update lastSyncedAt timestamp for a plaidItem.
 * Useful for sync operations that don't use cursors (e.g., fetchLiabilities).
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const updateLastSyncedAt = internalMutation({
  args: { plaidItemId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await getPlaidItemById(ctx, args.plaidItemId);

    if (item) {
      await ctx.db.patch(item._id, { lastSyncedAt: Date.now() });
    }

    return null;
  },
});

/**
 * Update plaidItem cursor after successful sync.
 * Also marks as 'active' and updates lastSyncedAt.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const updateItemCursor = internalMutation({
  args: {
    plaidItemId: v.string(),
    cursor: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // O(1) lookup using normalizeId + get
    const item = await getPlaidItemById(ctx, args.plaidItemId);

    if (item) {
      // Skip update for items being deleted - prevents race with cleanup
      if (item.status === "deleting") {
        return null;
      }
      await ctx.db.patch(item._id, {
        cursor: args.cursor,
        status: "active",
        lastSyncedAt: Date.now(),
      });
    }

    return null;
  },
});

// =============================================================================
// SYNC LOCKING - Prevent Race Conditions (Critical Fix)
// =============================================================================

/** Timeout for considering a sync "stuck" (5 minutes) */
const SYNC_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Acquire a sync lock using optimistic locking.
 * Returns the new syncVersion if lock acquired, or null if another sync is in progress.
 *
 * This prevents race conditions where two concurrent syncs could:
 * - Both read the same cursor
 * - Both fetch duplicate transactions
 * - Race to update cursor state
 *
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const acquireSyncLock = internalMutation({
  args: {
    plaidItemId: v.string(),
    expectedVersion: v.optional(v.number()), // Version we expect (for optimistic locking)
  },
  returns: v.union(
    v.object({
      acquired: v.literal(true),
      syncVersion: v.number(),
      cursor: v.optional(v.string()),
      accessToken: v.string(),
      userId: v.string(),
    }),
    v.object({
      acquired: v.literal(false),
      reason: v.string(),
      currentVersion: v.optional(v.number()),
      syncStartedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) {
      return { acquired: false as const, reason: "Item not found" };
    }

    // Reject lock for items being deleted - prevents race with cleanup
    if (item.status === "deleting") {
      return { acquired: false as const, reason: "Item is being deleted" };
    }

    const now = Date.now();
    const currentVersion = item.syncVersion ?? 0;

    // Check if there's an active sync (that hasn't timed out)
    if (item.status === "syncing" && item.syncStartedAt) {
      const syncAge = now - item.syncStartedAt;
      if (syncAge < SYNC_TIMEOUT_MS) {
        return {
          acquired: false as const,
          reason: "Sync already in progress",
          currentVersion,
          syncStartedAt: item.syncStartedAt,
        };
      }
      // Sync has timed out, we can take over
      console.warn(
        `[Plaid Component] Sync timeout detected for ${args.plaidItemId}, taking over`
      );
    }

    // If expectedVersion provided, verify it matches (optimistic lock check)
    if (args.expectedVersion !== undefined && args.expectedVersion !== currentVersion) {
      return {
        acquired: false as const,
        reason: "Version mismatch (concurrent modification)",
        currentVersion,
        syncStartedAt: item.syncStartedAt,
      };
    }

    // Acquire the lock by incrementing version and setting status
    const newVersion = currentVersion + 1;
    await ctx.db.patch(item._id, {
      status: "syncing",
      syncVersion: newVersion,
      syncStartedAt: now,
      syncError: undefined, // Clear previous error
    });

    return {
      acquired: true as const,
      syncVersion: newVersion,
      cursor: item.cursor,
      accessToken: item.accessToken,
      userId: item.userId,
    };
  },
});

/**
 * Complete a sync atomically: update cursor AND store the version we synced with.
 * Fails if another sync has taken over (version mismatch).
 *
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const completeSyncWithVersion = internalMutation({
  args: {
    plaidItemId: v.string(),
    syncVersion: v.number(), // Version we acquired
    cursor: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) {
      return { success: false, reason: "Item not found" };
    }

    // Verify we still hold the lock (version matches)
    if (item.syncVersion !== args.syncVersion) {
      return {
        success: false,
        reason: `Version mismatch: expected ${args.syncVersion}, got ${item.syncVersion}`,
      };
    }

    // Reject completion for items being deleted - prevents race with cleanup
    if (item.status === "deleting") {
      return { success: false, reason: "Item is being deleted" };
    }

    // Complete the sync
    await ctx.db.patch(item._id, {
      cursor: args.cursor,
      status: "active",
      lastSyncedAt: Date.now(),
      syncStartedAt: undefined, // Clear sync start time
    });

    return { success: true };
  },
});

/**
 * Release sync lock on error without updating cursor.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 *
 * W4: when transitioning into an error-class status ("error" or
 * "needs_reauth"), stamp the error-tracking fields the 6-hour persistent-
 * error cron filters on: `firstErrorAt` (monotonic; first-write-wins),
 * `errorAt = now`, and `errorCode` (from the optional arg, falling back
 * to a "SYNC_ERROR" sentinel so the cron can still emit a best-effort
 * dispatch with a visible label).
 */
export const releaseSyncLock = internalMutation({
  args: {
    plaidItemId: v.string(),
    syncVersion: v.number(),
    status: v.string(),
    syncError: v.optional(v.string()),
    errorCode: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) return null;

    // Only release if we still hold the lock
    if (item.syncVersion === args.syncVersion) {
      // Skip update for items being deleted - prevents race with cleanup
      if (item.status === "deleting") {
        return null;
      }

      const patch: Record<string, unknown> = {
        status: args.status as any,
        syncError: args.syncError,
        syncStartedAt: undefined,
      };

      if (args.status === "error" || args.status === "needs_reauth") {
        const now = Date.now();
        if (item.firstErrorAt == null) patch.firstErrorAt = now;
        patch.errorAt = now;
        patch.errorCode = args.errorCode ?? "SYNC_ERROR";
        if (args.syncError != null) patch.errorMessage = args.syncError;
      }

      await ctx.db.patch(item._id, patch);
    }

    return null;
  },
});

/**
 * Mark plaidItem as needing re-authentication.
 * Used by webhook handlers.
 */
export const markNeedsReauth = internalMutation({
  args: {
    itemId: v.string(), // Plaid item_id (not Convex _id)
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("plaidItems")
      .withIndex("by_item_id", (q) => q.eq("itemId", args.itemId))
      .first();

    if (item) {
      await ctx.db.patch(item._id, {
        status: "needs_reauth",
        syncError: args.reason,
      });
    }

    return null;
  },
});

/**
 * Set plaidItem error status.
 * Used by webhook handlers.
 */
export const setItemError = internalMutation({
  args: {
    itemId: v.string(), // Plaid item_id
    errorCode: v.string(),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("plaidItems")
      .withIndex("by_item_id", (q) => q.eq("itemId", args.itemId))
      .first();

    if (item) {
      await ctx.db.patch(item._id, {
        status: "error",
        syncError: `${args.errorCode}: ${args.errorMessage}`,
      });
    }

    return null;
  },
});

// =============================================================================
// CIRCUIT BREAKER - Queries & Mutations
// =============================================================================

/**
 * Get plaidItem with circuit breaker fields.
 * Used by circuit breaker module.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const getPlaidItemWithCircuit = internalQuery({
  args: { plaidItemId: v.string() },
  returns: v.union(
    v.object({
      _id: v.any(),
      circuitState: v.optional(v.string()),
      consecutiveFailures: v.optional(v.number()),
      consecutiveSuccesses: v.optional(v.number()),
      lastFailureAt: v.optional(v.number()),
      nextRetryAt: v.optional(v.number()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    // O(1) lookup using normalizeId + get
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) return null;

    return {
      _id: item._id,
      circuitState: item.circuitState,
      consecutiveFailures: item.consecutiveFailures,
      consecutiveSuccesses: item.consecutiveSuccesses,
      lastFailureAt: item.lastFailureAt,
      nextRetryAt: item.nextRetryAt,
    };
  },
});

/**
 * Update circuit breaker state for a plaidItem.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const updateCircuitState = internalMutation({
  args: {
    plaidItemId: v.string(),
    circuitState: v.optional(
      v.union(v.literal("closed"), v.literal("open"), v.literal("half_open"))
    ),
    consecutiveFailures: v.optional(v.number()),
    consecutiveSuccesses: v.optional(v.number()),
    lastFailureAt: v.optional(v.number()),
    nextRetryAt: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // O(1) lookup using normalizeId + get
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) return null;

    const updates: Record<string, unknown> = {};
    if (args.circuitState !== undefined) updates.circuitState = args.circuitState;
    if (args.consecutiveFailures !== undefined)
      updates.consecutiveFailures = args.consecutiveFailures;
    if (args.consecutiveSuccesses !== undefined)
      updates.consecutiveSuccesses = args.consecutiveSuccesses;
    if (args.lastFailureAt !== undefined) updates.lastFailureAt = args.lastFailureAt;
    if (args.nextRetryAt !== undefined)
      updates.nextRetryAt = args.nextRetryAt === null ? undefined : args.nextRetryAt;

    await ctx.db.patch(item._id, updates);

    return null;
  },
});

/**
 * Reset circuit breaker to closed state.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const resetCircuitBreaker = internalMutation({
  args: { plaidItemId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    // O(1) lookup using normalizeId + get
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) return null;

    await ctx.db.patch(item._id, {
      circuitState: "closed",
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastFailureAt: undefined,
      nextRetryAt: undefined,
    });

    return null;
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Accounts
// =============================================================================

/**
 * Bulk upsert accounts.
 * Creates new accounts or updates existing ones by accountId.
 *
 * Uses safe upsert pattern to handle TOCTOU race conditions where
 * concurrent calls might both try to insert the same account.
 */
export const bulkUpsertAccounts = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    accounts: v.array(accountValidator),
  },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    // Check if item is being deleted before inserting any data - prevents orphan records
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item || item.status === "deleting") {
      return { created: 0, updated: 0 };
    }

    const now = Date.now();
    let created = 0;
    let updated = 0;

    for (const account of args.accounts) {
      const result = await safeUpsertWithDedup(
        ctx,
        // Query for existing record
        () =>
          ctx.db
            .query("plaidAccounts")
            .withIndex("by_account_id", (q) => q.eq("accountId", account.accountId))
            .first(),
        // Query for ALL matching records (for duplicate detection)
        () =>
          ctx.db
            .query("plaidAccounts")
            .withIndex("by_account_id", (q) => q.eq("accountId", account.accountId))
            .collect(),
        // Insert function
        async () => {
          const id = await ctx.db.insert("plaidAccounts", {
            userId: args.userId,
            plaidItemId: args.plaidItemId,
            ...account,
            createdAt: now,
          });
          return String(id);
        },
        // Update function
        async (id) => {
          await ctx.db.patch(id, {
            name: account.name,
            officialName: account.officialName,
            mask: account.mask,
            type: account.type,
            subtype: account.subtype,
            balances: account.balances,
          });
        }
      );

      if (result.created) {
        created++;
      } else {
        updated++;
      }
    }

    return { created, updated };
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Transactions
// =============================================================================

/**
 * Bulk upsert transactions.
 * Handles added, modified, and removed transactions from sync.
 *
 * OPTIMIZATION: Uses batch query pattern to avoid N+1 queries.
 * Instead of querying for each modified/removed transaction individually,
 * we fetch all existing transactions for this item upfront and use a Map
 * for O(1) lookups. This reduces query count from O(n) to O(1).
 */
export const bulkUpsertTransactions = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    added: v.array(transactionValidator),
    modified: v.array(transactionValidator),
    removed: v.array(v.string()),
  },
  returns: v.object({
    added: v.number(),
    modified: v.number(),
    removed: v.number(),
  }),
  handler: async (ctx, args) => {
    // Check if item is being deleted before inserting any data - prevents orphan records
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item || item.status === "deleting") {
      return { added: 0, modified: 0, removed: 0 };
    }

    const now = Date.now();

    // Batch query and group by Plaid transactionId. Replayed sync cursors and
    // older duplicate rows are reconciled to one survivor per transactionId.
    const existingTransactions = await ctx.db
      .query("plaidTransactions")
      .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .collect() as StoredTransactionDoc[];

    const transactionIdToDocs = new Map<string, StoredTransactionDoc[]>();
    for (const transaction of existingTransactions) {
      const docs = transactionIdToDocs.get(transaction.transactionId) ?? [];
      docs.push(transaction);
      transactionIdToDocs.set(transaction.transactionId, docs);
    }

    let addedCount = 0;
    let modifiedCount = 0;

    const upsertTransaction = async (txn: TransactionInput) => {
      const existingDocs = transactionIdToDocs.get(txn.transactionId) ?? [];
      const transactionDoc = await prepareTransactionDocument(ctx, txn);
      const survivor = await removeDuplicateTransactionRows(ctx, existingDocs);

      if (survivor) {
        await ctx.db.patch(survivor._id, {
          userId: args.userId,
          plaidItemId: args.plaidItemId,
          ...transactionDoc,
          updatedAt: now,
        });
        transactionIdToDocs.set(txn.transactionId, [survivor]);
        return "updated" as const;
      }

      const id = await ctx.db.insert("plaidTransactions", {
        userId: args.userId,
        plaidItemId: args.plaidItemId,
        ...transactionDoc,
        createdAt: now,
      });
      const inserted = await ctx.db.get(id);
      if (inserted) {
        transactionIdToDocs.set(txn.transactionId, [inserted as StoredTransactionDoc]);
      }
      return "created" as const;
    };

    for (const txn of args.added) {
      const result = await upsertTransaction(txn);
      if (result === "created") {
        addedCount++;
      } else {
        modifiedCount++;
      }
    }

    // Modified rows are also upserted so replay or out-of-order Plaid pages do
    // not drop updates when the original "added" row is absent.
    for (const txn of args.modified) {
      const result = await upsertTransaction(txn);
      if (result === "created") {
        addedCount++;
      } else {
        modifiedCount++;
      }
    }

    let removedCount = 0;
    for (const transactionId of args.removed) {
      const transactions = transactionIdToDocs.get(transactionId) ?? [];
      for (const transaction of transactions) {
        await ctx.db.delete(transaction._id);
      }
      removedCount += transactions.length;
      transactionIdToDocs.delete(transactionId);
    }

    return {
      added: addedCount,
      modified: modifiedCount,
      removed: removedCount,
    };
  },
});

/**
 * Backfill merchant enrichment fields for existing transaction rows.
 *
 * This intentionally does not insert missing transactions or touch item cursors.
 * It is meant for one-time recovery when historical transactions were synced
 * before merchant/logo fields were persisted.
 */
export const backfillTransactionEnrichments = internalMutation({
  args: {
    plaidItemId: v.string(),
    transactions: v.array(transactionValidator),
  },
  returns: v.object({
    scanned: v.number(),
    matched: v.number(),
    updated: v.number(),
    merchantsUpserted: v.number(),
  }),
  handler: async (ctx, args) => {
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item || item.status === "deleting") {
      return {
        scanned: args.transactions.length,
        matched: 0,
        updated: 0,
        merchantsUpserted: 0,
      };
    }

    const existingTransactions = await ctx.db
      .query("plaidTransactions")
      .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .collect();
    const transactionIdToDoc = new Map(
      existingTransactions.map((transaction) => [transaction.transactionId, transaction])
    );

    let matched = 0;
    let updated = 0;
    let merchantsUpserted = 0;
    const now = Date.now();

    for (const transaction of args.transactions) {
      const existingTransaction = transactionIdToDoc.get(transaction.transactionId);
      if (!existingTransaction) continue;

      matched++;
      const { merchantEnrichment, transactionDoc } = splitTransactionForStorage(transaction);
      if (!merchantEnrichment || !transactionDoc.merchantId) continue;

      await upsertMerchantEnrichmentRecord(ctx, merchantEnrichment);
      merchantsUpserted++;

      await ctx.db.patch(existingTransaction._id, {
        merchantId: transactionDoc.merchantId,
        enrichmentData: transactionDoc.enrichmentData,
        updatedAt: now,
      });
      updated++;
    }

    return {
      scanned: args.transactions.length,
      matched,
      updated,
      merchantsUpserted,
    };
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Liabilities
// =============================================================================

/**
 * Upsert credit card liability.
 * Creates or updates by accountId.
 *
 * Uses safe upsert pattern to handle TOCTOU race conditions where
 * concurrent calls might both try to insert the same liability.
 */
export const upsertCreditCardLiability = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    accountId: v.string(),
    aprs: v.array(aprValidator),
    isOverdue: v.boolean(),
    lastPaymentAmount: v.optional(v.number()),
    lastPaymentDate: v.optional(v.string()),
    lastStatementBalance: v.optional(v.number()),
    lastStatementIssueDate: v.optional(v.string()),
    minimumPaymentAmount: v.optional(v.number()),
    nextPaymentDueDate: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    // Check if item is being deleted before inserting any data - prevents orphan records
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item || item.status === "deleting") {
      return "";
    }

    const now = Date.now();

    const result = await safeUpsertWithDedup(
      ctx,
      // Query for existing record
      () =>
        ctx.db
          .query("plaidCreditCardLiabilities")
          .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
          .first(),
      // Query for ALL matching records (for duplicate detection)
      () =>
        ctx.db
          .query("plaidCreditCardLiabilities")
          .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
          .collect(),
      // Insert function
      async () => {
        const id = await ctx.db.insert("plaidCreditCardLiabilities", {
          userId: args.userId,
          plaidItemId: args.plaidItemId,
          accountId: args.accountId,
          aprs: args.aprs,
          isOverdue: args.isOverdue,
          lastPaymentAmount: args.lastPaymentAmount,
          lastPaymentDate: args.lastPaymentDate,
          lastStatementBalance: args.lastStatementBalance,
          lastStatementIssueDate: args.lastStatementIssueDate,
          minimumPaymentAmount: args.minimumPaymentAmount,
          nextPaymentDueDate: args.nextPaymentDueDate,
          createdAt: now,
          updatedAt: now,
        });
        return String(id);
      },
      // Update function
      async (id) => {
        await ctx.db.patch(id, {
          aprs: args.aprs,
          isOverdue: args.isOverdue,
          lastPaymentAmount: args.lastPaymentAmount,
          lastPaymentDate: args.lastPaymentDate,
          lastStatementBalance: args.lastStatementBalance,
          lastStatementIssueDate: args.lastStatementIssueDate,
          minimumPaymentAmount: args.minimumPaymentAmount,
          nextPaymentDueDate: args.nextPaymentDueDate,
          updatedAt: now,
        });
      }
    );

    return result.id;
  },
});

const creditCardLiabilityValidator = v.object({
  accountId: v.string(),
  aprs: v.array(aprValidator),
  isOverdue: v.boolean(),
  lastPaymentAmount: v.optional(v.number()),
  lastPaymentDate: v.optional(v.string()),
  lastStatementBalance: v.optional(v.number()),
  lastStatementIssueDate: v.optional(v.string()),
  minimumPaymentAmount: v.optional(v.number()),
  nextPaymentDueDate: v.optional(v.string()),
});

/**
 * Bulk upsert credit card liabilities.
 * Creates or updates by accountId in a single mutation.
 * Uses safe upsert pattern to handle TOCTOU race conditions.
 */
export const bulkUpsertCreditCardLiabilities = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    creditCards: v.array(creditCardLiabilityValidator),
  },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let created = 0;
    let updated = 0;

    for (const card of args.creditCards) {
      const result = await safeUpsertWithDedup(
        ctx,
        // Query for existing record
        () =>
          ctx.db
            .query("plaidCreditCardLiabilities")
            .withIndex("by_account", (q) => q.eq("accountId", card.accountId))
            .first(),
        // Query for ALL matching records (for duplicate detection)
        () =>
          ctx.db
            .query("plaidCreditCardLiabilities")
            .withIndex("by_account", (q) => q.eq("accountId", card.accountId))
            .collect(),
        // Insert function
        async () => {
          const id = await ctx.db.insert("plaidCreditCardLiabilities", {
            userId: args.userId,
            plaidItemId: args.plaidItemId,
            accountId: card.accountId,
            aprs: card.aprs,
            isOverdue: card.isOverdue,
            lastPaymentAmount: card.lastPaymentAmount,
            lastPaymentDate: card.lastPaymentDate,
            lastStatementBalance: card.lastStatementBalance,
            lastStatementIssueDate: card.lastStatementIssueDate,
            minimumPaymentAmount: card.minimumPaymentAmount,
            nextPaymentDueDate: card.nextPaymentDueDate,
            createdAt: now,
            updatedAt: now,
          });
          return String(id);
        },
        // Update function
        async (id) => {
          await ctx.db.patch(id, {
            aprs: card.aprs,
            isOverdue: card.isOverdue,
            lastPaymentAmount: card.lastPaymentAmount,
            lastPaymentDate: card.lastPaymentDate,
            lastStatementBalance: card.lastStatementBalance,
            lastStatementIssueDate: card.lastStatementIssueDate,
            minimumPaymentAmount: card.minimumPaymentAmount,
            nextPaymentDueDate: card.nextPaymentDueDate,
            updatedAt: now,
          });
        }
      );

      if (result.created) {
        created++;
      } else {
        updated++;
      }
    }

    return { created, updated };
  },
});

// =============================================================================
// WEBHOOK HELPERS
// =============================================================================

/**
 * Schedule a sync operation (placeholder for Phase 2).
 * In Phase 2, this would schedule a background job.
 */
export const scheduleSync = internalMutation({
  args: {
    itemId: v.string(),
    syncType: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    console.log(
      `[Plaid Component] Scheduled ${args.syncType} sync for item ${args.itemId}`
    );
    // Phase 2: Implement actual scheduling
    return null;
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Item Deactivation
// =============================================================================

/**
 * Deactivate a plaidItem (for USER_PERMISSION_REVOKED webhook).
 * Marks item as inactive but keeps data for audit trail.
 */
export const deactivateItem = internalMutation({
  args: {
    itemId: v.string(), // Plaid item_id
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("plaidItems")
      .withIndex("by_item_id", (q) => q.eq("itemId", args.itemId))
      .first();

    if (item) {
      await ctx.db.patch(item._id, {
        status: "error",
        syncError: `Deactivated: ${args.reason}`,
      });
    }

    return null;
  },
});

/**
 * Recursively delete data associated with a plaidItem in batches.
 *
 * This is the worker mutation scheduled by deletePlaidItem.
 * It deletes data in configurable batch sizes to avoid mutation timeouts.
 * If more data remains after a batch, it schedules itself to continue.
 *
 * Deletion order:
 * 1. Transactions (usually largest collection)
 * 2. Accounts
 * 3. Credit card liabilities
 * 4. Mortgage liabilities
 * 5. Student loan liabilities
 * 6. Recurring streams
 * 7. The plaidItem itself (final step)
 */
export const cleanupDeletedItem = internalMutation({
  args: {
    plaidItemId: v.string(),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    status: v.union(v.literal("in_progress"), v.literal("complete")),
    deleted: v.number(),
    collection: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 500;
    let totalDeleted = 0;

    // Delete transactions first (usually the largest collection)
    const transactions = await ctx.db
      .query("plaidTransactions")
      .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .take(batchSize);

    if (transactions.length > 0) {
      for (const txn of transactions) {
        await ctx.db.delete(txn._id);
      }
      totalDeleted += transactions.length;

      // If we hit the batch limit, there may be more - schedule next batch
      if (transactions.length >= batchSize) {
        await ctx.scheduler.runAfter(0, internal.private.cleanupDeletedItem, args);
        return {
          status: "in_progress" as const,
          deleted: totalDeleted,
          collection: "transactions",
        };
      }
    }

    // Delete accounts
    const accounts = await ctx.db
      .query("plaidAccounts")
      .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .take(batchSize);

    if (accounts.length > 0) {
      for (const acc of accounts) {
        await ctx.db.delete(acc._id);
      }
      totalDeleted += accounts.length;

      if (accounts.length >= batchSize) {
        await ctx.scheduler.runAfter(0, internal.private.cleanupDeletedItem, args);
        return {
          status: "in_progress" as const,
          deleted: totalDeleted,
          collection: "accounts",
        };
      }
    }

    // Delete credit card liabilities
    const creditCards = await ctx.db
      .query("plaidCreditCardLiabilities")
      .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .take(batchSize);

    if (creditCards.length > 0) {
      for (const cc of creditCards) {
        await ctx.db.delete(cc._id);
      }
      totalDeleted += creditCards.length;

      if (creditCards.length >= batchSize) {
        await ctx.scheduler.runAfter(0, internal.private.cleanupDeletedItem, args);
        return {
          status: "in_progress" as const,
          deleted: totalDeleted,
          collection: "creditCardLiabilities",
        };
      }
    }

    // Delete mortgage liabilities
    const mortgages = await ctx.db
      .query("plaidMortgageLiabilities")
      .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .take(batchSize);

    if (mortgages.length > 0) {
      for (const m of mortgages) {
        await ctx.db.delete(m._id);
      }
      totalDeleted += mortgages.length;

      if (mortgages.length >= batchSize) {
        await ctx.scheduler.runAfter(0, internal.private.cleanupDeletedItem, args);
        return {
          status: "in_progress" as const,
          deleted: totalDeleted,
          collection: "mortgageLiabilities",
        };
      }
    }

    // Delete student loan liabilities
    const studentLoans = await ctx.db
      .query("plaidStudentLoanLiabilities")
      .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .take(batchSize);

    if (studentLoans.length > 0) {
      for (const sl of studentLoans) {
        await ctx.db.delete(sl._id);
      }
      totalDeleted += studentLoans.length;

      if (studentLoans.length >= batchSize) {
        await ctx.scheduler.runAfter(0, internal.private.cleanupDeletedItem, args);
        return {
          status: "in_progress" as const,
          deleted: totalDeleted,
          collection: "studentLoanLiabilities",
        };
      }
    }

    // Delete recurring streams
    const streams = await ctx.db
      .query("plaidRecurringStreams")
      .withIndex("by_plaid_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .take(batchSize);

    if (streams.length > 0) {
      for (const s of streams) {
        await ctx.db.delete(s._id);
      }
      totalDeleted += streams.length;

      if (streams.length >= batchSize) {
        await ctx.scheduler.runAfter(0, internal.private.cleanupDeletedItem, args);
        return {
          status: "in_progress" as const,
          deleted: totalDeleted,
          collection: "recurringStreams",
        };
      }
    }

    // Finally, delete the plaidItem itself
    const items = await ctx.db.query("plaidItems").collect();
    const item = items.find((i) => String(i._id) === args.plaidItemId);

    if (item) {
      await ctx.db.delete(item._id);
      totalDeleted += 1;
    }

    console.log(
      `[Plaid Cleanup] Completed deletion of item ${args.plaidItemId}, ` +
        `total deleted: ${totalDeleted}`
    );

    return {
      status: "complete" as const,
      deleted: totalDeleted,
    };
  },
});

// =============================================================================
// INTERNAL QUERIES - For Cron Jobs
// =============================================================================

/**
 * Get all active plaidItems for scheduled sync.
 * Returns items that are in 'active' status.
 */
export const getAllActiveItems = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.string(),
      userId: v.string(),
      itemId: v.string(),
      accessToken: v.string(),
      cursor: v.optional(v.string()),
      lastSyncedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx) => {
    const items = await ctx.db
      .query("plaidItems")
      .collect();

    // Filter for active items
    const activeItems = items.filter((item) => item.status === "active");

    return activeItems.map((item) => ({
      _id: String(item._id),
      userId: item.userId,
      itemId: item.itemId,
      accessToken: item.accessToken,
      cursor: item.cursor,
      lastSyncedAt: item.lastSyncedAt,
    }));
  },
});

/**
 * Get items that need sync (haven't synced in specified hours).
 */
export const getItemsNeedingSync = internalQuery({
  args: {
    maxAgeHours: v.optional(v.number()), // Default 24 hours
  },
  returns: v.array(
    v.object({
      _id: v.string(),
      userId: v.string(),
      itemId: v.string(),
      accessToken: v.string(),
      cursor: v.optional(v.string()),
      lastSyncedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const maxAgeMs = (args.maxAgeHours ?? 24) * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAgeMs;

    const items = await ctx.db
      .query("plaidItems")
      .collect();

    // Filter for active items that need sync
    const needingSync = items.filter((item) => {
      if (item.status !== "active") return false;
      if (!item.lastSyncedAt) return true; // Never synced
      return item.lastSyncedAt < cutoff;
    });

    return needingSync.map((item) => ({
      _id: String(item._id),
      userId: item.userId,
      itemId: item.itemId,
      accessToken: item.accessToken,
      cursor: item.cursor,
      lastSyncedAt: item.lastSyncedAt,
    }));
  },
});

/**
 * Get a single item by ID with its access token.
 * Used by syncSingleItem to fetch item details for fan-out sync.
 */
export const getItemWithToken = internalQuery({
  args: {
    plaidItemId: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.string(),
      userId: v.string(),
      itemId: v.string(),
      accessToken: v.string(),
      cursor: v.optional(v.string()),
      lastSyncedAt: v.optional(v.number()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("plaidItems")
      .filter((q) => q.eq(q.field("_id"), args.plaidItemId as any))
      .first();

    if (!item) return null;

    // Only return if item is active
    if (item.status !== "active") return null;

    return {
      _id: String(item._id),
      userId: item.userId,
      itemId: item.itemId,
      accessToken: item.accessToken,
      cursor: item.cursor,
      lastSyncedAt: item.lastSyncedAt,
    };
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Recurring Streams
// =============================================================================

/**
 * Bulk upsert recurring streams.
 * Creates or updates by streamId.
 *
 * Uses safe upsert pattern to handle TOCTOU race conditions where
 * concurrent calls might both try to insert the same stream.
 */
export const bulkUpsertRecurringStreams = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    streams: v.array(recurringStreamValidator),
  },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    // Check if item is being deleted before inserting any data - prevents orphan records
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item || item.status === "deleting") {
      return { created: 0, updated: 0 };
    }

    const now = Date.now();
    let created = 0;
    let updated = 0;

    for (const stream of args.streams) {
      const result = await safeUpsertWithDedup(
        ctx,
        // Query for existing record
        () =>
          ctx.db
            .query("plaidRecurringStreams")
            .withIndex("by_stream_id", (q) => q.eq("streamId", stream.streamId))
            .first(),
        // Query for ALL matching records (for duplicate detection)
        () =>
          ctx.db
            .query("plaidRecurringStreams")
            .withIndex("by_stream_id", (q) => q.eq("streamId", stream.streamId))
            .collect(),
        // Insert function
        async () => {
          const id = await ctx.db.insert("plaidRecurringStreams", {
            userId: args.userId,
            plaidItemId: args.plaidItemId,
            streamId: stream.streamId,
            accountId: stream.accountId,
            description: stream.description,
            merchantName: stream.merchantName,
            averageAmount: stream.averageAmount,
            lastAmount: stream.lastAmount,
            isoCurrencyCode: stream.isoCurrencyCode,
            frequency: stream.frequency,
            status: stream.status,
            isActive: stream.isActive,
            type: stream.type,
            category: stream.category,
            firstDate: stream.firstDate,
            lastDate: stream.lastDate,
            predictedNextDate: stream.predictedNextDate,
            createdAt: now,
            updatedAt: now,
          });
          return String(id);
        },
        // Update function
        async (id) => {
          await ctx.db.patch(id, {
            description: stream.description,
            merchantName: stream.merchantName,
            averageAmount: stream.averageAmount,
            lastAmount: stream.lastAmount,
            isoCurrencyCode: stream.isoCurrencyCode,
            frequency: stream.frequency,
            status: stream.status,
            isActive: stream.isActive,
            type: stream.type,
            category: stream.category,
            firstDate: stream.firstDate,
            lastDate: stream.lastDate,
            predictedNextDate: stream.predictedNextDate,
            updatedAt: now,
          });
        }
      );

      if (result.created) {
        created++;
      } else {
        updated++;
      }
    }

    return { created, updated };
  },
});

/**
 * Mark streams as tombstoned for a plaidItem.
 * Used when streams are removed during sync.
 */
export const tombstoneStreams = internalMutation({
  args: {
    plaidItemId: v.string(),
    streamIds: v.array(v.string()),
  },
  returns: v.object({ tombstoned: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let tombstoned = 0;

    for (const streamId of args.streamIds) {
      const existing = await ctx.db
        .query("plaidRecurringStreams")
        .withIndex("by_stream_id", (q) => q.eq("streamId", streamId))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          status: "TOMBSTONED",
          isActive: false,
          updatedAt: now,
        });
        tombstoned++;
      }
    }

    return { tombstoned };
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Mortgage Liabilities
// =============================================================================

const addressValidator = v.object({
  street: v.optional(v.string()),
  city: v.optional(v.string()),
  region: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  country: v.optional(v.string()),
});

/**
 * Upsert mortgage liability by accountId.
 *
 * Uses safe upsert pattern to handle TOCTOU race conditions where
 * concurrent calls might both try to insert the same liability.
 */
export const upsertMortgageLiability = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    accountId: v.string(),
    accountNumber: v.optional(v.string()),
    loanTerm: v.optional(v.string()),
    loanTypeDescription: v.optional(v.string()),
    originationDate: v.optional(v.string()),
    maturityDate: v.optional(v.string()),
    interestRatePercentage: v.number(),
    interestRateType: v.optional(v.string()),
    lastPaymentAmount: v.optional(v.number()),
    lastPaymentDate: v.optional(v.string()),
    nextMonthlyPayment: v.optional(v.number()),
    nextPaymentDueDate: v.optional(v.string()),
    originationPrincipalAmount: v.optional(v.number()),
    currentLateFee: v.optional(v.number()),
    escrowBalance: v.optional(v.number()),
    pastDueAmount: v.optional(v.number()),
    ytdInterestPaid: v.optional(v.number()),
    ytdPrincipalPaid: v.optional(v.number()),
    hasPmi: v.optional(v.boolean()),
    hasPrepaymentPenalty: v.optional(v.boolean()),
    propertyAddress: v.optional(addressValidator),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    // Check if item is being deleted before inserting any data - prevents orphan records
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item || item.status === "deleting") {
      return "";
    }

    const now = Date.now();

    const result = await safeUpsertWithDedup(
      ctx,
      // Query for existing record
      () =>
        ctx.db
          .query("plaidMortgageLiabilities")
          .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
          .first(),
      // Query for ALL matching records (for duplicate detection)
      () =>
        ctx.db
          .query("plaidMortgageLiabilities")
          .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
          .collect(),
      // Insert function
      async () => {
        const id = await ctx.db.insert("plaidMortgageLiabilities", {
          ...args,
          createdAt: now,
          updatedAt: now,
        });
        return String(id);
      },
      // Update function
      async (id) => {
        await ctx.db.patch(id, {
          ...args,
          updatedAt: now,
        });
      }
    );

    return result.id;
  },
});

const mortgageLiabilityValidator = v.object({
  accountId: v.string(),
  accountNumber: v.optional(v.string()),
  loanTerm: v.optional(v.string()),
  loanTypeDescription: v.optional(v.string()),
  originationDate: v.optional(v.string()),
  maturityDate: v.optional(v.string()),
  interestRatePercentage: v.number(),
  interestRateType: v.optional(v.string()),
  lastPaymentAmount: v.optional(v.number()),
  lastPaymentDate: v.optional(v.string()),
  nextMonthlyPayment: v.optional(v.number()),
  nextPaymentDueDate: v.optional(v.string()),
  originationPrincipalAmount: v.optional(v.number()),
  currentLateFee: v.optional(v.number()),
  escrowBalance: v.optional(v.number()),
  pastDueAmount: v.optional(v.number()),
  ytdInterestPaid: v.optional(v.number()),
  ytdPrincipalPaid: v.optional(v.number()),
  hasPmi: v.optional(v.boolean()),
  hasPrepaymentPenalty: v.optional(v.boolean()),
  propertyAddress: v.optional(addressValidator),
});

/**
 * Bulk upsert mortgage liabilities.
 * Creates or updates by accountId in a single mutation.
 * Uses safe upsert pattern to handle TOCTOU race conditions.
 */
export const bulkUpsertMortgageLiabilities = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    mortgages: v.array(mortgageLiabilityValidator),
  },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let created = 0;
    let updated = 0;

    for (const mortgage of args.mortgages) {
      const result = await safeUpsertWithDedup(
        ctx,
        // Query for existing record
        () =>
          ctx.db
            .query("plaidMortgageLiabilities")
            .withIndex("by_account", (q) => q.eq("accountId", mortgage.accountId))
            .first(),
        // Query for ALL matching records (for duplicate detection)
        () =>
          ctx.db
            .query("plaidMortgageLiabilities")
            .withIndex("by_account", (q) => q.eq("accountId", mortgage.accountId))
            .collect(),
        // Insert function
        async () => {
          const id = await ctx.db.insert("plaidMortgageLiabilities", {
            userId: args.userId,
            plaidItemId: args.plaidItemId,
            ...mortgage,
            createdAt: now,
            updatedAt: now,
          });
          return String(id);
        },
        // Update function
        async (id) => {
          await ctx.db.patch(id, {
            ...mortgage,
            updatedAt: now,
          });
        }
      );

      if (result.created) {
        created++;
      } else {
        updated++;
      }
    }

    return { created, updated };
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Student Loan Liabilities
// =============================================================================

const loanStatusValidator = v.object({
  type: v.optional(v.string()),
  endDate: v.optional(v.string()),
});

const repaymentPlanValidator = v.object({
  type: v.optional(v.string()),
  description: v.optional(v.string()),
});

/**
 * Upsert student loan liability by accountId.
 *
 * Uses safe upsert pattern to handle TOCTOU race conditions where
 * concurrent calls might both try to insert the same liability.
 */
export const upsertStudentLoanLiability = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    accountId: v.string(),
    accountNumber: v.optional(v.string()),
    loanName: v.optional(v.string()),
    guarantor: v.optional(v.string()),
    sequenceNumber: v.optional(v.string()),
    disbursementDates: v.optional(v.array(v.string())),
    originationDate: v.optional(v.string()),
    expectedPayoffDate: v.optional(v.string()),
    lastStatementIssueDate: v.optional(v.string()),
    interestRatePercentage: v.number(),
    lastPaymentAmount: v.optional(v.number()),
    lastPaymentDate: v.optional(v.string()),
    minimumPaymentAmount: v.optional(v.number()),
    nextPaymentDueDate: v.optional(v.string()),
    paymentReferenceNumber: v.optional(v.string()),
    originationPrincipalAmount: v.optional(v.number()),
    outstandingInterestAmount: v.optional(v.number()),
    lastStatementBalance: v.optional(v.number()),
    ytdInterestPaid: v.optional(v.number()),
    ytdPrincipalPaid: v.optional(v.number()),
    isOverdue: v.optional(v.boolean()),
    loanStatus: v.optional(loanStatusValidator),
    repaymentPlan: v.optional(repaymentPlanValidator),
    servicerAddress: v.optional(addressValidator),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    // Check if item is being deleted before inserting any data - prevents orphan records
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item || item.status === "deleting") {
      return "";
    }

    const now = Date.now();

    const result = await safeUpsertWithDedup(
      ctx,
      // Query for existing record
      () =>
        ctx.db
          .query("plaidStudentLoanLiabilities")
          .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
          .first(),
      // Query for ALL matching records (for duplicate detection)
      () =>
        ctx.db
          .query("plaidStudentLoanLiabilities")
          .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
          .collect(),
      // Insert function
      async () => {
        const id = await ctx.db.insert("plaidStudentLoanLiabilities", {
          ...args,
          createdAt: now,
          updatedAt: now,
        });
        return String(id);
      },
      // Update function
      async (id) => {
        await ctx.db.patch(id, {
          ...args,
          updatedAt: now,
        });
      }
    );

    return result.id;
  },
});

const studentLoanLiabilityValidator = v.object({
  accountId: v.string(),
  accountNumber: v.optional(v.string()),
  loanName: v.optional(v.string()),
  guarantor: v.optional(v.string()),
  sequenceNumber: v.optional(v.string()),
  disbursementDates: v.optional(v.array(v.string())),
  originationDate: v.optional(v.string()),
  expectedPayoffDate: v.optional(v.string()),
  lastStatementIssueDate: v.optional(v.string()),
  interestRatePercentage: v.number(),
  lastPaymentAmount: v.optional(v.number()),
  lastPaymentDate: v.optional(v.string()),
  minimumPaymentAmount: v.optional(v.number()),
  nextPaymentDueDate: v.optional(v.string()),
  paymentReferenceNumber: v.optional(v.string()),
  originationPrincipalAmount: v.optional(v.number()),
  outstandingInterestAmount: v.optional(v.number()),
  lastStatementBalance: v.optional(v.number()),
  ytdInterestPaid: v.optional(v.number()),
  ytdPrincipalPaid: v.optional(v.number()),
  isOverdue: v.optional(v.boolean()),
  loanStatus: v.optional(loanStatusValidator),
  repaymentPlan: v.optional(repaymentPlanValidator),
  servicerAddress: v.optional(addressValidator),
});

/**
 * Bulk upsert student loan liabilities.
 * Creates or updates by accountId in a single mutation.
 * Uses safe upsert pattern to handle TOCTOU race conditions.
 */
export const bulkUpsertStudentLoanLiabilities = internalMutation({
  args: {
    userId: v.string(),
    plaidItemId: v.string(),
    studentLoans: v.array(studentLoanLiabilityValidator),
  },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let created = 0;
    let updated = 0;

    for (const loan of args.studentLoans) {
      const result = await safeUpsertWithDedup(
        ctx,
        // Query for existing record
        () =>
          ctx.db
            .query("plaidStudentLoanLiabilities")
            .withIndex("by_account", (q) => q.eq("accountId", loan.accountId))
            .first(),
        // Query for ALL matching records (for duplicate detection)
        () =>
          ctx.db
            .query("plaidStudentLoanLiabilities")
            .withIndex("by_account", (q) => q.eq("accountId", loan.accountId))
            .collect(),
        // Insert function
        async () => {
          const id = await ctx.db.insert("plaidStudentLoanLiabilities", {
            userId: args.userId,
            plaidItemId: args.plaidItemId,
            ...loan,
            createdAt: now,
            updatedAt: now,
          });
          return String(id);
        },
        // Update function
        async (id) => {
          await ctx.db.patch(id, {
            ...loan,
            updatedAt: now,
          });
        }
      );

      if (result.created) {
        created++;
      } else {
        updated++;
      }
    }

    return { created, updated };
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Merchant Enrichment
// =============================================================================

/**
 * Upsert merchant enrichment by merchantId.
 * Shared across all users.
 *
 * Uses safe upsert pattern to handle TOCTOU race conditions where
 * concurrent calls might both try to insert the same merchant enrichment.
 */
export const upsertMerchantEnrichment = internalMutation({
  args: {
    merchantId: v.string(),
    merchantName: v.string(),
    logoUrl: v.optional(v.string()),
    categoryPrimary: v.optional(v.string()),
    categoryDetailed: v.optional(v.string()),
    categoryIconUrl: v.optional(v.string()),
    website: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    confidenceLevel: confidenceLevelValidator,
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await upsertMerchantEnrichmentRecord(ctx, args);
  },
});

/**
 * Link transaction to merchant by updating merchantId field.
 */
export const linkTransactionToMerchant = internalMutation({
  args: {
    transactionId: v.string(),
    merchantId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const transaction = await ctx.db
      .query("plaidTransactions")
      .withIndex("by_transaction_id", (q) =>
        q.eq("transactionId", args.transactionId)
      )
      .first();

    if (!transaction) return false;

    await ctx.db.patch(transaction._id, {
      merchantId: args.merchantId,
      updatedAt: Date.now(),
    });

    return true;
  },
});

/**
 * Update transaction with enrichment data.
 */
export const updateTransactionEnrichment = internalMutation({
  args: {
    transactionId: v.string(),
    merchantId: v.optional(v.string()),
    enrichmentData: v.object({
      counterpartyName: v.optional(v.string()),
      counterpartyType: v.optional(v.string()),
      counterpartyEntityId: v.optional(v.string()),
      counterpartyConfidence: v.optional(v.string()),
      counterpartyLogoUrl: v.optional(v.string()),
      counterpartyWebsite: v.optional(v.string()),
      counterpartyPhoneNumber: v.optional(v.string()),
      enrichedAt: v.optional(v.number()),
    }),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const transaction = await ctx.db
      .query("plaidTransactions")
      .withIndex("by_transaction_id", (q) =>
        q.eq("transactionId", args.transactionId)
      )
      .first();

    if (!transaction) return false;

    await ctx.db.patch(transaction._id, {
      merchantId: args.merchantId,
      enrichmentData: args.enrichmentData,
      updatedAt: Date.now(),
    });

    return true;
  },
});

// =============================================================================
// INTERNAL MUTATIONS - Webhook Logs
// =============================================================================

/**
 * Create a webhook log entry.
 */
export const createWebhookLog = internalMutation({
  args: {
    webhookId: v.string(),
    itemId: v.string(),
    webhookType: v.string(),
    webhookCode: v.string(),
    bodyHash: v.string(),
    receivedAt: v.number(),
    status: v.union(
      v.literal("received"),
      v.literal("processing"),
      v.literal("processed"),
      v.literal("duplicate"),
      v.literal("failed")
    ),
    errorMessage: v.optional(v.string()),
    scheduledFunctionId: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("webhookLogs", args);
    return String(id);
  },
});

/**
 * Update webhook log status.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const updateWebhookLogStatus = internalMutation({
  args: {
    webhookLogId: v.string(),
    status: v.union(
      v.literal("received"),
      v.literal("processing"),
      v.literal("processed"),
      v.literal("duplicate"),
      v.literal("failed")
    ),
    processedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    scheduledFunctionId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // O(1) lookup using normalizeId + get
    const id = ctx.db.normalizeId("webhookLogs", args.webhookLogId);
    if (!id) return null;
    const log = await ctx.db.get(id);
    if (!log) return null;

    await ctx.db.patch(log._id, {
      status: args.status,
      processedAt: args.processedAt,
      errorMessage: args.errorMessage,
      scheduledFunctionId: args.scheduledFunctionId,
    });

    return null;
  },
});

/**
 * Find recent webhook by body hash (for deduplication).
 */
export const findRecentByHash = internalQuery({
  args: {
    bodyHash: v.string(),
    windowMs: v.number(),
  },
  returns: v.union(
    v.object({
      _id: v.string(),
      webhookId: v.string(),
      status: v.string(),
      receivedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.windowMs;

    const matches = await ctx.db
      .query("webhookLogs")
      .withIndex("by_body_hash_received_at", (q) =>
        q.eq("bodyHash", args.bodyHash).gte("receivedAt", cutoff)
      )
      .order("desc")
      .take(10);

    // Only in-flight receipts are deduped. Completed matching payloads can be
    // legitimate repeated Plaid events and should still schedule fresh work.
    const recent = matches.find(
      (log) => log.status === "received" || log.status === "processing"
    );

    if (!recent) return null;

    return {
      _id: String(recent._id),
      webhookId: recent.webhookId,
      status: recent.status,
      receivedAt: recent.receivedAt,
    };
  },
});

// =============================================================================
// WEBHOOK LOG CLEANUP
// =============================================================================

/**
 * Prune old webhook logs to prevent table growth.
 *
 * Deletes logs older than the specified retention period (default: 24 hours).
 * Call this from a scheduled function (cron) to keep the table size manageable.
 *
 * Example cron setup in host app:
 * ```typescript
 * // convex/crons.ts
 * import { cronJobs } from "convex/server";
 * import { components } from "./_generated/api";
 *
 * const crons = cronJobs();
 * crons.hourly("prune-webhook-logs", { minuteUTC: 0 }, components.plaid.private.pruneOldWebhookLogs);
 * export default crons;
 * ```
 */
export const pruneOldWebhookLogs = internalMutation({
  args: {
    /** Retention period in milliseconds (default: 24 hours) */
    retentionMs: v.optional(v.number()),
    /** Maximum logs to delete per call (default: 100, prevents timeout) */
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    deleted: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const retentionMs = args.retentionMs ?? 24 * 60 * 60 * 1000; // 24 hours
    const batchSize = args.batchSize ?? 100;
    const cutoff = Date.now() - retentionMs;

    // Query old logs using the receivedAt index
    const oldLogs = await ctx.db
      .query("webhookLogs")
      .withIndex("by_received_at")
      .filter((q) => q.lt(q.field("receivedAt"), cutoff))
      .take(batchSize + 1); // Take one extra to check if there are more

    const hasMore = oldLogs.length > batchSize;
    const toDelete = oldLogs.slice(0, batchSize);

    // Delete in batch
    for (const log of toDelete) {
      await ctx.db.delete(log._id);
    }

    console.log(
      `[Plaid Component] Pruned ${toDelete.length} old webhook logs` +
        (hasMore ? " (more remaining)" : "")
    );

    return {
      deleted: toDelete.length,
      hasMore,
    };
  },
});

// =============================================================================
// SYNC LOGS - Audit Trail for Sync Operations
// =============================================================================

const syncTypeValidator = v.union(
  v.literal("transactions"),
  v.literal("liabilities"),
  v.literal("recurring"),
  v.literal("accounts"),
  v.literal("onboard")
);

const triggerValidator = v.union(
  v.literal("webhook"),
  v.literal("scheduled"),
  v.literal("manual"),
  v.literal("onboard")
);

const syncStatusValidator = v.union(
  v.literal("started"),
  v.literal("success"),
  v.literal("error"),
  v.literal("rate_limited"),
  v.literal("circuit_open")
);

const syncResultValidator = v.object({
  transactionsAdded: v.optional(v.number()),
  transactionsModified: v.optional(v.number()),
  transactionsRemoved: v.optional(v.number()),
  accountsUpdated: v.optional(v.number()),
  streamsUpdated: v.optional(v.number()),
  creditCardsUpdated: v.optional(v.number()),
  mortgagesUpdated: v.optional(v.number()),
  studentLoansUpdated: v.optional(v.number()),
});

/**
 * Create a sync log entry when sync starts.
 * Returns the sync log ID for later completion.
 */
export const createSyncLog = internalMutation({
  args: {
    plaidItemId: v.string(),
    userId: v.string(),
    syncType: syncTypeValidator,
    trigger: triggerValidator,
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("syncLogs", {
      plaidItemId: args.plaidItemId,
      userId: args.userId,
      syncType: args.syncType,
      trigger: args.trigger,
      startedAt: Date.now(),
      status: "started",
    });

    return String(id);
  },
});

/**
 * Complete a sync log with success status.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const completeSyncLogSuccess = internalMutation({
  args: {
    syncLogId: v.string(),
    result: v.optional(syncResultValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("syncLogs", args.syncLogId);
    if (!id) return null;

    const log = await ctx.db.get(id);
    if (!log) return null;

    const now = Date.now();
    await ctx.db.patch(log._id, {
      status: "success",
      completedAt: now,
      durationMs: now - log.startedAt,
      result: args.result,
    });

    return null;
  },
});

/**
 * Complete a sync log with error status.
 * Uses O(1) lookup via ctx.db.normalizeId() + ctx.db.get().
 */
export const completeSyncLogError = internalMutation({
  args: {
    syncLogId: v.string(),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    status: v.optional(syncStatusValidator), // Allow specific error statuses
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("syncLogs", args.syncLogId);
    if (!id) return null;

    const log = await ctx.db.get(id);
    if (!log) return null;

    const now = Date.now();
    await ctx.db.patch(log._id, {
      status: args.status ?? "error",
      completedAt: now,
      durationMs: now - log.startedAt,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage,
    });

    return null;
  },
});

/**
 * Prune old sync logs to prevent table growth.
 *
 * Deletes logs older than the specified retention period (default: 90 days).
 * Call this from a scheduled function (cron) to keep the table size manageable.
 *
 * Example cron setup in host app:
 * ```typescript
 * // convex/crons.ts
 * crons.daily("prune-sync-logs", { hourUTC: 3, minuteUTC: 30 }, components.plaid.private.pruneOldSyncLogs);
 * ```
 */
export const pruneOldSyncLogs = internalMutation({
  args: {
    /** Retention period in milliseconds (default: 90 days) */
    retentionMs: v.optional(v.number()),
    /** Maximum logs to delete per call (default: 100, prevents timeout) */
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    deleted: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const retentionMs = args.retentionMs ?? 90 * 24 * 60 * 60 * 1000; // 90 days
    const batchSize = args.batchSize ?? 100;
    const cutoff = Date.now() - retentionMs;

    // Query old logs using the startedAt index
    const oldLogs = await ctx.db
      .query("syncLogs")
      .withIndex("by_started_at")
      .filter((q) => q.lt(q.field("startedAt"), cutoff))
      .take(batchSize + 1); // Take one extra to check if there are more

    const hasMore = oldLogs.length > batchSize;
    const toDelete = oldLogs.slice(0, batchSize);

    // Delete in batch
    for (const log of toDelete) {
      await ctx.db.delete(log._id);
    }

    console.log(
      `[Plaid Component] Pruned ${toDelete.length} old sync logs` +
        (hasMore ? " (more remaining)" : "")
    );

    return {
      deleted: toDelete.length,
      hasMore,
    };
  },
});

// =============================================================================
// PLAID INSTITUTIONS - Cached Institution Metadata
// =============================================================================

/**
 * Get institution by institutionId (internal query).
 */
export const getInstitutionInternal = internalQuery({
  args: { institutionId: v.string() },
  returns: v.union(
    v.object({
      _id: v.any(),
      institutionId: v.string(),
      name: v.string(),
      logo: v.optional(v.string()),
      primaryColor: v.optional(v.string()),
      url: v.optional(v.string()),
      products: v.optional(v.array(v.string())),
      lastFetched: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const institution = await ctx.db
      .query("plaidInstitutions")
      .withIndex("by_institution_id", (q) =>
        q.eq("institutionId", args.institutionId)
      )
      .first();

    if (!institution) return null;

    return {
      _id: institution._id,
      institutionId: institution.institutionId,
      name: institution.name,
      logo: institution.logo,
      primaryColor: institution.primaryColor,
      url: institution.url,
      products: institution.products,
      lastFetched: institution.lastFetched,
    };
  },
});

/**
 * Upsert institution metadata.
 * Creates or updates by institutionId.
 *
 * Uses safe upsert pattern to handle TOCTOU race conditions where
 * concurrent calls might both try to insert the same institution.
 */
export const upsertInstitution = internalMutation({
  args: {
    institutionId: v.string(),
    name: v.string(),
    logo: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    url: v.optional(v.string()),
    products: v.optional(v.array(v.string())),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const now = Date.now();

    const result = await safeUpsertWithDedup(
      ctx,
      // Query for existing record
      () =>
        ctx.db
          .query("plaidInstitutions")
          .withIndex("by_institution_id", (q) =>
            q.eq("institutionId", args.institutionId)
          )
          .first(),
      // Query for ALL matching records (for duplicate detection)
      () =>
        ctx.db
          .query("plaidInstitutions")
          .withIndex("by_institution_id", (q) =>
            q.eq("institutionId", args.institutionId)
          )
          .collect(),
      // Insert function
      async () => {
        const id = await ctx.db.insert("plaidInstitutions", {
          institutionId: args.institutionId,
          name: args.name,
          logo: args.logo,
          primaryColor: args.primaryColor,
          url: args.url,
          products: args.products,
          lastFetched: now,
        });
        return String(id);
      },
      // Update function — merge optional branding fields so later Plaid calls
      // that omit logo / primary_color / etc. do not clear cached values.
      async (id) => {
        const patch: {
          name: string;
          lastFetched: number;
          logo?: string;
          primaryColor?: string;
          url?: string;
          products?: string[];
        } = {
          name: args.name,
          lastFetched: now,
        };
        if (args.logo !== undefined) patch.logo = args.logo;
        if (args.primaryColor !== undefined) patch.primaryColor = args.primaryColor;
        if (args.url !== undefined) patch.url = args.url;
        if (args.products !== undefined) patch.products = args.products;
        await ctx.db.patch(id, patch);
      }
    );

    return result.id;
  },
});

// =============================================================================
// W4: NEW ACCOUNTS AVAILABLE + ERROR TRACKING MUTATIONS
// =============================================================================

/**
 * Stamp plaidItems.newAccountsAvailableAt with the current timestamp.
 * Called by the ITEM:NEW_ACCOUNTS_AVAILABLE webhook handler.
 * Idempotent: writing the timestamp twice has no functional effect.
 */
export const setNewAccountsAvailableInternal = internalMutation({
  args: { plaidItemId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) return null;
    await ctx.db.patch(item._id, { newAccountsAvailableAt: Date.now() });
    return null;
  },
});

/**
 * Clear plaidItems.newAccountsAvailableAt.
 * Called exactly once per flow: after a successful update-mode exchangePublicToken
 * for an existing plaidItemId.
 */
export const clearNewAccountsAvailableInternal = internalMutation({
  args: { plaidItemId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) return null;
    await ctx.db.patch(item._id, { newAccountsAvailableAt: undefined });
    return null;
  },
});

/**
 * Stamp plaidItems.firstErrorAt if not already set (first-write-wins).
 * Called before the status patch on transition into error or needs_reauth.
 * Keeps the error-transition clock monotonic across repeated error observations.
 */
export const markFirstErrorAtInternal = internalMutation({
  args: { plaidItemId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) return null;
    if (item.firstErrorAt == null) {
      await ctx.db.patch(item._id, { firstErrorAt: Date.now() });
    }
    return null;
  },
});

/**
 * Clear plaidItems.firstErrorAt and plaidItems.lastDispatchedAt.
 * Called on transition from error-class status back to active via
 * completeReauthAction or a successful sync.
 */
export const clearErrorTrackingInternal = internalMutation({
  args: { plaidItemId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) return null;
    await ctx.db.patch(item._id, {
      firstErrorAt: undefined,
      lastDispatchedAt: undefined,
    });
    return null;
  },
});

/**
 * Stamp plaidItems.lastDispatchedAt.
 * Called by the 6-hour persistent-error cron immediately after scheduling
 * dispatchItemErrorPersistent. Used as the cron's dedup filter.
 */
export const markItemErrorDispatchedInternal = internalMutation({
  args: { plaidItemId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await getPlaidItemById(ctx, args.plaidItemId);
    if (!item) return null;
    await ctx.db.patch(item._id, { lastDispatchedAt: Date.now() });
    return null;
  },
});

/**
 * List plaidItems in error status that:
 *   - have lastSyncedAt older than olderThanLastSyncedAt (or undefined)
 *   - have lastDispatchedAt older than dispatchedBefore (or undefined)
 *
 * Used by the host-app 6-hour persistent-error cron per W4 spec §8.2.
 * Returns a subset payload (not the full plaidItem doc) to cap component-
 * boundary surface area.
 */
export const listErrorItemsInternal = internalQuery({
  args: {
    olderThanLastSyncedAt: v.number(),
    dispatchedBefore: v.number(),
  },
  returns: v.array(
    v.object({
      plaidItemId: v.string(),
      userId: v.string(),
      institutionName: v.union(v.string(), v.null()),
      firstErrorAt: v.union(v.number(), v.null()),
      errorAt: v.union(v.number(), v.null()),
      errorCode: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("plaidItems")
      .withIndex("by_status", (q) => q.eq("status", "error"))
      .collect();
    return items
      .filter((i) => (i.lastSyncedAt ?? 0) < args.olderThanLastSyncedAt)
      .filter((i) => (i.lastDispatchedAt ?? 0) < args.dispatchedBefore)
      .map((i) => ({
        plaidItemId: String(i._id),
        userId: i.userId,
        institutionName: i.institutionName ?? null,
        firstErrorAt: i.firstErrorAt ?? null,
        errorAt: i.errorAt ?? null,
        errorCode: i.errorCode ?? null,
      }));
  },
});
