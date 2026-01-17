/**
 * Security Helper Utilities for Convex Plaid Component
 *
 * These utilities help you create secure wrapper functions in your host app.
 *
 * **Why these are needed:**
 * Convex components cannot access `ctx.auth` directly (architectural design).
 * Security must be enforced in your host app's wrapper functions that call
 * the component's public API.
 *
 * **Usage Pattern:**
 * ```typescript
 * // In your convex/plaid.ts file:
 * import { requireAuth } from "@crowdevelopment/convex-plaid/helpers";
 * import { query } from "./_generated/server";
 * import { components } from "./_generated/api";
 *
 * export const getMyItems = query({
 *   args: {},
 *   handler: async (ctx) => {
 *     const userId = await requireAuth(ctx);
 *     return await ctx.runQuery(components.plaid.public.getItemsByUser, { userId });
 *   },
 * });
 * ```
 *
 * See README.md "Security Best Practices" section for more examples.
 *
 * @module helpers
 */

import type {
  AuthenticatedContext,
  PlaidAccount,
  PlaidItem,
} from "./types.js";
import type { PlaidComponent } from "./index.js";

/**
 * Extract userId from ctx.auth and throw if not authenticated.
 *
 * @param ctx - Query or mutation context with auth
 * @returns The authenticated user's ID
 * @throws Error if not authenticated
 *
 * @example
 * ```typescript
 * export const getMyItems = query({
 *   args: {},
 *   handler: async (ctx) => {
 *     const userId = await requireAuth(ctx);
 *     return await ctx.runQuery(api.plaid.getItemsByUser, { userId });
 *   },
 * });
 * ```
 */
export async function requireAuth(ctx: AuthenticatedContext): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    throw new Error("Authentication required");
  }
  return identity.subject;
}

/**
 * Verify that the authenticated user owns a specific resource.
 *
 * @param ctx - Query or mutation context with auth
 * @param resourceUserId - The userId field from the resource being accessed
 * @throws Error if not authenticated or user doesn't own the resource
 *
 * @example
 * ```typescript
 * export const deleteItem = mutation({
 *   args: { itemId: v.id("items") },
 *   handler: async (ctx, args) => {
 *     const item = await ctx.db.get(args.itemId);
 *     if (!item) throw new Error("Item not found");
 *
 *     await requireOwnership(ctx, item.userId);
 *     await ctx.db.delete(args.itemId);
 *   },
 * });
 * ```
 */
export async function requireOwnership(
  ctx: AuthenticatedContext,
  resourceUserId: string
): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    throw new Error("Authentication required");
  }
  if (identity.subject !== resourceUserId) {
    throw new Error("Unauthorized: You don't own this resource");
  }
}

/**
 * Verify that the authenticated user owns a Plaid item.
 *
 * @param ctx - Query or mutation context with auth
 * @param plaidItemId - Plaid item document ID (string)
 * @param plaidApi - components.plaid.public or plaid.api
 * @returns The Plaid item if owned by the user
 */
export async function requireItemOwnership(
  ctx: AuthenticatedContext,
  plaidItemId: string,
  plaidApi: Pick<PlaidComponent["public"], "getItem">
): Promise<PlaidItem> {
  const userId = await requireAuth(ctx);
  const item = (await ctx.runQuery(plaidApi.getItem, {
    plaidItemId,
  })) as PlaidItem | null;

  if (!item) {
    throw new Error("Plaid item not found");
  }

  if (item.userId !== userId) {
    throw new Error("Unauthorized: You don't own this item");
  }

  return item;
}

/**
 * Verify that the authenticated user owns a Plaid account.
 *
 * @param ctx - Query or mutation context with auth
 * @param accountId - Plaid account_id
 * @param plaidApi - components.plaid.public or plaid.api
 * @returns The Plaid account if owned by the user
 */
export async function requireAccountOwnership(
  ctx: AuthenticatedContext,
  accountId: string,
  plaidApi: Pick<PlaidComponent["public"], "getAccountsByUser">
): Promise<PlaidAccount> {
  const userId = await requireAuth(ctx);
  const accounts = (await ctx.runQuery(plaidApi.getAccountsByUser, {
    userId,
  })) as PlaidAccount[];
  const account = accounts.find((acc) => acc.accountId === accountId);

  if (!account) {
    throw new Error("Account not found or unauthorized");
  }

  return account;
}
