import { describe, it, expect } from "vitest";

describe("Plaid client", () => {
  it("should be importable", async () => {
    const { Plaid } = await import("./index.js");
    expect(Plaid).toBeDefined();
  });
});
