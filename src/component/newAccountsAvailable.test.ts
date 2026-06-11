/**
 * W4: setNewAccountsAvailableInternal + clearNewAccountsAvailableInternal
 *
 * Tests the two mutations that stamp and clear the newAccountsAvailableAt
 * field used by the ITEM:NEW_ACCOUNTS_AVAILABLE webhook path.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { internal } from "./_generated/api.js";

// Vite's import.meta.glob is not in the standard ImportMeta type.
const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

async function seedPlaidItem(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("plaidItems", {
      userId: "user_1",
      itemId: "item_1",
      accessToken: "fake-jwe",
      products: ["transactions"],
      status: "active",
      createdAt: Date.now(),
    });
  });
}

describe("newAccountsAvailable mutations", () => {
  it("setNewAccountsAvailableInternal stamps the field", async () => {
    const t = convexTest(schema, modules);
    const id = await seedPlaidItem(t);
    await t.mutation(internal.private.setNewAccountsAvailableInternal, {
      plaidItemId: String(id),
    });
    const item = await t.run(async (ctx) => await ctx.db.get(id));
    expect(item?.newAccountsAvailableAt).toBeDefined();
    expect(typeof item?.newAccountsAvailableAt).toBe("number");
  });

  it("clearNewAccountsAvailableInternal clears the field", async () => {
    const t = convexTest(schema, modules);
    const id = await seedPlaidItem(t);
    await t.mutation(internal.private.setNewAccountsAvailableInternal, {
      plaidItemId: String(id),
    });
    await t.mutation(internal.private.clearNewAccountsAvailableInternal, {
      plaidItemId: String(id),
    });
    const item = await t.run(async (ctx) => await ctx.db.get(id));
    expect(item?.newAccountsAvailableAt).toBeUndefined();
  });

  it("setNewAccountsAvailableInternal is a no-op for a missing item", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.private.setNewAccountsAvailableInternal, {
      plaidItemId: "non_existent_id",
    });
  });
});
