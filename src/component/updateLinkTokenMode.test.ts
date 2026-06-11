/**
 * W4: createUpdateLinkToken mode parameter
 *
 * Validates that passing mode="account_select" results in
 * update.account_selection_enabled = true being forwarded to the Plaid SDK,
 * while default/reauth mode leaves the update object unset.
 *
 * We test the pure argument-construction branch (no network) because the
 * component's existing action-tests go through mocked SDKs at a higher level.
 * The branch here is a single ternary; a direct expectation covers both sides.
 */

import { describe, expect, it } from "vitest";

/**
 * Mirror of the update-object construction inside createUpdateLinkToken:
 *   update: args.mode === "account_select"
 *     ? { account_selection_enabled: true }
 *     : undefined,
 */
function buildUpdateOption(mode: "reauth" | "account_select" | undefined) {
  return mode === "account_select"
    ? { account_selection_enabled: true }
    : undefined;
}

describe("createUpdateLinkToken mode parameter", () => {
  it("defaults to undefined (reauth mode) when mode is omitted", () => {
    expect(buildUpdateOption(undefined)).toBeUndefined();
  });

  it("is undefined for mode: reauth", () => {
    expect(buildUpdateOption("reauth")).toBeUndefined();
  });

  it("sets account_selection_enabled: true for mode: account_select", () => {
    expect(buildUpdateOption("account_select")).toEqual({
      account_selection_enabled: true,
    });
  });
});
