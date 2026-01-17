/**
 * Security Helper Utilities Tests
 *
 * Tests for requireAuth() and requireOwnership() helper functions.
 * These are security-critical functions requiring 100% coverage.
 */

import { describe, it, expect, vi } from "vitest";
import {
  requireAuth,
  requireOwnership,
  requireItemOwnership,
  requireAccountOwnership,
} from "./helpers.js";
import type { AuthenticatedContext, PlaidItem, PlaidAccount } from "./types.js";

/**
 * Helper to create a mock AuthenticatedContext
 */
function createMockContext(
  getUserIdentityMock: () => Promise<{ subject: string } | null>
): AuthenticatedContext {
  return {
    auth: {
      getUserIdentity: vi.fn(getUserIdentityMock),
    },
    runQuery: vi.fn(),
    runMutation: vi.fn(),
  };
}

describe("Security Helper Utilities", () => {
  describe("requireAuth", () => {
    it("should return userId when authenticated with valid subject", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: "user-123",
      }));

      const userId = await requireAuth(mockCtx);
      expect(userId).toBe("user-123");
      expect(mockCtx.auth.getUserIdentity).toHaveBeenCalledOnce();
    });

    it("should return userId for different user IDs", async () => {
      const testCases = [
        "user-abc",
        "auth0|12345",
        "clerk|user_xyz",
        "custom-user-id-123",
      ];

      for (const expectedUserId of testCases) {
        const mockCtx = createMockContext(async () => ({
          subject: expectedUserId,
        }));

        const userId = await requireAuth(mockCtx);
        expect(userId).toBe(expectedUserId);
      }
    });

    it("should throw when not authenticated (identity is null)", async () => {
      const mockCtx = createMockContext(async () => null);

      await expect(requireAuth(mockCtx)).rejects.toThrow(
        "Authentication required"
      );
      expect(mockCtx.auth.getUserIdentity).toHaveBeenCalledOnce();
    });

    it("should throw when not authenticated (identity is undefined)", async () => {
      const mockCtx = createMockContext(async () => undefined as any);

      await expect(requireAuth(mockCtx)).rejects.toThrow(
        "Authentication required"
      );
    });

    it("should throw when identity.subject is undefined", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: undefined as any,
      }));

      await expect(requireAuth(mockCtx)).rejects.toThrow(
        "Authentication required"
      );
    });

    it("should throw when identity.subject is null", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: null as any,
      }));

      await expect(requireAuth(mockCtx)).rejects.toThrow(
        "Authentication required"
      );
    });

    it("should throw when identity.subject is empty string", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: "",
      }));

      await expect(requireAuth(mockCtx)).rejects.toThrow(
        "Authentication required"
      );
    });

    it("should throw when identity exists but subject is missing", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: undefined as any,
        email: "user@example.com",
        name: "Test User",
      }));

      await expect(requireAuth(mockCtx)).rejects.toThrow(
        "Authentication required"
      );
    });

    it("should handle getUserIdentity throwing an error", async () => {
      const mockCtx = {
        auth: {
          getUserIdentity: vi
            .fn()
            .mockRejectedValue(new Error("Auth service unavailable")),
        },
        runQuery: vi.fn(),
        runMutation: vi.fn(),
      };

      await expect(requireAuth(mockCtx)).rejects.toThrow(
        "Auth service unavailable"
      );
    });
  });

  describe("requireOwnership", () => {
    it("should succeed when userId matches resourceUserId", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: "user-123",
      }));

      await expect(
        requireOwnership(mockCtx, "user-123")
      ).resolves.toBeUndefined();
      expect(mockCtx.auth.getUserIdentity).toHaveBeenCalledOnce();
    });

    it("should succeed when userId matches for different IDs", async () => {
      const testCases = [
        "user-abc",
        "auth0|12345",
        "clerk|user_xyz",
        "custom-user-id-123",
      ];

      for (const userId of testCases) {
        const mockCtx = createMockContext(async () => ({
          subject: userId,
        }));

        await expect(requireOwnership(mockCtx, userId)).resolves.toBeUndefined();
      }
    });

    it("should throw when not authenticated (identity is null)", async () => {
      const mockCtx = createMockContext(async () => null);

      await expect(requireOwnership(mockCtx, "user-123")).rejects.toThrow(
        "Authentication required"
      );
      expect(mockCtx.auth.getUserIdentity).toHaveBeenCalledOnce();
    });

    it("should throw when not authenticated (identity is undefined)", async () => {
      const mockCtx = createMockContext(async () => undefined as any);

      await expect(requireOwnership(mockCtx, "user-123")).rejects.toThrow(
        "Authentication required"
      );
    });

    it("should throw when identity.subject is missing", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: undefined as any,
      }));

      await expect(requireOwnership(mockCtx, "user-123")).rejects.toThrow(
        "Authentication required"
      );
    });

    it("should throw when identity.subject is null", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: null as any,
      }));

      await expect(requireOwnership(mockCtx, "user-123")).rejects.toThrow(
        "Authentication required"
      );
    });

    it("should throw when identity.subject is empty string", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: "",
      }));

      await expect(requireOwnership(mockCtx, "user-123")).rejects.toThrow(
        "Authentication required"
      );
    });

    it("should throw with clear error when userId does not match resourceUserId", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: "user-123",
      }));

      await expect(requireOwnership(mockCtx, "user-456")).rejects.toThrow(
        "Unauthorized: You don't own this resource"
      );
      expect(mockCtx.auth.getUserIdentity).toHaveBeenCalledOnce();
    });

    it("should throw unauthorized error with descriptive message", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: "alice",
      }));

      await expect(requireOwnership(mockCtx, "bob")).rejects.toMatchObject({
        message: "Unauthorized: You don't own this resource",
      });
    });

    it("should reject attempts to access other users' resources", async () => {
      const scenarios = [
        { authenticatedUser: "user-1", resourceOwner: "user-2" },
        { authenticatedUser: "auth0|abc", resourceOwner: "auth0|xyz" },
        { authenticatedUser: "alice", resourceOwner: "bob" },
      ];

      for (const { authenticatedUser, resourceOwner } of scenarios) {
        const mockCtx = createMockContext(async () => ({
          subject: authenticatedUser,
        }));

        await expect(
          requireOwnership(mockCtx, resourceOwner)
        ).rejects.toThrow("Unauthorized: You don't own this resource");
      }
    });

    it("should handle getUserIdentity throwing an error", async () => {
      const mockCtx = {
        auth: {
          getUserIdentity: vi
            .fn()
            .mockRejectedValue(new Error("Auth service unavailable")),
        },
        runQuery: vi.fn(),
        runMutation: vi.fn(),
      };

      await expect(requireOwnership(mockCtx, "user-123")).rejects.toThrow(
        "Auth service unavailable"
      );
    });

    it("should check authentication before checking ownership", async () => {
      // Even if resourceUserId is empty, should fail with "Authentication required" first
      const mockCtx = createMockContext(async () => null);

      await expect(requireOwnership(mockCtx, "")).rejects.toThrow(
        "Authentication required"
      );
    });
  });

  describe("Error messages and types", () => {
    it("requireAuth should throw Error with exact message", async () => {
      const mockCtx = createMockContext(async () => null);

      try {
        await requireAuth(mockCtx);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("Authentication required");
      }
    });

    it("requireOwnership should throw Error with exact message for auth failure", async () => {
      const mockCtx = createMockContext(async () => null);

      try {
        await requireOwnership(mockCtx, "user-123");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("Authentication required");
      }
    });

    it("requireOwnership should throw Error with exact message for ownership failure", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: "user-123",
      }));

      try {
        await requireOwnership(mockCtx, "user-456");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(
          "Unauthorized: You don't own this resource"
        );
      }
    });
  });

  describe("Integration patterns", () => {
    it("should work in typical query wrapper pattern", async () => {
      // Simulate a typical host app query wrapper
      const mockCtx = createMockContext(async () => ({
        subject: "user-123",
      }));

      const userId = await requireAuth(mockCtx);
      expect(userId).toBe("user-123");

      // At this point, the wrapper would call ctx.runQuery(components.plaid.public.getItemsByUser, { userId })
      expect(mockCtx.auth.getUserIdentity).toHaveBeenCalledOnce();
    });

    it("should work in typical mutation wrapper pattern with ownership check", async () => {
      // Simulate a typical host app mutation wrapper
      const mockCtx = createMockContext(async () => ({
        subject: "user-123",
      }));

      // First, authenticate
      const userId = await requireAuth(mockCtx);
      expect(userId).toBe("user-123");

      // Then, verify ownership of a resource
      await expect(
        requireOwnership(mockCtx, userId)
      ).resolves.toBeUndefined();

      // At this point, the wrapper would perform the mutation
      expect(mockCtx.auth.getUserIdentity).toHaveBeenCalledTimes(2);
    });

    it("should prevent unauthorized access to other users' resources", async () => {
      // Attacker tries to access victim's resource
      const attackerCtx = createMockContext(async () => ({
        subject: "attacker-user",
      }));

      const attackerId = await requireAuth(attackerCtx);
      expect(attackerId).toBe("attacker-user");

      // Try to access victim's resource (should fail)
      await expect(
        requireOwnership(attackerCtx, "victim-user")
      ).rejects.toThrow("Unauthorized: You don't own this resource");
    });
  });

  describe("Edge cases", () => {
    it("should handle whitespace-only userId", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: "   ",
      }));

      // Whitespace is technically truthy, but may not be a valid userId
      // The current implementation would allow it (returns "   ")
      const userId = await requireAuth(mockCtx);
      expect(userId).toBe("   ");
    });

    it("should handle very long userId", async () => {
      const longUserId = "a".repeat(10000);
      const mockCtx = createMockContext(async () => ({
        subject: longUserId,
      }));

      const userId = await requireAuth(mockCtx);
      expect(userId).toBe(longUserId);
    });

    it("should handle userId with special characters", async () => {
      const specialUserId = "user|123!@#$%^&*()_+-=[]{}|;':\",./<>?`~";
      const mockCtx = createMockContext(async () => ({
        subject: specialUserId,
      }));

      const userId = await requireAuth(mockCtx);
      expect(userId).toBe(specialUserId);
    });

    it("should handle userId with unicode characters", async () => {
      const unicodeUserId = "user-日本語-🔐-émoji";
      const mockCtx = createMockContext(async () => ({
        subject: unicodeUserId,
      }));

      const userId = await requireAuth(mockCtx);
      expect(userId).toBe(unicodeUserId);
    });

    it("requireOwnership should handle case-sensitive comparison", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: "User-123",
      }));

      // Should fail because "User-123" !== "user-123" (case-sensitive)
      await expect(requireOwnership(mockCtx, "user-123")).rejects.toThrow(
        "Unauthorized: You don't own this resource"
      );
    });

    it("should handle identity with additional fields", async () => {
      const mockCtx = {
        auth: {
          getUserIdentity: vi.fn(async () => ({
            subject: "user-123",
            email: "user@example.com",
            name: "Test User",
            picture: "https://example.com/avatar.jpg",
            customField: "custom-value",
          })),
        },
        runQuery: vi.fn(),
        runMutation: vi.fn(),
      };

      const userId = await requireAuth(mockCtx);
      expect(userId).toBe("user-123");
    });
  });

  describe("Performance and behavior", () => {
    it("requireAuth should only call getUserIdentity once", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: "user-123",
      }));

      await requireAuth(mockCtx);
      expect(mockCtx.auth.getUserIdentity).toHaveBeenCalledOnce();
    });

    it("requireOwnership should only call getUserIdentity once", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: "user-123",
      }));

      await requireOwnership(mockCtx, "user-123");
      expect(mockCtx.auth.getUserIdentity).toHaveBeenCalledOnce();
    });

    it("should not mutate the context", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: "user-123",
      }));

      const originalCtx = { ...mockCtx };

      await requireAuth(mockCtx);

      // Context should not be modified (except for spy tracking)
      expect(mockCtx.runQuery).toBe(originalCtx.runQuery);
      expect(mockCtx.runMutation).toBe(originalCtx.runMutation);
    });

    it("should be async and return promises", async () => {
      const mockCtx = createMockContext(async () => ({
        subject: "user-123",
      }));

      const result1 = requireAuth(mockCtx);
      expect(result1).toBeInstanceOf(Promise);

      const result2 = requireOwnership(mockCtx, "user-123");
      expect(result2).toBeInstanceOf(Promise);

      await result1;
      await result2;
    });
  });
});

// =============================================================================
// requireItemOwnership Tests
// =============================================================================

describe("requireItemOwnership", () => {
  /**
   * Create mock PlaidItem data
   */
  function createMockPlaidItem(
    userId: string,
    plaidItemId = "item-123"
  ): PlaidItem {
    return {
      _id: plaidItemId,
      userId,
      itemId: "plaid-item-abc",
      institutionId: "ins_123",
      institutionName: "Test Bank",
      products: ["transactions"],
      status: "active",
      createdAt: Date.now(),
    };
  }

  /**
   * Create mock plaidApi with getItem method
   */
  function createMockPlaidApi(
    getItemResult: PlaidItem | null
  ): Pick<any, "getItem"> {
    return {
      getItem: vi.fn(),
    };
  }

  it("should return item when user owns it", async () => {
    const mockItem = createMockPlaidItem("user-123");
    const mockCtx = createMockContext(async () => ({
      subject: "user-123",
    }));
    mockCtx.runQuery = vi.fn().mockResolvedValue(mockItem);

    const mockApi = createMockPlaidApi(mockItem);

    const result = await requireItemOwnership(mockCtx, "item-123", mockApi);

    expect(result).toEqual(mockItem);
    expect(mockCtx.runQuery).toHaveBeenCalledWith(mockApi.getItem, {
      plaidItemId: "item-123",
    });
  });

  it("should throw when user is not authenticated", async () => {
    const mockItem = createMockPlaidItem("user-123");
    const mockCtx = createMockContext(async () => null);
    mockCtx.runQuery = vi.fn().mockResolvedValue(mockItem);

    const mockApi = createMockPlaidApi(mockItem);

    await expect(
      requireItemOwnership(mockCtx, "item-123", mockApi)
    ).rejects.toThrow("Authentication required");

    // runQuery should not be called if auth fails first
    expect(mockCtx.runQuery).not.toHaveBeenCalled();
  });

  it("should throw when item not found", async () => {
    const mockCtx = createMockContext(async () => ({
      subject: "user-123",
    }));
    mockCtx.runQuery = vi.fn().mockResolvedValue(null);

    const mockApi = createMockPlaidApi(null);

    await expect(
      requireItemOwnership(mockCtx, "nonexistent-item", mockApi)
    ).rejects.toThrow("Plaid item not found");
  });

  it("should throw when user doesn't own item", async () => {
    const mockItem = createMockPlaidItem("user-456"); // Different user owns it
    const mockCtx = createMockContext(async () => ({
      subject: "user-123", // Authenticated as user-123
    }));
    mockCtx.runQuery = vi.fn().mockResolvedValue(mockItem);

    const mockApi = createMockPlaidApi(mockItem);

    await expect(
      requireItemOwnership(mockCtx, "item-123", mockApi)
    ).rejects.toThrow("Unauthorized: You don't own this item");
  });

  it("should check authentication before checking item ownership", async () => {
    const mockCtx = createMockContext(async () => null);
    mockCtx.runQuery = vi.fn();

    const mockApi = createMockPlaidApi(null);

    await expect(
      requireItemOwnership(mockCtx, "item-123", mockApi)
    ).rejects.toThrow("Authentication required");

    // Should fail at auth check, never reaching the query
    expect(mockCtx.runQuery).not.toHaveBeenCalled();
  });

  it("should handle empty string plaidItemId", async () => {
    const mockCtx = createMockContext(async () => ({
      subject: "user-123",
    }));
    mockCtx.runQuery = vi.fn().mockResolvedValue(null);

    const mockApi = createMockPlaidApi(null);

    await expect(requireItemOwnership(mockCtx, "", mockApi)).rejects.toThrow(
      "Plaid item not found"
    );
  });

  it("should work with different user ID formats", async () => {
    const testCases = [
      "user-abc",
      "auth0|12345",
      "clerk|user_xyz",
      "custom-user-id-123",
    ];

    for (const userId of testCases) {
      const mockItem = createMockPlaidItem(userId);
      const mockCtx = createMockContext(async () => ({
        subject: userId,
      }));
      mockCtx.runQuery = vi.fn().mockResolvedValue(mockItem);

      const mockApi = createMockPlaidApi(mockItem);

      const result = await requireItemOwnership(mockCtx, "item-123", mockApi);
      expect(result.userId).toBe(userId);
    }
  });
});

// =============================================================================
// requireAccountOwnership Tests
// =============================================================================

describe("requireAccountOwnership", () => {
  /**
   * Create mock PlaidAccount data
   */
  function createMockPlaidAccount(
    userId: string,
    accountId = "account-123"
  ): PlaidAccount {
    return {
      _id: "doc-id-123",
      userId,
      plaidItemId: "item-123",
      accountId,
      name: "Test Checking",
      type: "depository",
      subtype: "checking",
      mask: "1234",
      balances: {
        available: 1000000, // MILLIUNITS
        current: 1000000,
        isoCurrencyCode: "USD",
      },
      createdAt: Date.now(),
    };
  }

  /**
   * Create mock plaidApi with getAccountsByUser method
   */
  function createMockPlaidApi(
    accounts: PlaidAccount[]
  ): Pick<any, "getAccountsByUser"> {
    return {
      getAccountsByUser: vi.fn(),
    };
  }

  it("should return account when user owns it", async () => {
    const mockAccount = createMockPlaidAccount("user-123", "account-abc");
    const mockCtx = createMockContext(async () => ({
      subject: "user-123",
    }));
    mockCtx.runQuery = vi.fn().mockResolvedValue([mockAccount]);

    const mockApi = createMockPlaidApi([mockAccount]);

    const result = await requireAccountOwnership(
      mockCtx,
      "account-abc",
      mockApi
    );

    expect(result).toEqual(mockAccount);
    expect(mockCtx.runQuery).toHaveBeenCalledWith(mockApi.getAccountsByUser, {
      userId: "user-123",
    });
  });

  it("should throw when user is not authenticated", async () => {
    const mockAccount = createMockPlaidAccount("user-123");
    const mockCtx = createMockContext(async () => null);
    mockCtx.runQuery = vi.fn().mockResolvedValue([mockAccount]);

    const mockApi = createMockPlaidApi([mockAccount]);

    await expect(
      requireAccountOwnership(mockCtx, "account-123", mockApi)
    ).rejects.toThrow("Authentication required");

    // runQuery should not be called if auth fails first
    expect(mockCtx.runQuery).not.toHaveBeenCalled();
  });

  it("should throw when account not found", async () => {
    const mockAccount = createMockPlaidAccount("user-123", "account-other");
    const mockCtx = createMockContext(async () => ({
      subject: "user-123",
    }));
    mockCtx.runQuery = vi.fn().mockResolvedValue([mockAccount]);

    const mockApi = createMockPlaidApi([mockAccount]);

    await expect(
      requireAccountOwnership(mockCtx, "account-nonexistent", mockApi)
    ).rejects.toThrow("Account not found or unauthorized");
  });

  it("should throw when user has no accounts", async () => {
    const mockCtx = createMockContext(async () => ({
      subject: "user-123",
    }));
    mockCtx.runQuery = vi.fn().mockResolvedValue([]);

    const mockApi = createMockPlaidApi([]);

    await expect(
      requireAccountOwnership(mockCtx, "account-123", mockApi)
    ).rejects.toThrow("Account not found or unauthorized");
  });

  it("should find correct account among multiple accounts", async () => {
    const accounts = [
      createMockPlaidAccount("user-123", "account-1"),
      createMockPlaidAccount("user-123", "account-2"),
      createMockPlaidAccount("user-123", "account-3"),
    ];
    const mockCtx = createMockContext(async () => ({
      subject: "user-123",
    }));
    mockCtx.runQuery = vi.fn().mockResolvedValue(accounts);

    const mockApi = createMockPlaidApi(accounts);

    const result = await requireAccountOwnership(mockCtx, "account-2", mockApi);

    expect(result.accountId).toBe("account-2");
  });

  it("should check authentication before fetching accounts", async () => {
    const mockCtx = createMockContext(async () => null);
    mockCtx.runQuery = vi.fn();

    const mockApi = createMockPlaidApi([]);

    await expect(
      requireAccountOwnership(mockCtx, "account-123", mockApi)
    ).rejects.toThrow("Authentication required");

    // Should fail at auth check, never reaching the query
    expect(mockCtx.runQuery).not.toHaveBeenCalled();
  });

  it("should handle empty string accountId", async () => {
    const mockAccount = createMockPlaidAccount("user-123", "account-real");
    const mockCtx = createMockContext(async () => ({
      subject: "user-123",
    }));
    mockCtx.runQuery = vi.fn().mockResolvedValue([mockAccount]);

    const mockApi = createMockPlaidApi([mockAccount]);

    await expect(requireAccountOwnership(mockCtx, "", mockApi)).rejects.toThrow(
      "Account not found or unauthorized"
    );
  });

  it("should work with different user ID formats", async () => {
    const testCases = [
      "user-abc",
      "auth0|12345",
      "clerk|user_xyz",
      "custom-user-id-123",
    ];

    for (const userId of testCases) {
      const mockAccount = createMockPlaidAccount(userId, "account-test");
      const mockCtx = createMockContext(async () => ({
        subject: userId,
      }));
      mockCtx.runQuery = vi.fn().mockResolvedValue([mockAccount]);

      const mockApi = createMockPlaidApi([mockAccount]);

      const result = await requireAccountOwnership(
        mockCtx,
        "account-test",
        mockApi
      );
      expect(result.userId).toBe(userId);
    }
  });

  it("should use exact accountId match (case-sensitive)", async () => {
    const mockAccount = createMockPlaidAccount("user-123", "Account-123");
    const mockCtx = createMockContext(async () => ({
      subject: "user-123",
    }));
    mockCtx.runQuery = vi.fn().mockResolvedValue([mockAccount]);

    const mockApi = createMockPlaidApi([mockAccount]);

    // Different case should not match
    await expect(
      requireAccountOwnership(mockCtx, "account-123", mockApi)
    ).rejects.toThrow("Account not found or unauthorized");
  });
});
