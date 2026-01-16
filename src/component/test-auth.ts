/**
 * Test file to verify ctx.auth availability in Convex components
 *
 * Expected result: This will fail because components cannot access ctx.auth
 * Reference: https://docs.convex.dev/components/authoring
 */

import { query } from "./_generated/server.js";

export const testAuth = query({
  args: {},
  handler: async (ctx) => {
    // Test if ctx.auth is available
    // This should fail according to Convex documentation:
    // "Within a component, ctx.auth is not available"

    try {
      // ctx.auth may be undefined in components
      const identity = await ctx.auth?.getUserIdentity();

      return {
        hasAuth: ctx.auth !== undefined,
        userId: identity?.subject ?? null,
        error: null,
      };
    } catch (error) {
      return {
        hasAuth: false,
        userId: null,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
