import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { internal } from "./_generated/api.js";
import { transformTransaction } from "./utils.js";

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
    name: "PEACOCK",
    merchant_name: "Peacock",
    pending: false,
    pending_transaction_id: null,
    personal_finance_category: {
      primary: "ENTERTAINMENT",
      detailed: "ENTERTAINMENT_TV_AND_MOVIES",
    },
    payment_channel: "online",
    ...overrides,
  };
}

describe("transaction merchant enrichment", () => {
  it("preserves Plaid sync merchant logo fields during transform", () => {
    const transformed: any = transformTransaction(
      plaidTransaction({
        merchant_entity_id: "merchant_peacock",
        logo_url: "https://plaid-merchant-logos.plaid.com/peacock.png",
        website: "peacocktv.com",
        personal_finance_category_icon_url:
          "https://plaid-category-icons.plaid.com/PFC_ENTERTAINMENT.png",
      }) as any
    );

    expect(transformed.merchantId).toBe("merchant_peacock");
    expect(transformed.enrichmentData?.counterpartyLogoUrl).toBe(
      "https://plaid-merchant-logos.plaid.com/peacock.png"
    );
    expect(transformed.merchantEnrichment).toMatchObject({
      merchantId: "merchant_peacock",
      merchantName: "Peacock",
      logoUrl: "https://plaid-merchant-logos.plaid.com/peacock.png",
      website: "peacocktv.com",
      categoryPrimary: "ENTERTAINMENT",
      categoryDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
      categoryIconUrl: "https://plaid-category-icons.plaid.com/PFC_ENTERTAINMENT.png",
    });
  });

  it("falls back to merchant counterparties when top-level entity fields are missing", () => {
    const transformed: any = transformTransaction(
      plaidTransaction({
        merchant_entity_id: null,
        merchant_name: null,
        counterparties: [
          {
            name: "Peacock",
            type: "merchant",
            entity_id: "merchant_peacock",
            logo_url: "https://plaid-merchant-logos.plaid.com/peacock.png",
            confidence_level: "VERY_HIGH",
          },
        ],
      }) as any
    );

    expect(transformed.merchantId).toBe("merchant_peacock");
    expect(transformed.merchantEnrichment).toMatchObject({
      merchantName: "Peacock",
      logoUrl: "https://plaid-merchant-logos.plaid.com/peacock.png",
      confidenceLevel: "VERY_HIGH",
    });
  });

  it("upserts merchant rows and links transactions during sync storage", async () => {
    const t = convexTest(schema, modules);
    const plaidItemId = await t.run(async (ctx) => {
      return await ctx.db.insert("plaidItems", {
        userId: "user_1",
        itemId: "item_1",
        accessToken: "fake-jwe",
        products: ["transactions"],
        status: "active",
        createdAt: Date.now(),
      });
    });

    const enrichedTransaction = transformTransaction(
      plaidTransaction({
        merchant_entity_id: "merchant_peacock",
        logo_url: "https://plaid-merchant-logos.plaid.com/peacock.png",
      }) as any
    );

    await t.mutation(internal.private.bulkUpsertTransactions as any, {
      userId: "user_1",
      plaidItemId: String(plaidItemId),
      added: [enrichedTransaction],
      modified: [],
      removed: [],
    });

    const stored = await t.run(async (ctx) => {
      const transaction = await ctx.db
        .query("plaidTransactions")
        .withIndex("by_transaction_id", (q) => q.eq("transactionId", "transaction_1"))
        .first();
      const merchant = await ctx.db
        .query("merchantEnrichments")
        .withIndex("by_merchant", (q) => q.eq("merchantId", "merchant_peacock"))
        .first();
      return { transaction, merchant };
    });

    expect(stored.transaction?.merchantId).toBe("merchant_peacock");
    expect(stored.transaction?.enrichmentData?.counterpartyLogoUrl).toBe(
      "https://plaid-merchant-logos.plaid.com/peacock.png"
    );
    expect(stored.merchant?.logoUrl).toBe("https://plaid-merchant-logos.plaid.com/peacock.png");
  });

  it("preserves a known merchant logo when a later sync omits optional logo fields", async () => {
    const t = convexTest(schema, modules);
    const plaidItemId = await t.run(async (ctx) => {
      return await ctx.db.insert("plaidItems", {
        userId: "user_1",
        itemId: "item_1",
        accessToken: "fake-jwe",
        products: ["transactions"],
        status: "active",
        createdAt: Date.now(),
      });
    });

    await t.mutation(internal.private.bulkUpsertTransactions as any, {
      userId: "user_1",
      plaidItemId: String(plaidItemId),
      added: [
        transformTransaction(
          plaidTransaction({
            merchant_entity_id: "merchant_peacock",
            logo_url: "https://plaid-merchant-logos.plaid.com/peacock.png",
          }) as any
        ),
      ],
      modified: [],
      removed: [],
    });

    await t.mutation(internal.private.bulkUpsertTransactions as any, {
      userId: "user_1",
      plaidItemId: String(plaidItemId),
      added: [],
      modified: [
        transformTransaction(
          plaidTransaction({
            merchant_entity_id: "merchant_peacock",
            logo_url: null,
          }) as any
        ),
      ],
      removed: [],
    });

    const merchant = await t.run(async (ctx) => {
      return await ctx.db
        .query("merchantEnrichments")
        .withIndex("by_merchant", (q) => q.eq("merchantId", "merchant_peacock"))
        .first();
    });

    expect(merchant?.logoUrl).toBe("https://plaid-merchant-logos.plaid.com/peacock.png");
  });

  it("backfills merchant enrichment onto existing transactions without inserting rows", async () => {
    const t = convexTest(schema, modules);
    const plaidItemId = await t.run(async (ctx) => {
      return await ctx.db.insert("plaidItems", {
        userId: "user_1",
        itemId: "item_1",
        accessToken: "fake-jwe",
        products: ["transactions"],
        status: "active",
        createdAt: Date.now(),
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("plaidTransactions", {
        userId: "user_1",
        plaidItemId: String(plaidItemId),
        accountId: "account_1",
        transactionId: "transaction_1",
        amount: 12340,
        isoCurrencyCode: "USD",
        date: "2026-04-24",
        name: "PEACOCK",
        merchantName: "Peacock",
        pending: false,
        categoryPrimary: "ENTERTAINMENT",
        categoryDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
        paymentChannel: "online",
        createdAt: Date.now(),
      });
    });

    const result = await t.mutation(internal.private.backfillTransactionEnrichments as any, {
      plaidItemId: String(plaidItemId),
      transactions: [
        transformTransaction(
          plaidTransaction({
            merchant_entity_id: "merchant_peacock",
            logo_url: "https://plaid-merchant-logos.plaid.com/peacock.png",
          }) as any
        ),
      ],
    });

    const stored = await t.run(async (ctx) => {
      const transactions = await ctx.db.query("plaidTransactions").collect();
      const merchant = await ctx.db
        .query("merchantEnrichments")
        .withIndex("by_merchant", (q) => q.eq("merchantId", "merchant_peacock"))
        .first();
      return { transactions, merchant };
    });

    expect(result).toMatchObject({
      scanned: 1,
      matched: 1,
      updated: 1,
      merchantsUpserted: 1,
    });
    expect(stored.transactions).toHaveLength(1);
    expect(stored.transactions[0]?.merchantId).toBe("merchant_peacock");
    expect(stored.merchant?.logoUrl).toBe("https://plaid-merchant-logos.plaid.com/peacock.png");
  });

  it("captures original_description from Plaid sync when present", () => {
    const transformed: any = transformTransaction(
      plaidTransaction({
        original_description: "PURCHASE AUTHORIZED 04/24 PEACOCK NBCUNI 800-XXXXXXX",
      }) as any
    );
    expect(transformed.originalDescription).toBe(
      "PURCHASE AUTHORIZED 04/24 PEACOCK NBCUNI 800-XXXXXXX"
    );
  });

  it("omits originalDescription when Plaid does not return it", () => {
    const transformed: any = transformTransaction(plaidTransaction() as any);
    expect(transformed.originalDescription).toBeUndefined();
  });
});
