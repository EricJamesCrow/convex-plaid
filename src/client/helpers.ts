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

import type { AuthenticatedContext } from "./types.js";

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
