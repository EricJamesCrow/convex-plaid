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
 * Sync all active Plaid items using fan-out pattern.
 *
 * Called by host app cron jobs to keep data fresh.
 * Schedules individual sync actions for each item in parallel,
 * providing isolation (one failure doesn't block others) and
 * better performance (parallel execution vs sequential).
 *
 * @param plaidConfig - Plaid API credentials
 * @returns Number of items scheduled for sync
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
    scheduled: v.number(),
  }),
  handler: async (ctx, args): Promise<{ scheduled: number }> => {
    const syncType = args.syncType ?? "transactions";

    console.log(`[Plaid Cron] Scheduling ${syncType} sync for all active items...`);

    // Get all active items
    const items: Array<{
      _id: string;
      accessToken: string;
      userId: string;
      cursor?: string;
    }> = await ctx.runQuery(internal.private.getAllActiveItems, {});

    console.log(`[Plaid Cron] Found ${items.length} active items, scheduling parallel syncs...`);

    // Fan-out: Schedule individual syncs for each item (runs in parallel)
    for (const item of items) {
      await ctx.scheduler.runAfter(0, internal.scheduledActions.syncSingleItem, {
        plaidItemId: item._id,
        plaidConfig: args.plaidConfig,
        syncType,
      });
    }

    console.log(`[Plaid Cron] Scheduled ${items.length} item syncs`);

    return { scheduled: items.length };
  },
});

/**
 * Sync a single Plaid item.
 *
 * This is the worker action scheduled by syncAllActiveItems.
 * Each item runs in isolation - errors here don't affect other items.
 */
export const syncSingleItem = internalAction({
  args: {
    plaidItemId: v.string(),
    plaidConfig: plaidConfigValidator,
    syncType: v.union(
      v.literal("transactions"),
      v.literal("liabilities"),
      v.literal("recurring"),
      v.literal("all")
    ),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    try {
      // Get item details
      const item: {
        _id: string;
        accessToken: string;
        userId: string;
        cursor?: string;
      } | null = await ctx.runQuery(internal.private.getItemWithToken, {
        plaidItemId: args.plaidItemId,
      });

      if (!item) {
        console.warn(`[Plaid Cron] Item ${args.plaidItemId} not found, skipping`);
        return { success: false, error: "Item not found" };
      }

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
      if (args.syncType === "transactions" || args.syncType === "all") {
        await syncItemTransactions(ctx, item, accessToken, plaidClient);
      }

      // Sync liabilities
      if (args.syncType === "liabilities" || args.syncType === "all") {
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
      if (args.syncType === "recurring" || args.syncType === "all") {
        await syncItemRecurringStreams(
          ctx,
          item._id,
          args.plaidConfig.plaidClientId,
          args.plaidConfig.plaidSecret,
          args.plaidConfig.plaidEnv,
          args.plaidConfig.encryptionKey
        );
      }

      console.log(`[Plaid Cron] Synced item ${args.plaidItemId}`);
      return { success: true };
    } catch (error: unknown) {
      const plaidError = categorizeError(error);
      console.error(
        `[Plaid Cron] Error syncing item ${args.plaidItemId}: ${formatErrorForLog(plaidError)}`
      );

      // Update item status based on error
      if (requiresReauth(plaidError)) {
        await ctx.runMutation(internal.private.updateItemStatus, {
          plaidItemId: args.plaidItemId,
          status: "needs_reauth",
          syncError: plaidError.message,
        });
      } else {
        await ctx.runMutation(internal.private.updateItemStatus, {
          plaidItemId: args.plaidItemId,
          status: "error",
          syncError: plaidError.message,
        });
      }

      return { success: false, error: plaidError.message };
    }
  },
});

/**
 * Sync items that need refresh (haven't synced in X hours).
 *
 * More targeted than syncAllActiveItems - only syncs stale items.
 * Uses fan-out pattern for parallel, isolated execution.
 */
export const syncStaleItems = internalAction({
  args: {
    plaidConfig: plaidConfigValidator,
    maxAgeHours: v.optional(v.number()), // Default 24 hours
  },
  returns: v.object({
    scheduled: v.number(),
  }),
  handler: async (ctx, args): Promise<{ scheduled: number }> => {
    const maxAgeHours = args.maxAgeHours ?? 24;

    console.log(
      `[Plaid Cron] Scheduling sync for items not updated in ${maxAgeHours} hours...`
    );

    // Get items needing sync
    const items: Array<{
      _id: string;
      accessToken: string;
      userId: string;
      cursor?: string;
    }> = await ctx.runQuery(internal.private.getItemsNeedingSync, {
      maxAgeHours,
    });

    console.log(`[Plaid Cron] Found ${items.length} stale items, scheduling parallel syncs...`);

    // Fan-out: Schedule individual syncs for each stale item
    for (const item of items) {
      await ctx.scheduler.runAfter(0, internal.scheduledActions.syncSingleItem, {
        plaidItemId: item._id,
        plaidConfig: args.plaidConfig,
        syncType: "transactions" as const,
      });
    }

    console.log(`[Plaid Cron] Scheduled ${items.length} stale item syncs`);

    return { scheduled: items.length };
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
