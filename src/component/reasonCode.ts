/**
 * Structured reason codes for Plaid item health.
 *
 * Maps Plaid error codes (and non-error states) to a stable enum the host app
 * translates to user-facing copy. See W4 spec Section 6.5 for the canonical
 * table. This module is pure and side-effect-free; do not add side effects.
 */

export type ReasonCode =
  | "healthy"
  | "syncing_initial"
  | "syncing_incremental"
  | "auth_required_login"
  | "auth_required_expiration"
  | "transient_circuit_open"
  | "transient_institution_down"
  | "transient_rate_limited"
  | "permanent_invalid_token"
  | "permanent_item_not_found"
  | "permanent_no_accounts"
  | "permanent_access_not_granted"
  | "permanent_products_not_supported"
  | "permanent_institution_unsupported"
  | "permanent_revoked"
  | "permanent_unknown"
  | "new_accounts_available";

const ERROR_CODE_MAP: Record<string, ReasonCode> = {
  ITEM_LOGIN_REQUIRED: "auth_required_login",
  INVALID_ACCESS_TOKEN: "permanent_invalid_token",
  ITEM_NOT_FOUND: "permanent_item_not_found",
  ACCESS_NOT_GRANTED: "permanent_access_not_granted",
  INVALID_CREDENTIALS: "auth_required_login",
  INSUFFICIENT_CREDENTIALS: "auth_required_login",
  USER_SETUP_REQUIRED: "auth_required_login",
  MFA_NOT_SUPPORTED: "permanent_unknown",
  NO_ACCOUNTS: "permanent_no_accounts",
  ITEM_LOCKED: "auth_required_login",
  ITEM_NOT_SUPPORTED: "permanent_products_not_supported",
  INVALID_MFA: "auth_required_login",
  INVALID_SEND_METHOD: "auth_required_login",
  TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION: "transient_rate_limited",
  INTERNAL_SERVER_ERROR: "transient_institution_down",
  RATE_LIMIT_EXCEEDED: "transient_rate_limited",
  INSTITUTION_DOWN: "transient_institution_down",
  INSTITUTION_NOT_RESPONDING: "transient_institution_down",
  INSTITUTION_NO_CREDENTIALS: "auth_required_login",
  PLAID_ERROR: "transient_institution_down",
  INSTITUTION_NO_LONGER_SUPPORTED: "permanent_institution_unsupported",
  USER_PERMISSION_REVOKED: "permanent_revoked",
};

export function mapErrorCodeToReason(errorCode: string | null): ReasonCode {
  if (!errorCode) return "permanent_unknown";
  return ERROR_CODE_MAP[errorCode] ?? "permanent_unknown";
}
