import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";

// Vite's import.meta.glob is not in the standard ImportMeta type.
const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

async function seedTransaction(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<Omit<Doc<"plaidTransactions">, "_id" | "_creationTime">>,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("plaidTransactions", {
      userId: "user_1",
      plaidItemId: "item_1",
      accountId: "account_1",
      transactionId: "txn_default",
      amount: 1000,
      isoCurrencyCode: "USD",
      date: "2026-04-01",
      name: "Default Merchant",
      pending: false,
      createdAt: 1,
      ...overrides,
    });
  });
}

async function seedRecurringStream(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<Omit<Doc<"plaidRecurringStreams">, "_id" | "_creationTime">>,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("plaidRecurringStreams", {
      userId: "user_1",
      plaidItemId: "item_1",
      streamId: "stream_default",
      accountId: "account_1",
      description: "Default recurring stream",
      averageAmount: 1000,
      lastAmount: 1000,
      isoCurrencyCode: "USD",
      frequency: "MONTHLY",
      status: "MATURE",
      isActive: true,
      type: "outflow",
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    });
  });
}

async function seedSyncLog(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<Omit<Doc<"syncLogs">, "_id" | "_creationTime">>,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("syncLogs", {
      plaidItemId: "item_1",
      userId: "user_1",
      syncType: "transactions",
      trigger: "manual",
      startedAt: 1,
      status: "success",
      ...overrides,
    });
  });
}

describe("Plaid public query scale guardrails", () => {
  it("narrows user transactions by indexed date range and bounded limit", async () => {
    const t = convexTest(schema, modules);

    for (let day = 1; day <= 8; day++) {
      await seedTransaction(t, {
        transactionId: `txn_${day}`,
        date: `2026-04-${String(day).padStart(2, "0")}`,
        amount: day * 1000,
        createdAt: day,
      });
    }
    await seedTransaction(t, {
      userId: "user_2",
      transactionId: "other_user_txn",
      date: "2026-04-07",
      createdAt: 99,
    });
    const result = await t.query(api.public.getTransactionsByUser, {
      userId: "user_1",
      startDate: "2026-04-03",
      endDate: "2026-04-07",
      limit: 3,
    });

    expect(result.map((txn) => txn.transactionId)).toEqual([
      "txn_7",
      "txn_6",
      "txn_5",
    ]);
    expect(result.every((txn) => txn.userId === "user_1")).toBe(true);
  });

  it("hydrates requested transaction IDs directly instead of relying on a recent window", async () => {
    const t = convexTest(schema, modules);

    await seedTransaction(t, {
      transactionId: "txn_old",
      date: "2024-01-01",
      createdAt: 1,
    });
    await seedTransaction(t, {
      transactionId: "txn_new",
      date: "2026-04-01",
      createdAt: 2,
      pendingTransactionId: "pending_1",
      paymentChannel: "online",
      updatedAt: 12345,
    });

    const result = await t.query(api.public.getTransactionsByUser, {
      userId: "user_1",
      transactionIds: ["txn_new", "txn_old"],
      limit: 2,
    });

    expect(result.map((txn) => txn.transactionId)).toEqual([
      "txn_new",
      "txn_old",
    ]);
    expect(result[0]).toMatchObject({
      pendingTransactionId: "pending_1",
      paymentChannel: "online",
      updatedAt: 12345,
    });
  });

  it("uses indexed recurring stream filters with bounded active subscription reads", async () => {
    const t = convexTest(schema, modules);

    await seedRecurringStream(t, {
      streamId: "old_subscription",
      updatedAt: 10,
    });
    await seedRecurringStream(t, {
      streamId: "new_subscription",
      updatedAt: 30,
    });
    await seedRecurringStream(t, {
      streamId: "middle_subscription",
      updatedAt: 20,
    });
    await seedRecurringStream(t, {
      streamId: "income_stream",
      type: "inflow",
      updatedAt: 40,
    });
    await seedRecurringStream(t, {
      streamId: "inactive_subscription",
      isActive: false,
      updatedAt: 50,
    });

    const subscriptions = await t.query(api.public.getActiveSubscriptions, {
      userId: "user_1",
      limit: 2,
    });
    const summary = await t.query(api.public.getSubscriptionsSummary, {
      userId: "user_1",
    });

    expect(subscriptions.map((stream) => stream.streamId)).toEqual([
      "new_subscription",
      "middle_subscription",
    ]);
    expect(summary.count).toBe(3);
  });

  it("uses startedAt indexes for bounded sync logs and recent sync stats", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    await seedSyncLog(t, {
      startedAt: now - 10 * 24 * 60 * 60 * 1000,
      status: "error",
      errorMessage: "old failure",
    });
    await seedSyncLog(t, {
      startedAt: now - 2_000,
      status: "success",
      durationMs: 120,
    });
    await seedSyncLog(t, {
      startedAt: now - 1_000,
      status: "rate_limited",
      errorMessage: "recent throttle",
      durationMs: 80,
    });
    await seedSyncLog(t, {
      plaidItemId: "item_2",
      startedAt: now,
      status: "success",
    });

    const logs = await t.query(api.public.getSyncLogsByUser, {
      userId: "user_1",
      limit: 2,
    });
    const stats = await t.query(api.public.getSyncStats, {
      plaidItemId: "item_1",
      daysBack: 7,
    });

    expect(logs.map((log) => log.startedAt)).toEqual([now, now - 1_000]);
    expect(stats).toMatchObject({
      totalSyncs: 2,
      successCount: 1,
      errorCount: 1,
      successRate: 50,
      lastErrorMessage: "recent throttle",
    });
    expect(stats.averageDurationMs).toBe(100);
  });
});
