/**
 * Security Examples for Convex Plaid Component
 *
 * This file demonstrates secure wrapper patterns for the @crowdevelopment/convex-plaid
 * component. Since Convex components cannot access ctx.auth, all authentication and
 * authorization must be enforced in your host app's wrapper functions.
 *
 * **Key Principles:**
 * 1. Always call requireAuth() before accessing component data
 * 2. Verify ownership when accessing specific resources
 * 3. Pass userId explicitly to component functions
 * 4. Never expose sensitive data (access tokens are already excluded)
 *
 * **Auth Provider Compatibility:**
 * These patterns work with any Convex auth provider:
 * - Clerk (clerk-convex)
 * - Auth0
 * - Custom JWT authentication
 * - Any provider that implements ctx.auth.getUserIdentity()
 *
 * @module secureWrappers
 */

import { v } from "convex/values";
import { query, mutation, action } from "./_generated/server";
import { requireAuth, requireOwnership } from "@crowdevelopment/convex-plaid/helpers";
import { components } from "./_generated/api";
import { api } from "./_generated/api";
import { Plaid } from "@crowdevelopment/convex-plaid";

// Initialize Plaid client (needed for actions)
const plaid = new Plaid(components.plaid, {
  PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID!,
  PLAID_SECRET: process.env.PLAID_SECRET!,
  PLAID_ENV: process.env.PLAID_ENV!,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
});

// =============================================================================
// PATTERN 1: Basic Read-Only Query Wrapper
// =============================================================================

/**
 * Get all Plaid items for the authenticated user.
 *
 * SECURITY:
 * - Requires authentication via requireAuth()
 * - Only returns items belonging to the authenticated user
 * - Access tokens are excluded by the component (never exposed)
 *
 * @example
 * ```typescript
 * // In your React component:
 * const items = useQuery(api.secureWrappers.getMyPlaidItems);
 * ```
 */
export const getMyPlaidItems = query({
  args: {},
  handler: async (ctx) => {
    // 1. Authenticate and get userId
    const userId = await requireAuth(ctx);

    // 2. Pass userId to component query
    return await ctx.runQuery(components.plaid.public.getItemsByUser, {
      userId,
    });
  },
});

/**
 * Get all accounts for the authenticated user.
 *
 * SECURITY:
 * - Same pattern as getMyPlaidItems
 * - Only returns accounts belonging to user's connected items
 */
export const getMyAccounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);

    return await ctx.runQuery(components.plaid.public.getAccountsByUser, {
      userId,
    });
  },
});

/**
 * Get recent transactions for the authenticated user.
 *
 * SECURITY:
 * - Requires authentication
 * - Optionally filter by date range (validated by component)
 * - User can only see their own transactions
 */
export const getMyTransactions = query({
  args: {
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    return await ctx.runQuery(components.plaid.public.getTransactionsByUser, {
      userId,
      startDate: args.startDate,
      endDate: args.endDate,
      limit: args.limit,
    });
  },
});

// =============================================================================
// PATTERN 2: Query with Ownership Check (Accessing Specific Resources)
// =============================================================================

/**
 * Get a specific Plaid item by ID with ownership verification.
 *
 * SECURITY:
 * - Requires authentication
 * - Verifies the item belongs to the authenticated user
 * - Returns null if item doesn't exist or user doesn't own it
 *
 * WHY THIS IS SECURE:
 * Even though component queries don't check ownership, this wrapper does.
 * The component's getItem query returns the userId field, which we use
 * to verify ownership before returning data.
 *
 * @example
 * ```typescript
 * // This will fail if user doesn't own the item:
 * const item = useQuery(api.secureWrappers.getPlaidItem, {
 *   plaidItemId: "someItemId"
 * });
 * ```
 */
export const getPlaidItem = query({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    // 1. Authenticate
    const userId = await requireAuth(ctx);

    // 2. Fetch the item from component
    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    // 3. Verify ownership
    if (!item) {
      return null; // Item doesn't exist
    }

    if (item.userId !== userId) {
      // User doesn't own this item - return null (or throw error)
      // Returning null prevents information leakage about existence
      return null;
    }

    // 4. Return data only if user owns it
    return item;
  },
});

/**
 * Get transactions for a specific account with ownership verification.
 *
 * SECURITY:
 * - Multi-step ownership check: account → plaidItem → userId
 * - Verifies the account belongs to a plaidItem owned by the user
 * - More complex pattern needed when accessing nested resources
 */
export const getAccountTransactions = query({
  args: {
    accountId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    // 1. Get accounts to verify ownership chain
    const accounts = await ctx.runQuery(components.plaid.public.getAccountsByUser, {
      userId,
    });

    // 2. Check if user owns an account with this accountId
    const account = accounts.find((acc) => acc.accountId === args.accountId);

    if (!account) {
      // User doesn't own this account
      throw new Error("Account not found or access denied");
    }

    // 3. Now safe to fetch transactions for this account
    return await ctx.runQuery(components.plaid.public.getTransactionsByAccount, {
      accountId: args.accountId,
      limit: args.limit,
    });
  },
});

// =============================================================================
// PATTERN 3: Mutation Wrapper with Authentication
// =============================================================================

/**
 * Delete a Plaid item connection with ownership verification.
 *
 * SECURITY:
 * - Requires authentication
 * - Verifies user owns the item before deletion
 * - Uses component mutation to cascade delete related data
 *
 * WHY TWO QUERIES:
 * 1. First query verifies ownership (security check)
 * 2. Mutation performs the actual deletion
 * This prevents unauthorized users from deleting items they don't own.
 *
 * @example
 * ```typescript
 * const deleteMutation = useMutation(api.secureWrappers.deleteMyPlaidItem);
 * await deleteMutation({ plaidItemId: "itemId" });
 * ```
 */
export const deleteMyPlaidItem = mutation({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    // 1. Authenticate
    const userId = await requireAuth(ctx);

    // 2. Verify ownership before deletion
    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item) {
      throw new Error("Plaid item not found");
    }

    // 3. Check ownership
    if (item.userId !== userId) {
      throw new Error("Unauthorized: You don't own this Plaid item");
    }

    // 4. Safe to delete - call component mutation
    return await ctx.runMutation(components.plaid.public.deletePlaidItem, {
      plaidItemId: args.plaidItemId,
    });
  },
});

// =============================================================================
// PATTERN 4: Mutation with RequireOwnership Helper
// =============================================================================

/**
 * Alternative pattern using requireOwnership() helper for cleaner code.
 *
 * SECURITY:
 * - Same security as deleteMyPlaidItem but more concise
 * - requireOwnership() throws if user doesn't own the resource
 * - Reduces boilerplate for ownership checks
 */
export const deleteMyPlaidItemAlt = mutation({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    // 1. Fetch item
    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item) {
      throw new Error("Plaid item not found");
    }

    // 2. Verify ownership (throws if unauthorized)
    await requireOwnership(ctx, item.userId);

    // 3. Safe to delete
    return await ctx.runMutation(components.plaid.public.deletePlaidItem, {
      plaidItemId: args.plaidItemId,
    });
  },
});

// =============================================================================
// PATTERN 5: Action Wrapper for Sensitive Operations
// =============================================================================

/**
 * Exchange a Plaid public token and create a new item connection.
 *
 * SECURITY:
 * - Requires authentication
 * - Associates the new item with the authenticated user
 * - Public tokens are single-use and can't be reused
 *
 * IMPORTANT:
 * Actions can access process.env, but you must still verify authentication
 * before performing sensitive operations.
 *
 * @example
 * ```typescript
 * const exchange = useMutation(api.secureWrappers.connectBankAccount);
 * const result = await exchange({ publicToken: "public-sandbox-..." });
 * ```
 */
export const connectBankAccount = action({
  args: { publicToken: v.string() },
  handler: async (ctx, args) => {
    // 1. Authenticate and get userId
    const userId = await requireAuth(ctx);

    // 2. Exchange token using Plaid client
    // The userId is passed to associate the item with this user
    const result = await plaid.exchangePublicToken(ctx, {
      publicToken: args.publicToken,
      userId,
    });

    // 3. Optionally trigger initial sync
    if (result.success && result.plaidItemId) {
      await plaid.onboardItem(ctx, { plaidItemId: result.plaidItemId });
    }

    return result;
  },
});

/**
 * Trigger a manual transaction sync for a user's item.
 *
 * SECURITY:
 * - Verifies user owns the item before syncing
 * - Prevents unauthorized users from triggering syncs on others' items
 * - Rate limiting should be added for production (not shown here)
 */
export const syncMyPlaidItem = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    // 1. Authenticate
    const userId = await requireAuth(ctx);

    // 2. Verify ownership
    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item || item.userId !== userId) {
      throw new Error("Unauthorized: Item not found or access denied");
    }

    // 3. Trigger sync
    return await plaid.syncTransactions(ctx, {
      plaidItemId: args.plaidItemId,
    });
  },
});

// =============================================================================
// PATTERN 6: Multi-Step Ownership Chain Verification
// =============================================================================

/**
 * Get credit card liabilities for a specific account with full verification.
 *
 * SECURITY:
 * - Verifies ownership through the full chain: account → plaidItem → userId
 * - Demonstrates how to verify ownership for nested resources
 * - More thorough than simple userId check
 *
 * OWNERSHIP CHAIN:
 * 1. Check if account exists and belongs to user's items
 * 2. Check if plaidItem belongs to user
 * 3. Only then fetch liability data
 */
export const getAccountLiabilities = query({
  args: { accountId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    // 1. Get all user's accounts to verify ownership
    const accounts = await ctx.runQuery(components.plaid.public.getAccountsByUser, {
      userId,
    });

    // 2. Find the specific account
    const account = accounts.find((acc) => acc.accountId === args.accountId);

    if (!account) {
      throw new Error("Account not found or access denied");
    }

    // 3. Verify the associated plaidItem also belongs to user (extra safety)
    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: account.plaidItemId,
    });

    if (!item || item.userId !== userId) {
      throw new Error("Unauthorized: Invalid ownership chain");
    }

    // 4. Now safe to fetch liabilities for this item
    const liabilities = await ctx.runQuery(
      components.plaid.public.getLiabilitiesByItem,
      {
        plaidItemId: account.plaidItemId,
      }
    );

    // 5. Filter to only the specific account requested
    return liabilities.filter((liability) => liability.accountId === args.accountId);
  },
});

// =============================================================================
// PATTERN 7: Aggregated Data with Ownership
// =============================================================================

/**
 * Get a dashboard summary of user's financial data.
 *
 * SECURITY:
 * - Single authentication check at the start
 * - All subsequent queries use verified userId
 * - Aggregates data from multiple sources safely
 *
 * EFFICIENCY:
 * This pattern is efficient because:
 * 1. One auth check for the entire operation
 * 2. All queries scope to the verified userId
 * 3. Component handles all data filtering by userId
 */
export const getMyFinancialDashboard = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);

    // Fetch all user data in parallel for efficiency
    const [items, accounts, transactions, liabilities, subscriptions] =
      await Promise.all([
        ctx.runQuery(components.plaid.public.getItemsByUser, { userId }),
        ctx.runQuery(components.plaid.public.getAccountsByUser, { userId }),
        ctx.runQuery(components.plaid.public.getTransactionsByUser, {
          userId,
          limit: 50,
        }),
        ctx.runQuery(components.plaid.public.getLiabilitiesByUser, { userId }),
        ctx.runQuery(components.plaid.public.getSubscriptionsSummary, { userId }),
      ]);

    // Calculate totals
    const totalBalance = accounts.reduce(
      (sum, acc) => sum + (acc.balances.current ?? 0),
      0
    );

    const totalLiabilities = liabilities.reduce(
      (sum, liability) => sum + (liability.lastStatementBalance ?? 0),
      0
    );

    return {
      items: items.length,
      accounts: accounts.length,
      totalBalance,
      totalLiabilities,
      netWorth: totalBalance - totalLiabilities,
      recentTransactions: transactions.length,
      subscriptions,
    };
  },
});

// =============================================================================
// PATTERN 8: Conditional Access Based on Resource State
// =============================================================================

/**
 * Create a re-authentication link token for an expired item.
 *
 * SECURITY:
 * - Verifies ownership
 * - Only allows re-auth if item status is "needs_reauth"
 * - Prevents unnecessary token generation
 *
 * CONDITIONAL LOGIC:
 * This pattern shows how to add business logic to security checks.
 * Not all operations are just about ownership - sometimes state matters too.
 */
export const createReauthLinkToken = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    // 1. Verify ownership
    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item || item.userId !== userId) {
      throw new Error("Unauthorized: Item not found or access denied");
    }

    // 2. Check state - only allow re-auth if needed
    if (item.status !== "needs_reauth") {
      throw new Error(
        `Item does not need re-authentication. Current status: ${item.status}`
      );
    }

    // 3. Generate update link token
    return await plaid.createUpdateLinkToken(ctx, {
      plaidItemId: args.plaidItemId,
    });
  },
});

// =============================================================================
// ANTI-PATTERNS (What NOT to do)
// =============================================================================

/**
 * ❌ INSECURE: Never trust client-provided userId
 *
 * This is VULNERABLE because a malicious client could pass any userId
 * and access other users' data.
 */
export const insecureGetItems_NEVER_DO_THIS = query({
  args: { userId: v.string() }, // ❌ Never accept userId from client
  handler: async (ctx, args) => {
    // ❌ This bypasses authentication entirely!
    return await ctx.runQuery(components.plaid.public.getItemsByUser, {
      userId: args.userId, // Attacker can pass any userId here
    });
  },
});

/**
 * ❌ INSECURE: Never skip ownership verification
 *
 * Even though the component query might work, you MUST verify ownership
 * before returning data.
 */
export const insecureDeleteItem_NEVER_DO_THIS = mutation({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    await requireAuth(ctx); // ✅ Authenticates user

    // ❌ But doesn't verify they OWN this item!
    // Attacker could delete other users' items
    return await ctx.runMutation(components.plaid.public.deletePlaidItem, {
      plaidItemId: args.plaidItemId,
    });
  },
});

/**
 * ❌ INSECURE: Never expose access tokens
 *
 * The component already excludes accessToken from queries, but if you
 * somehow had access to it, NEVER return it to the client.
 */
export const insecureGetItemWithToken_NEVER_DO_THIS = query({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    // Even if you could get the encrypted token (you can't from public queries),
    // NEVER return it to the client:
    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    // ❌ Never do this:
    // return { ...item, accessToken: "..." };

    return item; // ✅ Component already excludes accessToken
  },
});

// =============================================================================
// BONUS: Type-Safe Wrapper Pattern
// =============================================================================

/**
 * Type-safe wrapper that ensures ownership verification is never forgotten.
 *
 * This is an advanced pattern that uses TypeScript to enforce security checks.
 * The withOwnership wrapper GUARANTEES ownership is verified before the handler runs.
 */
async function withOwnership<T>(
  ctx: { runQuery: any; auth: any },
  plaidItemId: string,
  handler: (userId: string, item: any) => Promise<T>
): Promise<T> {
  const userId = await requireAuth(ctx);

  const item = await ctx.runQuery(components.plaid.public.getItem, {
    plaidItemId,
  });

  if (!item || item.userId !== userId) {
    throw new Error("Unauthorized: Item not found or access denied");
  }

  return handler(userId, item);
}

/**
 * Example usage of withOwnership wrapper.
 *
 * BENEFITS:
 * - Can't forget ownership check (enforced by wrapper)
 * - Cleaner handler code (no boilerplate)
 * - Consistent error messages
 */
export const getItemAccounts = query({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    return withOwnership(ctx, args.plaidItemId, async (userId, item) => {
      // Handler ONLY runs if ownership is verified
      return await ctx.runQuery(components.plaid.public.getAccountsByItem, {
        plaidItemId: args.plaidItemId,
      });
    });
  },
});

// =============================================================================
// SUMMARY: Security Checklist
// =============================================================================

/**
 * ✅ ALWAYS:
 * - Call requireAuth() before accessing component data
 * - Verify ownership for resource-specific operations
 * - Pass userId explicitly to component functions
 * - Return null/throw errors for unauthorized access
 * - Use type-safe wrappers to enforce patterns
 *
 * ❌ NEVER:
 * - Accept userId as an argument from the client
 * - Skip ownership verification for mutations
 * - Expose access tokens (component already prevents this)
 * - Trust client data without verification
 * - Return different errors for "not found" vs "unauthorized" (prevents info leakage)
 *
 * 📋 AUTH PROVIDER NOTES:
 * These patterns work with ANY Convex auth provider:
 * - Clerk: Uses clerk-convex, ctx.auth.getUserIdentity() returns Clerk user
 * - Auth0: Uses convex-auth0, same getUserIdentity() interface
 * - Custom: Implement JWT validation, same interface
 *
 * The key is that all providers implement ctx.auth.getUserIdentity() which
 * returns { subject: string } where subject is the unique user ID.
 *
 * 🔒 DEFENSE IN DEPTH:
 * Even though the component doesn't have ctx.auth, your wrapper functions do.
 * This architecture enforces that ALL access to component data goes through
 * authenticated wrapper functions in your host app.
 */
