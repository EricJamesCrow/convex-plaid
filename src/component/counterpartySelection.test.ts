import { describe, expect, it } from "vitest";
import { selectMerchantCounterparty } from "./utils.js";

describe("selectMerchantCounterparty", () => {
  it("returns undefined for empty or missing counterparties", () => {
    expect(selectMerchantCounterparty(undefined)).toBeUndefined();
    expect(selectMerchantCounterparty(null)).toBeUndefined();
    expect(selectMerchantCounterparty([])).toBeUndefined();
  });

  it("picks the only merchant counterparty when one exists", () => {
    const result = selectMerchantCounterparty([
      { name: "Stripe", type: "marketplace", entity_id: "stripe" },
      { name: "Amazon", type: "merchant", entity_id: "amazon", confidence_level: "VERY_HIGH" },
    ]);
    expect(result?.entity_id).toBe("amazon");
    expect(result?.name).toBe("Amazon");
  });

  it("picks the highest-confidence merchant when multiple merchants exist", () => {
    const result = selectMerchantCounterparty([
      { name: "Square", type: "merchant", entity_id: "square_proc", confidence_level: "LOW" },
      { name: "Coffee Shop", type: "merchant", entity_id: "shop_x", confidence_level: "VERY_HIGH" },
      { name: "Other", type: "merchant", entity_id: "other_y", confidence_level: "MEDIUM" },
    ]);
    expect(result?.entity_id).toBe("shop_x");
  });

  it("treats missing or invalid confidence_level as UNKNOWN (lowest priority)", () => {
    const result = selectMerchantCounterparty([
      { name: "First", type: "merchant", entity_id: "first" },
      { name: "Second", type: "merchant", entity_id: "second", confidence_level: "MEDIUM" },
      { name: "Third", type: "merchant", entity_id: "third", confidence_level: "BOGUS_VALUE" },
    ]);
    expect(result?.entity_id).toBe("second");
  });

  it("falls back to first counterparty with entity_id when no merchant-typed entry exists", () => {
    const result = selectMerchantCounterparty([
      { name: "Marketplace", type: "marketplace", entity_id: "mp_1" },
      { name: "Other", type: "income_source", entity_id: "inc_1" },
    ]);
    expect(result?.entity_id).toBe("mp_1");
  });

  it("ignores merchant-typed entries without entity_id and falls back appropriately", () => {
    const result = selectMerchantCounterparty([
      { name: "Bare merchant", type: "merchant" },
      { name: "Marketplace with id", type: "marketplace", entity_id: "mp_x" },
    ]);
    expect(result?.entity_id).toBe("mp_x");
  });

  it("returns the first merchant for stable tie-break when confidences are equal", () => {
    const result = selectMerchantCounterparty([
      { name: "First", type: "merchant", entity_id: "a", confidence_level: "HIGH" },
      { name: "Second", type: "merchant", entity_id: "b", confidence_level: "HIGH" },
    ]);
    expect(result?.entity_id).toBe("a");
  });
});
