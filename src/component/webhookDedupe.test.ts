import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api } from "./_generated/api.js";

// Vite's import.meta.glob is not in the standard ImportMeta type.
const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

describe("Plaid webhook dedupe", () => {
  it("dedupes in-flight retries without suppressing completed repeated events", async () => {
    const t = convexTest(schema, modules);
    const receivedAt = Date.now();

    const first = await t.mutation(api.public.recordWebhookReceived as any, {
      itemId: "item_1",
      webhookType: "TRANSACTIONS",
      webhookCode: "SYNC_UPDATES_AVAILABLE",
      bodyHash: "hash_1",
      receivedAt,
    });

    expect(first.duplicate).toBe(false);

    const retry = await t.mutation(api.public.recordWebhookReceived as any, {
      itemId: "item_1",
      webhookType: "TRANSACTIONS",
      webhookCode: "SYNC_UPDATES_AVAILABLE",
      bodyHash: "hash_1",
      receivedAt: receivedAt + 1,
    });

    expect(retry.duplicate).toBe(true);
    expect(retry.duplicateOf).toBe(first.webhookLogId);

    await t.mutation(api.public.updateWebhookProcessingStatus as any, {
      webhookLogId: first.webhookLogId,
      status: "processed",
      processedAt: receivedAt + 2,
    });

    const repeatedValidEvent = await t.mutation(api.public.recordWebhookReceived as any, {
      itemId: "item_1",
      webhookType: "TRANSACTIONS",
      webhookCode: "SYNC_UPDATES_AVAILABLE",
      bodyHash: "hash_1",
      receivedAt: receivedAt + 3,
    });

    expect(repeatedValidEvent.duplicate).toBe(false);
  });
});
