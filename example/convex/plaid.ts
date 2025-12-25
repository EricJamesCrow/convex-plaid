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
import { Plaid } from "@smartpockets/convex-plaid";
import { components } from "./_generated/api";

// =============================================================================
// INITIALIZE PLAID CLIENT
// =============================================================================

/**
 * Initialize the Plaid component client with configuration.
 *
 * All secrets must be provided explicitly - components cannot access process.env.
 * In production, use environment variables from your deployment.
 */
const plaid = new Plaid(components.plaid, {
  PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID!,
  PLAID_SECRET: process.env.PLAID_SECRET!,
  PLAID_ENV: process.env.PLAID_ENV ?? "sandbox",
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
});

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
    products: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Get authenticated user (your auth implementation)
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const userId = identity.subject;

    return await plaid.createLinkToken(ctx, {
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
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const userId = identity.subject;

    // Exchange token and create plaidItem
    const result = await plaid.exchangePublicToken(ctx, {
      publicToken: args.publicToken,
      userId,
    });

    // Automatically onboard the item (fetch accounts, transactions, liabilities)
    await plaid.onboardItem(ctx, {
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

    return await plaid.syncTransactions(ctx, {
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

    return await plaid.fetchLiabilities(ctx, {
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

    return await ctx.runQuery(plaid.api.getItemsByUser, {
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

    return await ctx.runQuery(plaid.api.getAccountsByUser, {
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

    return await ctx.runQuery(plaid.api.getTransactionsByUser, {
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

    return await ctx.runQuery(plaid.api.getLiabilitiesByUser, {
      userId: identity.subject,
    });
  },
});
