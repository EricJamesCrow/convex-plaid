/**
 * Error Handling Module Tests
 *
 * Tests for Plaid error categorization and handling utilities.
 * These functions determine retry behavior and user re-auth requirements.
 */

import { describe, it, expect } from "vitest";
import {
  categorizeError,
  isRetryable,
  requiresReauth,
  isPermanent,
  formatErrorForLog,
  type PlaidSyncError,
} from "./errors.js";

describe("Error Handling Module", () => {
  describe("categorizeError", () => {
    describe("retryable errors", () => {
      const retryableCodes = [
        "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
        "INTERNAL_SERVER_ERROR",
        "RATE_LIMIT_EXCEEDED",
        "INSTITUTION_DOWN",
        "INSTITUTION_NOT_RESPONDING",
        "INSTITUTION_NO_CREDENTIALS",
        "PLAID_ERROR",
      ];

      it.each(retryableCodes)(
        'should categorize "%s" as retryable',
        (code) => {
          const error = { error_code: code, error_message: "Test error" };
          const result = categorizeError(error);
          expect(result.category).toBe("retryable");
          expect(result.code).toBe(code);
        }
      );
    });

    describe("auth_required errors", () => {
      const authRequiredCodes = [
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
      ];

      it.each(authRequiredCodes)(
        'should categorize "%s" as auth_required',
        (code) => {
          const error = { error_code: code, error_message: "Auth needed" };
          const result = categorizeError(error);
          expect(result.category).toBe("auth_required");
          expect(result.code).toBe(code);
        }
      );
    });

    describe("permanent errors (default)", () => {
      it("should categorize unknown codes as permanent", () => {
        const error = {
          error_code: "UNKNOWN_ERROR_CODE",
          error_message: "Something weird",
        };
        const result = categorizeError(error);
        expect(result.category).toBe("permanent");
        expect(result.code).toBe("UNKNOWN_ERROR_CODE");
      });

      it("should categorize errors without error_code as permanent with UNKNOWN code", () => {
        const error = { message: "Generic error" };
        const result = categorizeError(error);
        expect(result.category).toBe("permanent");
        expect(result.code).toBe("UNKNOWN");
      });
    });

    describe("error format extraction", () => {
      it("should extract code from direct error_code property", () => {
        const error = { error_code: "RATE_LIMIT_EXCEEDED" };
        const result = categorizeError(error);
        expect(result.code).toBe("RATE_LIMIT_EXCEEDED");
      });

      it("should extract code from Axios-style response.data.error_code", () => {
        const error = {
          response: {
            data: {
              error_code: "ITEM_LOGIN_REQUIRED",
              error_message: "User must re-login",
            },
          },
        };
        const result = categorizeError(error);
        expect(result.code).toBe("ITEM_LOGIN_REQUIRED");
        expect(result.message).toBe("User must re-login");
      });

      it("should extract code from nested error.error_code", () => {
        const error = {
          error: {
            error_code: "INTERNAL_SERVER_ERROR",
          },
        };
        const result = categorizeError(error);
        expect(result.code).toBe("INTERNAL_SERVER_ERROR");
      });

      it("should return UNKNOWN for null error", () => {
        const result = categorizeError(null);
        expect(result.code).toBe("UNKNOWN");
        expect(result.message).toBe("Unknown error");
      });

      it("should return UNKNOWN for undefined error", () => {
        const result = categorizeError(undefined);
        expect(result.code).toBe("UNKNOWN");
        expect(result.message).toBe("Unknown error");
      });

      it("should return UNKNOWN for primitive error", () => {
        const result = categorizeError("string error");
        expect(result.code).toBe("UNKNOWN");
      });

      it("should return UNKNOWN for number error", () => {
        const result = categorizeError(500);
        expect(result.code).toBe("UNKNOWN");
      });
    });

    describe("message extraction", () => {
      it("should extract message from Error instance", () => {
        const error = new Error("Standard error message");
        const result = categorizeError(error);
        expect(result.message).toBe("Standard error message");
      });

      it("should extract message from error_message property", () => {
        const error = { error_message: "Plaid error message" };
        const result = categorizeError(error);
        expect(result.message).toBe("Plaid error message");
      });

      it("should extract message from Axios response.data.error_message", () => {
        const error = {
          response: {
            data: {
              error_message: "Axios wrapped error",
            },
          },
        };
        const result = categorizeError(error);
        expect(result.message).toBe("Axios wrapped error");
      });

      it("should extract message from plain message property", () => {
        const error = { message: "Plain message" };
        const result = categorizeError(error);
        expect(result.message).toBe("Plain message");
      });

      it('should return "Unknown error" for empty object', () => {
        const result = categorizeError({});
        expect(result.message).toBe("Unknown error");
      });
    });

    it("should preserve original error", () => {
      const originalError = new Error("Original");
      const result = categorizeError(originalError);
      expect(result.originalError).toBe(originalError);
    });
  });

  describe("isRetryable", () => {
    it("should return true for retryable errors", () => {
      const error: PlaidSyncError = {
        category: "retryable",
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests",
      };
      expect(isRetryable(error)).toBe(true);
    });

    it("should return false for auth_required errors", () => {
      const error: PlaidSyncError = {
        category: "auth_required",
        code: "ITEM_LOGIN_REQUIRED",
        message: "Login required",
      };
      expect(isRetryable(error)).toBe(false);
    });

    it("should return false for permanent errors", () => {
      const error: PlaidSyncError = {
        category: "permanent",
        code: "UNKNOWN",
        message: "Fatal error",
      };
      expect(isRetryable(error)).toBe(false);
    });
  });

  describe("requiresReauth", () => {
    it("should return true for auth_required errors", () => {
      const error: PlaidSyncError = {
        category: "auth_required",
        code: "ITEM_LOGIN_REQUIRED",
        message: "Login required",
      };
      expect(requiresReauth(error)).toBe(true);
    });

    it("should return false for retryable errors", () => {
      const error: PlaidSyncError = {
        category: "retryable",
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests",
      };
      expect(requiresReauth(error)).toBe(false);
    });

    it("should return false for permanent errors", () => {
      const error: PlaidSyncError = {
        category: "permanent",
        code: "UNKNOWN",
        message: "Fatal error",
      };
      expect(requiresReauth(error)).toBe(false);
    });
  });

  describe("isPermanent", () => {
    it("should return true for permanent errors", () => {
      const error: PlaidSyncError = {
        category: "permanent",
        code: "PRODUCT_NOT_READY",
        message: "Product not available",
      };
      expect(isPermanent(error)).toBe(true);
    });

    it("should return false for retryable errors", () => {
      const error: PlaidSyncError = {
        category: "retryable",
        code: "INSTITUTION_DOWN",
        message: "Bank is down",
      };
      expect(isPermanent(error)).toBe(false);
    });

    it("should return false for auth_required errors", () => {
      const error: PlaidSyncError = {
        category: "auth_required",
        code: "INVALID_ACCESS_TOKEN",
        message: "Token expired",
      };
      expect(isPermanent(error)).toBe(false);
    });
  });

  describe("formatErrorForLog", () => {
    it("should format retryable error correctly", () => {
      const error: PlaidSyncError = {
        category: "retryable",
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests",
      };
      const formatted = formatErrorForLog(error);
      expect(formatted).toBe("[RETRYABLE] RATE_LIMIT_EXCEEDED: Too many requests");
    });

    it("should format auth_required error correctly", () => {
      const error: PlaidSyncError = {
        category: "auth_required",
        code: "ITEM_LOGIN_REQUIRED",
        message: "User must log in",
      };
      const formatted = formatErrorForLog(error);
      expect(formatted).toBe("[AUTH_REQUIRED] ITEM_LOGIN_REQUIRED: User must log in");
    });

    it("should format permanent error correctly", () => {
      const error: PlaidSyncError = {
        category: "permanent",
        code: "UNKNOWN",
        message: "Something went wrong",
      };
      const formatted = formatErrorForLog(error);
      expect(formatted).toBe("[PERMANENT] UNKNOWN: Something went wrong");
    });

    it("should handle raw Error objects", () => {
      const error = new Error("Something went wrong");
      const formatted = formatErrorForLog(error);
      expect(formatted).toBe("[PERMANENT] UNKNOWN: Something went wrong");
    });

    it("should handle Plaid SDK errors directly", () => {
      const plaidError = {
        error_code: "ITEM_LOGIN_REQUIRED",
        error_message: "User must re-authenticate",
      };
      const formatted = formatErrorForLog(plaidError);
      expect(formatted).toBe("[AUTH_REQUIRED] ITEM_LOGIN_REQUIRED: User must re-authenticate");
    });

    it("should handle null/undefined gracefully", () => {
      expect(formatErrorForLog(null)).toBe("[PERMANENT] UNKNOWN: null");
      expect(formatErrorForLog(undefined)).toBe("[PERMANENT] UNKNOWN: undefined");
    });

    it("should handle string errors", () => {
      const formatted = formatErrorForLog("some error string");
      expect(formatted).toBe("[PERMANENT] UNKNOWN: some error string");
    });
  });

  describe("real-world error scenarios", () => {
    it("should handle Plaid SDK error format", () => {
      // Simulating actual Plaid SDK error structure
      const plaidError = {
        error_type: "ITEM_ERROR",
        error_code: "ITEM_LOGIN_REQUIRED",
        error_message: "the login details of this item have changed",
        display_message: "Please update your credentials",
        request_id: "abc123",
      };

      const result = categorizeError(plaidError);
      expect(result.category).toBe("auth_required");
      expect(result.code).toBe("ITEM_LOGIN_REQUIRED");
      expect(result.message).toBe("the login details of this item have changed");
    });

    it("should handle rate limiting error", () => {
      const rateLimitError = {
        error_type: "RATE_LIMIT_ERROR",
        error_code: "RATE_LIMIT_EXCEEDED",
        error_message: "request limit exceeded",
      };

      const result = categorizeError(rateLimitError);
      expect(result.category).toBe("retryable");
      expect(isRetryable(result)).toBe(true);
      expect(requiresReauth(result)).toBe(false);
    });

    it("should handle institution down error", () => {
      const institutionError = {
        error_type: "INSTITUTION_ERROR",
        error_code: "INSTITUTION_DOWN",
        error_message: "Chase is currently unavailable",
      };

      const result = categorizeError(institutionError);
      expect(result.category).toBe("retryable");
      expect(isRetryable(result)).toBe(true);
    });

    it("should handle network error (axios wrapped)", () => {
      const axiosError = {
        message: "Network Error",
        name: "AxiosError",
        code: "ERR_NETWORK",
        response: undefined,
      };

      const result = categorizeError(axiosError);
      expect(result.category).toBe("permanent"); // No error_code means permanent
      expect(result.code).toBe("UNKNOWN");
      expect(result.message).toBe("Network Error");
    });

    it("should handle sync mutation error during pagination", () => {
      const syncError = {
        error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
        error_message: "Cursor was invalidated during sync",
      };

      const result = categorizeError(syncError);
      expect(result.category).toBe("retryable");
      expect(isRetryable(result)).toBe(true);
    });
  });

  describe("category helper consistency", () => {
    it("all categories should be mutually exclusive", () => {
      const categories: PlaidSyncError["category"][] = [
        "retryable",
        "auth_required",
        "permanent",
      ];

      for (const category of categories) {
        const error: PlaidSyncError = {
          category,
          code: "TEST",
          message: "test",
        };

        const checks = [isRetryable(error), requiresReauth(error), isPermanent(error)];
        const trueCount = checks.filter(Boolean).length;

        expect(trueCount).toBe(1); // Exactly one should be true
      }
    });
  });
});
