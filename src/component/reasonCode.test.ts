/**
 * W4: mapErrorCodeToReason taxonomy
 *
 * One test per row of the W4 spec Section 6.5 table, plus null + unknown.
 */

import { describe, expect, it } from "vitest";
import { mapErrorCodeToReason } from "./reasonCode.js";

describe("mapErrorCodeToReason", () => {
  const cases: Array<[string | null, string]> = [
    ["ITEM_LOGIN_REQUIRED", "auth_required_login"],
    ["INVALID_ACCESS_TOKEN", "permanent_invalid_token"],
    ["ITEM_NOT_FOUND", "permanent_item_not_found"],
    ["ACCESS_NOT_GRANTED", "permanent_access_not_granted"],
    ["INVALID_CREDENTIALS", "auth_required_login"],
    ["INSUFFICIENT_CREDENTIALS", "auth_required_login"],
    ["USER_SETUP_REQUIRED", "auth_required_login"],
    ["MFA_NOT_SUPPORTED", "permanent_unknown"],
    ["NO_ACCOUNTS", "permanent_no_accounts"],
    ["ITEM_LOCKED", "auth_required_login"],
    ["ITEM_NOT_SUPPORTED", "permanent_products_not_supported"],
    ["INVALID_MFA", "auth_required_login"],
    ["INVALID_SEND_METHOD", "auth_required_login"],
    ["TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", "transient_rate_limited"],
    ["INTERNAL_SERVER_ERROR", "transient_institution_down"],
    ["RATE_LIMIT_EXCEEDED", "transient_rate_limited"],
    ["INSTITUTION_DOWN", "transient_institution_down"],
    ["INSTITUTION_NOT_RESPONDING", "transient_institution_down"],
    ["INSTITUTION_NO_CREDENTIALS", "auth_required_login"],
    ["PLAID_ERROR", "transient_institution_down"],
    ["INSTITUTION_NO_LONGER_SUPPORTED", "permanent_institution_unsupported"],
    ["USER_PERMISSION_REVOKED", "permanent_revoked"],
    ["SOME_UNRECOGNIZED_CODE", "permanent_unknown"],
    [null, "permanent_unknown"],
  ];

  for (const [code, expected] of cases) {
    it(`maps ${code ?? "null"} -> ${expected}`, () => {
      expect(mapErrorCodeToReason(code)).toBe(expected);
    });
  }
});
