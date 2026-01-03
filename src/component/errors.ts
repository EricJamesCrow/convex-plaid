/**
 * Plaid Error Handling
 *
 * Structured error types with categorization for proper handling:
 * - retryable: Transient errors that should be retried with backoff
 * - auth_required: Errors requiring user re-authentication
 * - permanent: Non-recoverable errors
 */

// =============================================================================
// ERROR TYPES
// =============================================================================

export type PlaidErrorCategory = "retryable" | "permanent" | "auth_required";

export interface PlaidSyncError {
  category: PlaidErrorCategory;
  code: string;
  message: string;
  originalError?: unknown;
}

// =============================================================================
// ERROR CODE CLASSIFICATION
// =============================================================================

/**
 * Error codes that should trigger retry with exponential backoff.
 * These are transient errors that may resolve on their own.
 */
const RETRYABLE_ERRORS = new Set([
  "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
  "INTERNAL_SERVER_ERROR",
  "RATE_LIMIT_EXCEEDED",
  "INSTITUTION_DOWN",
  "INSTITUTION_NOT_RESPONDING",
  "INSTITUTION_NO_CREDENTIALS",
  "PLAID_ERROR",
]);

/**
 * Error codes that require user to re-authenticate via Link.
 * These indicate the access token is no longer valid.
 */
const AUTH_REQUIRED_ERRORS = new Set([
  "ITEM_LOGIN_REQUIRED",
  "INVALID_ACCESS_TOKEN",
  "ITEM_NOT_FOUND",
  "ACCESS_NOT_GRANTED",
  "INVALID_CREDENTIALS",
  "INSUFFICIENT_CREDENTIALS",
  "USER_SETUP_REQUIRED",
  "MFA_NOT_SUPPORTED",
  "NO_ACCOUNTS",
  "ITEM_LOCKED",
  "ITEM_NOT_SUPPORTED",
  "INVALID_MFA",
  "INVALID_SEND_METHOD",
]);

// =============================================================================
// ERROR UTILITIES
// =============================================================================

/**
 * Extract Plaid error code from various error formats.
 *
 * Plaid errors come in several formats:
 * 1. Axios error with response.data.error_code
 * 2. PlaidError with error_code property
 * 3. Plain object with error_code
 */
function extractErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "UNKNOWN";
  }

  const err = error as Record<string, unknown>;

  // Axios-style error (response.data.error_code)
  if (err.response && typeof err.response === "object") {
    const response = err.response as Record<string, unknown>;
    if (response.data && typeof response.data === "object") {
      const data = response.data as Record<string, unknown>;
      if (typeof data.error_code === "string") {
        return data.error_code;
      }
    }
  }

  // Direct error_code property
  if (typeof err.error_code === "string") {
    return err.error_code;
  }

  // Nested error object
  if (err.error && typeof err.error === "object") {
    const nested = err.error as Record<string, unknown>;
    if (typeof nested.error_code === "string") {
      return nested.error_code;
    }
  }

  return "UNKNOWN";
}

/**
 * Extract error message from various error formats.
 */
function extractErrorMessage(error: unknown): string {
  if (!error) {
    return "Unknown error";
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object") {
    const err = error as Record<string, unknown>;

    // Axios-style error
    if (err.response && typeof err.response === "object") {
      const response = err.response as Record<string, unknown>;
      if (response.data && typeof response.data === "object") {
        const data = response.data as Record<string, unknown>;
        if (typeof data.error_message === "string") {
          return data.error_message;
        }
      }
    }

    // Direct error_message property
    if (typeof err.error_message === "string") {
      return err.error_message;
    }

    // Message property
    if (typeof err.message === "string") {
      return err.message;
    }
  }

  return "Unknown error";
}

// =============================================================================
// MAIN FUNCTIONS
// =============================================================================

/**
 * Categorize an error into retryable, auth_required, or permanent.
 *
 * @param error - The caught error (any format)
 * @returns Structured PlaidSyncError with category
 */
export function categorizeError(error: unknown): PlaidSyncError {
  const code = extractErrorCode(error);
  const message = extractErrorMessage(error);

  let category: PlaidErrorCategory;

  if (AUTH_REQUIRED_ERRORS.has(code)) {
    category = "auth_required";
  } else if (RETRYABLE_ERRORS.has(code)) {
    category = "retryable";
  } else {
    category = "permanent";
  }

  return {
    category,
    code,
    message,
    originalError: error,
  };
}

/**
 * Check if an error should be retried.
 */
export function isRetryable(error: PlaidSyncError): boolean {
  return error.category === "retryable";
}

/**
 * Check if an error requires user re-authentication.
 */
export function requiresReauth(error: PlaidSyncError): boolean {
  return error.category === "auth_required";
}

/**
 * Check if an error is permanent and non-recoverable.
 */
export function isPermanent(error: PlaidSyncError): boolean {
  return error.category === "permanent";
}

/**
 * Format error for logging with consistent structure.
 *
 * Accepts either a PlaidSyncError or any unknown error.
 * If passed a raw error, it will be categorized first.
 */
export function formatErrorForLog(error: PlaidSyncError | unknown): string {
  // Handle raw errors by categorizing them first
  if (!error || typeof error !== "object") {
    return `[PERMANENT] UNKNOWN: ${String(error)}`;
  }

  const err = error as Record<string, unknown>;

  // Check if it's already a PlaidSyncError (has category, code, message)
  if (
    typeof err.category === "string" &&
    typeof err.code === "string" &&
    typeof err.message === "string"
  ) {
    return `[${err.category.toUpperCase()}] ${err.code}: ${err.message}`;
  }

  // Otherwise, categorize the raw error first
  const categorized = categorizeError(error);
  return `[${categorized.category.toUpperCase()}] ${categorized.code}: ${categorized.message}`;
}
