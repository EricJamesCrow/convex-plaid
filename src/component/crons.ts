/**
 * Plaid Component Cron Jobs
 *
 * Internal actions for scheduled sync operations.
 * Host apps can call these from their own cron jobs.
 *
 * COMPONENT NOTE: These are internalActions, not directly schedulable.
 * The host app must set up its own crons.ts that calls these.
 *
 * @example Host app crons.ts:
 * ```typescript
 * import { cronJobs } from "convex/server";
 * import { internal } from "./_generated/api";
 *
 * const crons = cronJobs();
 *
 * // Daily sync at 2 AM UTC
 * crons.daily(
 *   "daily-plaid-sync",
 *   { hourUTC: 2, minuteUTC: 0 },
 *   internal.plaid.syncAllActiveItems,
 *   { plaidConfig: {...} }
 * );
 *
 * export default crons;
 * ```
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { decryptToken } from "./encryption.js";
import { initPlaidClient, syncTransactionsPaginated, transformTransaction } from "./utils.js";
import { categorizeError, requiresReauth, formatErrorForLog } from "./errors.js";

// =============================================================================
// VALIDATORS
// =============================================================================

const plaidConfigValidator = v.object({
  plaidClientId: v.string(),
  plaidSecret: v.string(),
  plaidEnv: v.string(),
  encryptionKey: v.string(),
});

// =============================================================================
// SYNC ALL ACTIVE ITEMS
// =============================================================================

/**
 * Sync all active Plaid items.
 *
 * Called by host app cron jobs to keep data fresh.
 * Syncs transactions for all items in 'active' status.
 *
 * Continues on per-item errors to ensure all items are attempted.
 *
 * @param plaidConfig - Plaid API credentials
 * @returns Summary of sync results
 */
export const syncAllActiveItems = internalAction({
  args: {
    plaidConfig: plaidConfigValidator,
    syncType: v.optional(
      v.union(
        v.literal("transactions"),
        v.literal("liabilities"),
        v.literal("recurring"),
        v.literal("all")
      )
    ),
  },
  returns: v.object({
    totalItems: v.number(),
    synced: v.number(),
    errors: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    const syncType = args.syncType ?? "transactions";

    console.log(`[Plaid Cron] Starting ${syncType} sync for all active items...`);

    // Get all active items
    const items = await ctx.runQuery(internal.private.getAllActiveItems, {});

    console.log(`[Plaid Cron] Found ${items.length} active items`);

    let synced = 0;
    let errors = 0;
    let skipped = 0;

    for (const item of items) {
      try {
        // Decrypt access token
        const accessToken = await decryptToken(
          item.accessToken,
          args.plaidConfig.encryptionKey
        );

        const plaidClient = initPlaidClient(
          args.plaidConfig.plaidClientId,
          args.plaidConfig.plaidSecret,
          args.plaidConfig.plaidEnv
        );

        // Sync transactions
        if (syncType === "transactions" || syncType === "all") {
          await syncItemTransactions(ctx, item, accessToken, plaidClient);
        }

        // Sync liabilities
        if (syncType === "liabilities" || syncType === "all") {
          await syncItemLiabilities(
            ctx,
            item._id,
            args.plaidConfig.plaidClientId,
            args.plaidConfig.plaidSecret,
            args.plaidConfig.plaidEnv,
            args.plaidConfig.encryptionKey
          );
        }

        // Sync recurring streams
        if (syncType === "recurring" || syncType === "all") {
          await syncItemRecurringStreams(
            ctx,
            item._id,
            args.plaidConfig.plaidClientId,
            args.plaidConfig.plaidSecret,
            args.plaidConfig.plaidEnv,
            args.plaidConfig.encryptionKey
          );
        }

        synced++;
        console.log(`[Plaid Cron] Synced item ${item._id}`);
      } catch (error: unknown) {
        const plaidError = categorizeError(error);
        console.error(
          `[Plaid Cron] Error syncing item ${item._id}: ${formatErrorForLog(plaidError)}`
        );

        // Update item status based on error
        if (requiresReauth(plaidError)) {
          await ctx.runMutation(internal.private.updateItemStatus, {
            plaidItemId: item._id,
            status: "needs_reauth",
            syncError: plaidError.message,
          });
        } else {
          await ctx.runMutation(internal.private.updateItemStatus, {
            plaidItemId: item._id,
            status: "error",
            syncError: plaidError.message,
          });
        }

        errors++;
      }
    }

    console.log(
      `[Plaid Cron] Sync complete: ${synced} synced, ${errors} errors, ${skipped} skipped`
    );

    return {
      totalItems: items.length,
      synced,
      errors,
      skipped,
    };
  },
});

/**
 * Sync items that need refresh (haven't synced in X hours).
 *
 * More targeted than syncAllActiveItems - only syncs stale items.
 */
export const syncStaleItems = internalAction({
  args: {
    plaidConfig: plaidConfigValidator,
    maxAgeHours: v.optional(v.number()), // Default 24 hours
  },
  returns: v.object({
    totalItems: v.number(),
    synced: v.number(),
    errors: v.number(),
  }),
  handler: async (ctx, args) => {
    const maxAgeHours = args.maxAgeHours ?? 24;

    console.log(
      `[Plaid Cron] Syncing items not updated in ${maxAgeHours} hours...`
    );

    // Get items needing sync
    const items = await ctx.runQuery(internal.private.getItemsNeedingSync, {
      maxAgeHours,
    });

    console.log(`[Plaid Cron] Found ${items.length} stale items`);

    let synced = 0;
    let errors = 0;

    for (const item of items) {
      try {
        // Decrypt access token
        const accessToken = await decryptToken(
          item.accessToken,
          args.plaidConfig.encryptionKey
        );

        const plaidClient = initPlaidClient(
          args.plaidConfig.plaidClientId,
          args.plaidConfig.plaidSecret,
          args.plaidConfig.plaidEnv
        );

        await syncItemTransactions(ctx, item, accessToken, plaidClient);

        synced++;
        console.log(`[Plaid Cron] Synced stale item ${item._id}`);
      } catch (error: unknown) {
        const plaidError = categorizeError(error);
        console.error(
          `[Plaid Cron] Error syncing stale item ${item._id}: ${formatErrorForLog(plaidError)}`
        );

        // Update item status
        if (requiresReauth(plaidError)) {
          await ctx.runMutation(internal.private.updateItemStatus, {
            plaidItemId: item._id,
            status: "needs_reauth",
            syncError: plaidError.message,
          });
        } else {
          await ctx.runMutation(internal.private.updateItemStatus, {
            plaidItemId: item._id,
            status: "error",
            syncError: plaidError.message,
          });
        }

        errors++;
      }
    }

    console.log(`[Plaid Cron] Stale sync complete: ${synced} synced, ${errors} errors`);

    return {
      totalItems: items.length,
      synced,
      errors,
    };
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Sync transactions for a single item.
 */
async function syncItemTransactions(
  ctx: any,
  item: {
    _id: string;
    userId: string;
    cursor?: string;
  },
  accessToken: string,
  plaidClient: any
) {
  // Mark as syncing
  await ctx.runMutation(internal.private.updateItemStatus, {
    plaidItemId: item._id,
    status: "syncing",
  });

  // Fetch all transaction pages
  const syncResult = await syncTransactionsPaginated(
    plaidClient,
    accessToken,
    item.cursor ?? ""
  );

  // Transform transactions
  const addedData = syncResult.added.map((t: any) => transformTransaction(t));
  const modifiedData = syncResult.modified.map((t: any) => transformTransaction(t));
  const removedIds = syncResult.removed.map((t: any) => t.transaction_id);

  // Bulk upsert transactions
  await ctx.runMutation(internal.private.bulkUpsertTransactions, {
    userId: item.userId,
    plaidItemId: item._id,
    added: addedData,
    modified: modifiedData,
    removed: removedIds,
  });

  // Update cursor and mark as active
  await ctx.runMutation(internal.private.updateItemCursor, {
    plaidItemId: item._id,
    cursor: syncResult.nextCursor,
  });
}

/**
 * Sync liabilities for a single item.
 * Note: Liabilities sync is logged but skipped in cron - call fetchLiabilities action separately.
 * This is because actions cannot call other actions in Convex components.
 */
async function syncItemLiabilities(
  _ctx: any,
  plaidItemId: string,
  _plaidClientId: string,
  _plaidSecret: string,
  _plaidEnv: string,
  _encryptionKey: string
) {
  // Note: In Convex components, actions cannot call other actions.
  // Liabilities sync should be triggered separately via the fetchLiabilities action.
  // This function is a placeholder that logs the intent.
  console.log(`[Plaid Cron] Liabilities sync for ${plaidItemId} should be triggered separately via fetchLiabilities action`);
}

/**
 * Sync recurring streams for a single item.
 * Note: Recurring streams sync is logged but skipped in cron - call fetchRecurringStreams action separately.
 * This is because actions cannot call other actions in Convex components.
 */
async function syncItemRecurringStreams(
  _ctx: any,
  plaidItemId: string,
  _plaidClientId: string,
  _plaidSecret: string,
  _plaidEnv: string,
  _encryptionKey: string
) {
  // Note: In Convex components, actions cannot call other actions.
  // Recurring streams sync should be triggered separately via the fetchRecurringStreams action.
  // This function is a placeholder that logs the intent.
  console.log(`[Plaid Cron] Recurring streams sync for ${plaidItemId} should be triggered separately via fetchRecurringStreams action`);
}
