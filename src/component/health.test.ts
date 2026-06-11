/**
 * W4: derive() unit tests.
 *
 * One test per branch of the derivation algorithm (spec §6.4) plus the
 * metadata-carrier test. Pure function; no convex-test needed.
 */

import { describe, expect, it } from "vitest";
import { derive, type InstitutionSnapshot, type PlaidItemSnapshot } from "./health.js";

const baseItem: PlaidItemSnapshot = {
  _id: "j_item_1",
  itemId: "item_1",
  status: "active",
  circuitState: "closed",
  consecutiveFailures: 0,
};

const baseInstitution: InstitutionSnapshot = {
  institutionId: "ins_1",
  institutionName: "Acme Bank",
  institutionLogoBase64: null,
  institutionPrimaryColor: null,
};

describe("derive", () => {
  it("deleting -> filtered-out sentinel", () => {
    const h = derive({ ...baseItem, status: "deleting" }, baseInstitution, null);
    expect(h.state).toBe("error");
    expect(h.recommendedAction).toBe(null);
    expect(h.reasonCode).toBe("permanent_unknown");
  });

  it("needs_reauth -> re-consent-required + reconnect + auth_required_login", () => {
    const h = derive(
      { ...baseItem, status: "needs_reauth", reauthReason: "ITEM_LOGIN_REQUIRED" },
      baseInstitution,
      null,
    );
    expect(h.state).toBe("re-consent-required");
    expect(h.recommendedAction).toBe("reconnect");
    expect(h.reasonCode).toBe("auth_required_login");
  });

  it("needs_reauth with 'expir' in reason -> auth_required_expiration", () => {
    const h = derive(
      { ...baseItem, status: "needs_reauth", reauthReason: "Credentials expiring: 2026-06-01" },
      baseInstitution,
      null,
    );
    expect(h.reasonCode).toBe("auth_required_expiration");
  });

  it("circuitState=open (status active) -> error + wait + transient_circuit_open", () => {
    const h = derive({ ...baseItem, circuitState: "open" }, baseInstitution, null);
    expect(h.state).toBe("error");
    expect(h.recommendedAction).toBe("wait");
    expect(h.reasonCode).toBe("transient_circuit_open");
  });

  it("status=error, circuit closed, errorCode=INVALID_ACCESS_TOKEN -> contact_support + permanent_invalid_token", () => {
    const h = derive(
      { ...baseItem, status: "error", errorCode: "INVALID_ACCESS_TOKEN" },
      baseInstitution,
      null,
    );
    expect(h.state).toBe("error");
    expect(h.recommendedAction).toBe("contact_support");
    expect(h.reasonCode).toBe("permanent_invalid_token");
  });

  it("status=error, circuit closed, errorCode=INSTITUTION_DOWN -> wait + transient_institution_down", () => {
    const h = derive(
      { ...baseItem, status: "error", errorCode: "INSTITUTION_DOWN" },
      baseInstitution,
      null,
    );
    expect(h.recommendedAction).toBe("wait");
    expect(h.reasonCode).toBe("transient_institution_down");
  });

  it("circuitState=half_open -> syncing + null + syncing_incremental", () => {
    const h = derive({ ...baseItem, circuitState: "half_open" }, baseInstitution, null);
    expect(h.state).toBe("syncing");
    expect(h.recommendedAction).toBe(null);
    expect(h.reasonCode).toBe("syncing_incremental");
  });

  it("status=pending -> syncing + syncing_initial", () => {
    const h = derive({ ...baseItem, status: "pending" }, baseInstitution, null);
    expect(h.reasonCode).toBe("syncing_initial");
  });

  it("status=syncing -> syncing_incremental", () => {
    const h = derive({ ...baseItem, status: "syncing" }, baseInstitution, null);
    expect(h.reasonCode).toBe("syncing_incremental");
  });

  it("status=active, newAccountsAvailableAt set -> ready + reconnect_for_new_accounts + new_accounts_available", () => {
    const h = derive(
      { ...baseItem, status: "active", newAccountsAvailableAt: Date.now() },
      baseInstitution,
      null,
    );
    expect(h.state).toBe("ready");
    expect(h.recommendedAction).toBe("reconnect_for_new_accounts");
    expect(h.reasonCode).toBe("new_accounts_available");
  });

  it("status=active, no newAccountsAvailableAt -> healthy", () => {
    const h = derive({ ...baseItem }, baseInstitution, null);
    expect(h.state).toBe("ready");
    expect(h.recommendedAction).toBe(null);
    expect(h.reasonCode).toBe("healthy");
  });

  it("carries institutionName / logo / color through", () => {
    const h = derive(
      { ...baseItem },
      {
        ...baseInstitution,
        institutionLogoBase64: "abc",
        institutionPrimaryColor: "#ff0000",
      },
      null,
    );
    expect(h.institutionName).toBe("Acme Bank");
    expect(h.institutionLogoBase64).toBe("abc");
    expect(h.institutionPrimaryColor).toBe("#ff0000");
  });

  it("forwards lastWebhookAt", () => {
    const ts = 123456789;
    const h = derive({ ...baseItem }, baseInstitution, ts);
    expect(h.lastWebhookAt).toBe(ts);
  });
});
