/**
 * Example Host App Plaid Integration
 *
 * Demonstrates how to wrap the Plaid component with authentication
 * and expose actions/queries to your app.
 *
 * This is the recommended pattern for integrating the component.
 */

import { v } from "convex/values";
import { action, query } from "./_generated/server";
import { Plaid } from "@crowdevelopment/convex-plaid";
import { components } from "./_generated/api";

// =============================================================================
// INITIALIZE PLAID CLIENT (LAZY)
// =============================================================================

/**
 * Lazy-initialized Plaid component instance.
 *
 * IMPORTANT: Environment variables are only available at runtime, not during
 * code bundling. We use lazy initialization to defer config validation until
 * the first action is called.
 *
 * All secrets must be provided explicitly - components cannot access process.env.
 * In production, use environment variables from your deployment.
 */
let _plaid: Plaid | null = null;

function getPlaid(): Plaid {
  if (!_plaid) {
    _plaid = new Plaid(components.plaid, {
      PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID!,
      PLAID_SECRET: process.env.PLAID_SECRET!,
      PLAID_ENV: process.env.PLAID_ENV ?? "sandbox",
      ENCRYPTION_KEY: process.env.PLAID_ENCRYPTION_KEY!,
    });
  }
  return _plaid;
}

// =============================================================================
// AUTHENTICATED ACTIONS
// =============================================================================

/**
 * Create a link token for the authenticated user.
 *
 * Frontend calls this before opening Plaid Link.
 */
export const createLinkToken = action({
  args: {
    userId: v.optional(v.string()),
    products: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Use provided userId, or fall back to authenticated user
    let userId = args.userId;
    if (!userId) {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) {
        throw new Error("Not authenticated and no userId provided");
      }
      userId = identity.subject;
    }

    return await getPlaid().createLinkToken(ctx, {
      userId,
      products: args.products,
      clientName: "SmartPockets",
      // webhookUrl: "https://your-deployment.convex.site/plaid/webhook",
    });
  },
});

/**
 * Exchange public token after successful Plaid Link.
 *
 * Frontend calls this with the public_token from Plaid Link onSuccess.
 */
export const exchangePublicToken = action({
  args: {
    publicToken: v.string(),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Use provided userId, or fall back to authenticated user
    let userId = args.userId;
    if (!userId) {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) {
        throw new Error("Not authenticated and no userId provided");
      }
      userId = identity.subject;
    }

    // Exchange token and create plaidItem
    const result = await getPlaid().exchangePublicToken(ctx, {
      publicToken: args.publicToken,
      userId,
    });

    // Automatically onboard the item (fetch accounts, transactions, liabilities)
    await getPlaid().onboardItem(ctx, {
      plaidItemId: result.plaidItemId,
    });

    return result;
  },
});

/**
 * Manually sync transactions for a Plaid item.
 */
export const syncTransactions = action({
  args: {
    plaidItemId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Optional: Verify the user owns this plaidItem
    // const item = await ctx.runQuery(plaid.api.getItem, { plaidItemId: args.plaidItemId });
    // if (!item || item.userId !== identity.subject) {
    //   throw new Error("Not authorized");
    // }

    return await getPlaid().syncTransactions(ctx, {
      plaidItemId: args.plaidItemId,
    });
  },
});

/**
 * Manually refresh liabilities for a Plaid item.
 */
export const refreshLiabilities = action({
  args: {
    plaidItemId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    return await getPlaid().fetchLiabilities(ctx, {
      plaidItemId: args.plaidItemId,
    });
  },
});

// =============================================================================
// AUTHENTICATED QUERIES
// =============================================================================

/**
 * Get all Plaid items (linked bank connections) for the current user.
 */
export const getMyItems = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    return await ctx.runQuery(getPlaid().api.getItemsByUser, {
      userId: identity.subject,
    });
  },
});

/**
 * Get all accounts for the current user.
 */
export const getMyAccounts = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    return await ctx.runQuery(getPlaid().api.getAccountsByUser, {
      userId: identity.subject,
    });
  },
});

/**
 * Get transactions for the current user with optional date filtering.
 */
export const getMyTransactions = query({
  args: {
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    return await ctx.runQuery(getPlaid().api.getTransactionsByUser, {
      userId: identity.subject,
      startDate: args.startDate,
      endDate: args.endDate,
      limit: args.limit,
    });
  },
});

/**
 * Get credit card liabilities for the current user.
 */
export const getMyLiabilities = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    return await ctx.runQuery(getPlaid().api.getLiabilitiesByUser, {
      userId: identity.subject,
    });
  },
});

// =============================================================================
// PUBLIC QUERIES (Take userId as parameter - for apps without ctx.auth)
// =============================================================================

/**
 * Get all Plaid items for a specific user.
 */
export const getItemsByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(getPlaid().api.getItemsByUser, args);
  },
});

/**
 * Get all accounts for a specific user.
 */
export const getAccountsByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(getPlaid().api.getAccountsByUser, args);
  },
});

/**
 * Get transactions for a specific user with optional filtering.
 */
export const getTransactionsByUser = query({
  args: {
    userId: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(getPlaid().api.getTransactionsByUser, args);
  },
});

/**
 * Get credit card liabilities for a specific user.
 */
export const getLiabilitiesByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(getPlaid().api.getLiabilitiesByUser, args);
  },
});

