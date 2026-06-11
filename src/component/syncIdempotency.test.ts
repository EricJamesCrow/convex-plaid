import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { internal } from "./_generated/api.js";
import {
  normalizePlaidProducts,
  syncTransactionsPaginated,
  transformTransaction,
} from "./utils.js";

// Vite's import.meta.glob is not in the standard ImportMeta type.
const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

function plaidTransaction(overrides: Record<string, unknown> = {}) {
  return {
    account_id: "account_1",
    transaction_id: "transaction_1",
    amount: 12.34,
    iso_currency_code: "USD",
    date: "2026-04-24",
    datetime: null,
    name: "COFFEE SHOP",
    merchant_name: "Coffee Shop",
    pending: false,
    pending_transaction_id: null,
    personal_finance_category: {
      primary: "FOOD_AND_DRINK",
      detailed: "FOOD_AND_DRINK_COFFEE",
    },
    payment_channel: "in store",
    ...overrides,
  };
}

async function seedPlaidItem(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("plaidItems", {
      userId: "user_1",
      itemId: "item_1",
      accessToken: "fake-jwe",
      products: ["transactions", "liabilities"],
      status: "active",
      createdAt: Date.now(),
    });
  });
}

describe("Plaid sync idempotency", () => {
  it("upserts replayed added transactions by transactionId", async () => {
    const t = convexTest(schema, modules);
    const plaidItemId = await seedPlaidItem(t);

    await t.mutation(internal.private.bulkUpsertTransactions as any, {
      userId: "user_1",
      plaidItemId: String(plaidItemId),
      added: [transformTransaction(plaidTransaction() as any)],
      modified: [],
      removed: [],
    });

    const replayResult = await t.mutation(internal.private.bulkUpsertTransactions as any, {
      userId: "user_1",
      plaidItemId: String(plaidItemId),
      added: [
        transformTransaction(
          plaidTransaction({
            amount: 56.78,
            name: "COFFEE SHOP UPDATED",
          }) as any
        ),
      ],
      modified: [],
      removed: [],
    });

    const transactions = await t.run(async (ctx) => {
      return await ctx.db
        .query("plaidTransactions")
        .withIndex("by_transaction_id", (q) => q.eq("transactionId", "transaction_1"))
        .collect();
    });

    expect(replayResult).toMatchObject({ added: 0, modified: 1, removed: 0 });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.amount).toBe(56780);
    expect(transactions[0]?.name).toBe("COFFEE SHOP UPDATED");
  });

  it("cleans existing duplicate transaction rows during modified handling", async () => {
    const t = convexTest(schema, modules);
    const plaidItemId = await seedPlaidItem(t);

    await t.run(async (ctx) => {
      for (const amount of [1000, 2000]) {
        await ctx.db.insert("plaidTransactions", {
          userId: "user_1",
          plaidItemId: String(plaidItemId),
          accountId: "account_1",
          transactionId: "transaction_1",
          amount,
          isoCurrencyCode: "USD",
          date: "2026-04-24",
          name: "OLD",
          pending: false,
          createdAt: Date.now(),
        });
      }
    });

    const result = await t.mutation(internal.private.bulkUpsertTransactions as any, {
      userId: "user_1",
      plaidItemId: String(plaidItemId),
      added: [],
      modified: [
        transformTransaction(
          plaidTransaction({
            amount: 90,
            name: "MODIFIED",
          }) as any
        ),
      ],
      removed: [],
    });

    const transactions = await t.run(async (ctx) => {
      return await ctx.db
        .query("plaidTransactions")
        .withIndex("by_transaction_id", (q) => q.eq("transactionId", "transaction_1"))
        .collect();
    });

    expect(result).toMatchObject({ added: 0, modified: 1, removed: 0 });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.amount).toBe(90000);
    expect(transactions[0]?.name).toBe("MODIFIED");
  });

  it("deletes all duplicate transaction rows during removed handling", async () => {
    const t = convexTest(schema, modules);
    const plaidItemId = await seedPlaidItem(t);

    await t.run(async (ctx) => {
      for (const amount of [1000, 2000]) {
        await ctx.db.insert("plaidTransactions", {
          userId: "user_1",
          plaidItemId: String(plaidItemId),
          accountId: "account_1",
          transactionId: "transaction_1",
          amount,
          isoCurrencyCode: "USD",
          date: "2026-04-24",
          name: "OLD",
          pending: false,
          createdAt: Date.now(),
        });
      }
    });

    const result = await t.mutation(internal.private.bulkUpsertTransactions as any, {
      userId: "user_1",
      plaidItemId: String(plaidItemId),
      added: [],
      modified: [],
      removed: ["transaction_1"],
    });

    const transactions = await t.run(async (ctx) => {
      return await ctx.db
        .query("plaidTransactions")
        .withIndex("by_transaction_id", (q) => q.eq("transactionId", "transaction_1"))
        .collect();
    });

    expect(result).toMatchObject({ added: 0, modified: 0, removed: 2 });
    expect(transactions).toHaveLength(0);
  });

  it("guards repeated item creation by Plaid itemId", async () => {
    const t = convexTest(schema, modules);
    const products = normalizePlaidProducts(["auth"]);

    const firstId = await t.mutation(internal.private.createPlaidItem as any, {
      userId: "user_1",
      itemId: "item_1",
      accessToken: "token_1",
      institutionId: "ins_1",
      institutionName: "Test Bank",
      products,
      isActive: true,
      status: "pending",
    });
    const duplicateId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("plaidItems", {
        userId: "user_1",
        itemId: "item_1",
        accessToken: "duplicate_token",
        institutionId: "ins_1",
        institutionName: "Duplicate Bank",
        products,
        isActive: true,
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.insert("plaidAccounts", {
        userId: "user_1",
        plaidItemId: String(id),
        accountId: "duplicate_child_account",
        name: "Duplicate Child Account",
        type: "credit",
        balances: {
          current: 1000,
          isoCurrencyCode: "USD",
        },
        createdAt: Date.now(),
      });
      return id;
    });
    const secondId = await t.mutation(internal.private.createPlaidItem as any, {
      userId: "user_1",
      itemId: "item_1",
      accessToken: "token_2",
      institutionId: "ins_1",
      institutionName: "Test Bank Updated",
      products,
      isActive: true,
      status: "active",
    });

    const items = await t.run(async (ctx) => {
      return await ctx.db
        .query("plaidItems")
        .withIndex("by_item_id", (q) => q.eq("itemId", "item_1"))
        .collect();
    });
    const reassignedAccount = await t.run(async (ctx) => {
      return await ctx.db
        .query("plaidAccounts")
        .withIndex("by_account_id", (q) => q.eq("accountId", "duplicate_child_account"))
        .first();
    });

    expect(String(duplicateId)).not.toBe(firstId);
    expect(secondId).toBe(firstId);
    expect(items).toHaveLength(1);
    expect(items[0]?.accessToken).toBe("token_2");
    expect(items[0]?.institutionName).toBe("Test Bank Updated");
    expect(items[0]?.products).toEqual(["auth", "transactions", "liabilities"]);
    expect(items[0]?.syncVersion).toBe(0);
    expect(reassignedAccount?.plaidItemId).toBe(firstId);
  });

  it("does not revive deleting Plaid items during duplicate item creation", async () => {
    const t = convexTest(schema, modules);
    const products = normalizePlaidProducts(["auth"]);

    const deletingId = await t.run(async (ctx) => {
      return await ctx.db.insert("plaidItems", {
        userId: "user_1",
        itemId: "item_1",
        accessToken: "deleting_token",
        institutionId: "ins_1",
        institutionName: "Deleting Bank",
        products,
        isActive: true,
        status: "deleting",
        createdAt: Date.now(),
      });
    });

    const activeId = await t.mutation(internal.private.createPlaidItem as any, {
      userId: "user_1",
      itemId: "item_1",
      accessToken: "active_token",
      institutionId: "ins_1",
      institutionName: "Active Bank",
      products,
      isActive: true,
      status: "active",
    });

    const items = await t.run(async (ctx) => {
      return await ctx.db
        .query("plaidItems")
        .withIndex("by_item_id", (q) => q.eq("itemId", "item_1"))
        .collect();
    });

    expect(activeId).not.toBe(String(deletingId));
    expect(items).toHaveLength(2);
    expect(items.find((item) => String(item._id) === String(deletingId))?.status).toBe("deleting");
    expect(items.find((item) => String(item._id) === activeId)?.status).toBe("active");
    expect(items.find((item) => String(item._id) === activeId)?.syncVersion).toBe(0);
  });

  it("merges duplicate item children by natural key during reassignment", async () => {
    const t = convexTest(schema, modules);
    const products = normalizePlaidProducts(["auth"]);

    const firstId = await t.mutation(internal.private.createPlaidItem as any, {
      userId: "user_1",
      itemId: "item_1",
      accessToken: "token_1",
      institutionId: "ins_1",
      institutionName: "Test Bank",
      products,
      isActive: true,
      status: "active",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("plaidAccounts", {
        userId: "user_1",
        plaidItemId: firstId,
        accountId: "account_1",
        name: "Target Account",
        type: "credit",
        balances: {
          current: 1000,
          isoCurrencyCode: "USD",
        },
        createdAt: Date.now(),
      });

      await ctx.db.insert("plaidTransactions", {
        userId: "user_1",
        plaidItemId: firstId,
        accountId: "account_1",
        transactionId: "transaction_1",
        amount: 1000,
        isoCurrencyCode: "USD",
        date: "2026-04-24",
        name: "TARGET",
        pending: false,
        createdAt: Date.now(),
      });

      const duplicateItemId = await ctx.db.insert("plaidItems", {
        userId: "user_1",
        itemId: "item_1",
        accessToken: "duplicate_token",
        institutionId: "ins_1",
        institutionName: "Duplicate Bank",
        products,
        isActive: true,
        status: "active",
        createdAt: Date.now(),
      });

      await ctx.db.insert("plaidAccounts", {
        userId: "user_1",
        plaidItemId: String(duplicateItemId),
        accountId: "account_1",
        name: "Duplicate Account",
        type: "credit",
        balances: {
          current: 2000,
          isoCurrencyCode: "USD",
        },
        createdAt: Date.now(),
      });

      await ctx.db.insert("plaidTransactions", {
        userId: "user_1",
        plaidItemId: String(duplicateItemId),
        accountId: "account_1",
        transactionId: "transaction_1",
        amount: 2000,
        isoCurrencyCode: "USD",
        date: "2026-04-24",
        name: "DUPLICATE",
        pending: false,
        createdAt: Date.now(),
      });
    });

    const secondId = await t.mutation(internal.private.createPlaidItem as any, {
      userId: "user_1",
      itemId: "item_1",
      accessToken: "token_2",
      institutionId: "ins_1",
      institutionName: "Test Bank Updated",
      products,
      isActive: true,
      status: "active",
    });

    const { accounts, transactions } = await t.run(async (ctx) => {
      return {
        accounts: await ctx.db
          .query("plaidAccounts")
          .withIndex("by_account_id", (q) => q.eq("accountId", "account_1"))
          .collect(),
        transactions: await ctx.db
          .query("plaidTransactions")
          .withIndex("by_transaction_id", (q) => q.eq("transactionId", "transaction_1"))
          .collect(),
      };
    });

    expect(secondId).toBe(firstId);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.plaidItemId).toBe(firstId);
    expect(accounts[0]?.name).toBe("Duplicate Account");
    expect(accounts[0]?.balances.current).toBe(2000);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.plaidItemId).toBe(firstId);
    expect(transactions[0]?.name).toBe("DUPLICATE");
    expect(transactions[0]?.amount).toBe(2000);
  });

  it("cleans duplicate accounts by Plaid accountId while upserting balances", async () => {
    const t = convexTest(schema, modules);
    const plaidItemId = await seedPlaidItem(t);

    await t.run(async (ctx) => {
      for (const name of ["Old Account A", "Old Account B"]) {
        await ctx.db.insert("plaidAccounts", {
          userId: "user_1",
          plaidItemId: String(plaidItemId),
          accountId: "account_1",
          name,
          type: "credit",
          subtype: "credit card",
          balances: {
            current: 1000,
            isoCurrencyCode: "USD",
          },
          createdAt: Date.now(),
        });
      }
    });

    const result = await t.mutation(internal.private.bulkUpsertAccounts as any, {
      userId: "user_1",
      plaidItemId: String(plaidItemId),
      accounts: [
        {
          accountId: "account_1",
          name: "Updated Account",
          officialName: "Updated Official Account",
          type: "credit",
          subtype: "credit card",
          balances: {
            current: 5000,
            available: 15000,
            limit: 20000,
            isoCurrencyCode: "USD",
          },
        },
      ],
    });

    const accounts = await t.run(async (ctx) => {
      return await ctx.db
        .query("plaidAccounts")
        .withIndex("by_account_id", (q) => q.eq("accountId", "account_1"))
        .collect();
    });

    expect(result).toMatchObject({ created: 0, updated: 1 });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.name).toBe("Updated Account");
    expect(accounts[0]?.balances.current).toBe(5000);
  });

  it("continues transaction sync while Plaid returns has_more", async () => {
    const pageOneTransaction = plaidTransaction({ transaction_id: "transaction_1" });
    const pageTwoTransaction = plaidTransaction({ transaction_id: "transaction_2" });
    const transactionsSync = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          added: [pageOneTransaction],
          modified: [],
          removed: [],
          next_cursor: "cursor_1",
          has_more: true,
        },
      })
      .mockResolvedValueOnce({
        data: {
          added: [pageTwoTransaction],
          modified: [],
          removed: [],
          next_cursor: "cursor_2",
          has_more: false,
        },
      });

    const result = await syncTransactionsPaginated(
      { transactionsSync } as any,
      "access-token",
      "",
      { maxPages: 5 }
    );

    expect(transactionsSync).toHaveBeenCalledTimes(2);
    expect(transactionsSync.mock.calls[0]?.[0].cursor).toBe("");
    expect(transactionsSync.mock.calls[1]?.[0].cursor).toBe("cursor_1");
    expect(result.added.map((transaction) => transaction.transaction_id)).toEqual([
      "transaction_1",
      "transaction_2",
    ]);
    expect(result.nextCursor).toBe("cursor_2");
    expect(result.hasMore).toBe(false);
    expect(result.pagesProcessed).toBe(2);
  });
});
