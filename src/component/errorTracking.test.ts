/**
 * W4: Error-tracking mutations
 *
 * Tests markFirstErrorAtInternal, clearErrorTrackingInternal,
 * markItemErrorDispatchedInternal.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { internal } from "./_generated/api.js";

// Vite's import.meta.glob is not in the standard ImportMeta type.
const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

async function seedPlaidItem(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<{
    firstErrorAt: number;
    lastDispatchedAt: number;
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("plaidItems", {
      userId: "user_1",
      itemId: "item_1",
      accessToken: "fake-jwe",
      products: ["transactions"],
      status: "error",
      createdAt: Date.now(),
      ...overrides,
    });
  });
}

describe("error-tracking mutations", () => {
  it("markFirstErrorAtInternal stamps firstErrorAt when unset", async () => {
    const t = convexTest(schema, modules);
    const id = await seedPlaidItem(t);
    await t.mutation(internal.private.markFirstErrorAtInternal, {
      plaidItemId: String(id),
    });
    const item = await t.run(async (ctx) => await ctx.db.get(id));
    expect(item?.firstErrorAt).toBeDefined();
    expect(typeof item?.firstErrorAt).toBe("number");
  });

  it("markFirstErrorAtInternal is monotonic (no-op when already set)", async () => {
    const t = convexTest(schema, modules);
    const original = 1_000_000;
    const id = await seedPlaidItem(t, { firstErrorAt: original });
    await t.mutation(internal.private.markFirstErrorAtInternal, {
      plaidItemId: String(id),
    });
    const item = await t.run(async (ctx) => await ctx.db.get(id));
    expect(item?.firstErrorAt).toBe(original);
  });

  it("clearErrorTrackingInternal wipes both fields", async () => {
    const t = convexTest(schema, modules);
    const id = await seedPlaidItem(t, {
      firstErrorAt: 1_000_000,
      lastDispatchedAt: 2_000_000,
    });
    await t.mutation(internal.private.clearErrorTrackingInternal, {
      plaidItemId: String(id),
    });
    const item = await t.run(async (ctx) => await ctx.db.get(id));
    expect(item?.firstErrorAt).toBeUndefined();
    expect(item?.lastDispatchedAt).toBeUndefined();
  });

  it("markItemErrorDispatchedInternal stamps lastDispatchedAt", async () => {
    const t = convexTest(schema, modules);
    const id = await seedPlaidItem(t);
    await t.mutation(internal.private.markItemErrorDispatchedInternal, {
      plaidItemId: String(id),
    });
    const item = await t.run(async (ctx) => await ctx.db.get(id));
    expect(item?.lastDispatchedAt).toBeDefined();
    expect(typeof item?.lastDispatchedAt).toBe("number");
  });
});
