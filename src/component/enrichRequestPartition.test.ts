import { describe, expect, it } from "vitest";
import {
  partitionEnrichmentInput,
  type EnrichInputTransaction,
} from "./utils.js";

const baseInput: Omit<EnrichInputTransaction, "account_type" | "id"> = {
  description: "AMAZON MKTPL*B90",
  amount: 12.34,
  direction: "OUTFLOW",
};

describe("partitionEnrichmentInput", () => {
  it("returns empty partitions for empty input", () => {
    const result = partitionEnrichmentInput([]);
    expect(result.credit).toEqual([]);
    expect(result.depository).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("groups credit and depository transactions into separate partitions", () => {
    const input: EnrichInputTransaction[] = [
      { ...baseInput, id: "t1", account_type: "credit" },
      { ...baseInput, id: "t2", account_type: "depository" },
      { ...baseInput, id: "t3", account_type: "credit" },
    ];
    const result = partitionEnrichmentInput(input);
    expect(result.credit.map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(result.depository.map((t) => t.id)).toEqual(["t2"]);
    expect(result.skipped).toEqual([]);
  });

  it("skips unsupported account types (loan, investment, other)", () => {
    const input: EnrichInputTransaction[] = [
      { ...baseInput, id: "loan_1", account_type: "loan" as never },
      { ...baseInput, id: "inv_1", account_type: "investment" as never },
      { ...baseInput, id: "other_1", account_type: "other" as never },
      { ...baseInput, id: "ok_1", account_type: "credit" },
    ];
    const result = partitionEnrichmentInput(input);
    expect(result.credit.map((t) => t.id)).toEqual(["ok_1"]);
    expect(result.depository).toEqual([]);
    expect(result.skipped.map((t) => t.id)).toEqual(["loan_1", "inv_1", "other_1"]);
  });

  it("preserves all input fields on the partitioned transactions", () => {
    const input: EnrichInputTransaction[] = [
      {
        id: "t1",
        description: "PURCHASE WM SUPERCENTER #1700",
        amount: 42.5,
        direction: "OUTFLOW",
        iso_currency_code: "USD",
        mcc: "5411",
        account_type: "credit",
        location: { city: "Poway", region: "CA", country: "US" },
      },
    ];
    const result = partitionEnrichmentInput(input);
    expect(result.credit).toHaveLength(1);
    expect(result.credit[0]).toMatchObject({
      id: "t1",
      description: "PURCHASE WM SUPERCENTER #1700",
      amount: 42.5,
      direction: "OUTFLOW",
      iso_currency_code: "USD",
      mcc: "5411",
      location: { city: "Poway", region: "CA", country: "US" },
    });
  });
});
