# Security Hardening: Auth-Scoped Public APIs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden component security by adding auth-scoped public APIs that prevent userId-param foot-guns and enforce viewer-scoped access by default.

**Architecture:** Create parallel set of auth-scoped public queries (getMyItems, getMyAccounts, etc.) that derive userId from ctx.auth instead of accepting it as a parameter. Move existing userId-param queries to internal namespace for legitimate server-side/cron use cases. Provide migration guide for existing users.

**Tech Stack:** Convex (server functions), TypeScript, Vitest (testing)

**Version Strategy:** Major version bump (0.5.x → 1.0.0) due to breaking changes in public API surface.

---

## Pre-Implementation: Context Research

### Task 1: Verify ctx.auth Support in Components

**Goal:** Confirm whether Convex components can access ctx.auth in 2026

**Files:**
- Research: Convex docs, changelog, or test codebase

**Step 1: Check Convex documentation**

Search for "components ctx.auth" in:
- https://docs.convex.dev/components
- https://docs.convex.dev/auth
- Recent changelog entries

**Step 2: Test ctx.auth access in component query**

Create test file: `src/component/test-auth.ts`

```typescript
import { query } from "./_generated/server.js";

export const testAuth = query({
  args: {},
  handler: async (ctx) => {
    // Test if ctx.auth is available
    const identity = await ctx.auth.getUserIdentity();
    return {
      hasAuth: ctx.auth !== undefined,
      userId: identity?.subject ?? null,
    };
  },
});
```

**Step 3: Run test query from host app**

Expected outcomes:
- **If ctx.auth works:** Proceed with auth-scoped implementation
- **If ctx.auth fails:** Document limitation, provide host-app wrapper pattern

**Step 4: Document findings**

Create: `docs/auth-support-findings.md`

Document whether components support ctx.auth and any limitations discovered.

**Step 5: Commit research**

```bash
git add src/component/test-auth.ts docs/auth-support-findings.md
git commit -m "research: verify ctx.auth support in components"
```

---

## Phase 1: Create Auth-Scoped Public APIs

### Task 2: Add Auth-Scoped Item Queries

**Files:**
- Create: `src/component/public-auth.ts`
- Modify: `src/component/_generated/api.ts` (via Convex codegen)

**Step 1: Write failing test**

Create: `src/component/public-auth.test.ts`

```typescript
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

describe("auth-scoped queries", () => {
  test("getMyItems returns only current user's items", async () => {
    const t = convexTest(schema);

    // Setup: Create items for two users
    await t.run(async (ctx) => {
      await ctx.db.insert("plaidItems", {
        userId: "user1",
        itemId: "item_1",
        accessToken: "encrypted_token_1",
        products: ["transactions"],
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.insert("plaidItems", {
        userId: "user2",
        itemId: "item_2",
        accessToken: "encrypted_token_2",
        products: ["transactions"],
        status: "active",
        createdAt: Date.now(),
      });
    });

    // Test: getMyItems should only return user1's items
    const items = await t.query(api.publicAuth.getMyItems, {}, {
      auth: { subject: "user1" }
    });

    expect(items).toHaveLength(1);
    expect(items[0].userId).toBe("user1");
    expect(items[0].itemId).toBe("item_1");
  });

  test("getMyItems returns empty array when no auth", async () => {
    const t = convexTest(schema);

    const items = await t.query(api.publicAuth.getMyItems, {});

    expect(items).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- public-auth.test.ts`
Expected: FAIL - "api.publicAuth.getMyItems is not a function"

**Step 3: Implement getMyItems query**

Create: `src/component/public-auth.ts`

```typescript
/**
 * Auth-Scoped Public API
 *
 * Queries that derive userId from ctx.auth instead of accepting it as parameter.
 * These are the RECOMMENDED queries for client-side use - they prevent
 * accidental data leaks by enforcing viewer-scoped access.
 *
 * For server-side/cron use cases that need userId params, use internal queries.
 */

import { v } from "convex/values";
import { query } from "./_generated/server.js";

// Re-export validators from public.ts for DRY
import { plaidItemReturnValidator } from "./public.js";

/**
 * Get all plaidItems for the current authenticated user.
 * Derives userId from ctx.auth - cannot be called with arbitrary userId.
 *
 * @returns Array of plaidItems for current user (empty if unauthenticated)
 */
export const getMyItems = query({
  args: {},
  returns: v.array(plaidItemReturnValidator),
  handler: async (ctx) => {
    // Get authenticated user identity
    const identity = await ctx.auth.getUserIdentity();

    // Return empty array if not authenticated
    if (!identity) {
      return [];
    }

    const userId = identity.subject;

    // Query items for this user
    const items = await ctx.db
      .query("plaidItems")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Map to return type (exclude accessToken)
    return items.map((item) => ({
      _id: String(item._id),
      userId: item.userId,
      itemId: item.itemId,
      institutionId: item.institutionId,
      institutionName: item.institutionName,
      products: item.products,
      isActive: item.isActive,
      status: item.status,
      syncError: item.syncError,
      createdAt: item.createdAt,
      lastSyncedAt: item.lastSyncedAt,
      activatedAt: item.activatedAt,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
      errorAt: item.errorAt,
      reauthReason: item.reauthReason,
      reauthAt: item.reauthAt,
      disconnectedReason: item.disconnectedReason,
      disconnectedAt: item.disconnectedAt,
      circuitState: item.circuitState,
      consecutiveFailures: item.consecutiveFailures,
      lastFailureAt: item.lastFailureAt,
      nextRetryAt: item.nextRetryAt,
    }));
  },
});
```

**Step 4: Run test to verify it passes**

Run: `npm test -- public-auth.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/component/public-auth.ts src/component/public-auth.test.ts
git commit -m "feat: add auth-scoped getMyItems query"
```

---

### Task 3: Add Auth-Scoped Account Queries

**Files:**
- Modify: `src/component/public-auth.ts`
- Modify: `src/component/public-auth.test.ts`

**Step 1: Write failing test**

Add to `src/component/public-auth.test.ts`:

```typescript
test("getMyAccounts returns only current user's accounts", async () => {
  const t = convexTest(schema);

  // Setup: Create accounts for two users
  await t.run(async (ctx) => {
    await ctx.db.insert("plaidAccounts", {
      userId: "user1",
      plaidItemId: "item1",
      accountId: "acc_1",
      name: "User 1 Checking",
      type: "depository",
      subtype: "checking",
      balances: {
        available: 100000, // $100 in milliunits
        current: 100000,
        isoCurrencyCode: "USD",
      },
      createdAt: Date.now(),
    });
    await ctx.db.insert("plaidAccounts", {
      userId: "user2",
      plaidItemId: "item2",
      accountId: "acc_2",
      name: "User 2 Savings",
      type: "depository",
      subtype: "savings",
      balances: {
        available: 500000,
        current: 500000,
        isoCurrencyCode: "USD",
      },
      createdAt: Date.now(),
    });
  });

  const accounts = await t.query(api.publicAuth.getMyAccounts, {}, {
    auth: { subject: "user1" }
  });

  expect(accounts).toHaveLength(1);
  expect(accounts[0].userId).toBe("user1");
  expect(accounts[0].name).toBe("User 1 Checking");
});
```

**Step 2: Run test to verify failure**

Run: `npm test -- public-auth.test.ts`
Expected: FAIL

**Step 3: Implement getMyAccounts**

Add to `src/component/public-auth.ts`:

```typescript
import { balancesValidator } from "./public.js";

/**
 * Get all accounts for the current authenticated user.
 * Derives userId from ctx.auth.
 */
export const getMyAccounts = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.string(),
      userId: v.string(),
      plaidItemId: v.string(),
      accountId: v.string(),
      name: v.string(),
      officialName: v.optional(v.string()),
      mask: v.optional(v.string()),
      type: v.string(),
      subtype: v.optional(v.string()),
      balances: balancesValidator,
      createdAt: v.number(),
    })
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const userId = identity.subject;

    const accounts = await ctx.db
      .query("plaidAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return accounts.map((acc) => ({
      _id: String(acc._id),
      userId: acc.userId,
      plaidItemId: acc.plaidItemId,
      accountId: acc.accountId,
      name: acc.name,
      officialName: acc.officialName,
      mask: acc.mask,
      type: acc.type,
      subtype: acc.subtype,
      balances: acc.balances,
      createdAt: acc.createdAt,
    }));
  },
});
```

**Step 4: Run test to verify pass**

Run: `npm test -- public-auth.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/component/public-auth.ts src/component/public-auth.test.ts
git commit -m "feat: add auth-scoped getMyAccounts query"
```

---

### Task 4: Add Remaining Auth-Scoped Queries

**Files:**
- Modify: `src/component/public-auth.ts`
- Modify: `src/component/public-auth.test.ts`

**Step 1: Implement auth-scoped transaction queries**

Add to `src/component/public-auth.ts`:

```typescript
/**
 * Get transactions for current user with optional date filtering.
 */
export const getMyTransactions = query({
  args: {
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(/* transaction return validator */),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const userId = identity.subject;

    // Reuse logic from getTransactionsByUser in public.ts
    let transactions = await ctx.db
      .query("plaidTransactions")
      .withIndex("by_date", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    // Apply date filters
    if (args.startDate) {
      transactions = transactions.filter((t) => t.date >= args.startDate!);
    }
    if (args.endDate) {
      transactions = transactions.filter((t) => t.date <= args.endDate!);
    }
    if (args.limit) {
      transactions = transactions.slice(0, args.limit);
    }

    return transactions.map((txn) => ({
      _id: String(txn._id),
      userId: txn.userId,
      plaidItemId: txn.plaidItemId,
      accountId: txn.accountId,
      transactionId: txn.transactionId,
      amount: txn.amount,
      isoCurrencyCode: txn.isoCurrencyCode,
      date: txn.date,
      datetime: txn.datetime,
      name: txn.name,
      merchantName: txn.merchantName,
      pending: txn.pending,
      categoryPrimary: txn.categoryPrimary,
      categoryDetailed: txn.categoryDetailed,
      enrichmentData: txn.enrichmentData,
      merchantId: txn.merchantId,
      createdAt: txn.createdAt,
    }));
  },
});
```

**Step 2: Implement remaining auth-scoped queries**

Follow same pattern for:
- `getMyLiabilities`
- `getMyRecurringStreams`
- `getMySubscriptions` (filters for outflows)
- `getMyRecurringIncome` (filters for inflows)
- `getMySubscriptionsSummary`
- `getMySyncLogs`
- `getMySyncStats`

**Step 3: Write comprehensive tests**

Add tests for each query to `src/component/public-auth.test.ts`

**Step 4: Run all tests**

Run: `npm test -- public-auth.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/component/public-auth.ts src/component/public-auth.test.ts
git commit -m "feat: add all auth-scoped public queries"
```

---

## Phase 2: Move UserId-Param Queries to Internal

### Task 5: Create Internal Query Namespace

**Files:**
- Modify: `src/component/private.ts` (rename to `internal.ts`)
- Create: `src/component/internal-queries.ts`

**Step 1: Understand current private.ts structure**

Read: `src/component/private.ts`

Document what's currently in private namespace vs what should be internal.

**Step 2: Move userId-param queries to internal**

Create: `src/component/internal-queries.ts`

```typescript
/**
 * Internal Queries - Server-Side Only
 *
 * These queries accept userId as a parameter and are intended for:
 * - Scheduled cron jobs (syncing all users)
 * - Webhook handlers (syncing specific user)
 * - Server-side actions (where userId is already validated)
 *
 * SECURITY: These should NEVER be called directly from client code.
 * Use auth-scoped queries (public-auth.ts) for client-side access.
 */

import { v } from "convex/values";
import { internalQuery } from "./_generated/server.js";
import { plaidItemReturnValidator } from "./public.js";

/**
 * INTERNAL: Get items by userId.
 * For cron/webhook use only - do NOT expose to client.
 */
export const getItemsByUserInternal = internalQuery({
  args: { userId: v.string() },
  returns: v.array(plaidItemReturnValidator),
  handler: async (ctx, args) => {
    // Same implementation as current getItemsByUser
    const items = await ctx.db
      .query("plaidItems")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return items.map((item) => ({
      _id: String(item._id),
      userId: item.userId,
      itemId: item.itemId,
      // ... rest of fields
    }));
  },
});

// Repeat for all userId-param queries
```

**Step 3: Update existing internal mutations**

Ensure `src/component/private.ts` uses `internalMutation` and `internalQuery` correctly.

**Step 4: Test internal queries**

Create: `src/component/internal-queries.test.ts`

Test that internal queries:
- Work correctly when called from server context
- Cannot be called from client

**Step 5: Commit**

```bash
git add src/component/internal-queries.ts src/component/internal-queries.test.ts
git commit -m "feat: move userId-param queries to internal namespace"
```

---

### Task 6: Deprecate Old Public Queries

**Files:**
- Modify: `src/component/public.ts`

**Step 1: Add deprecation warnings**

Add JSDoc warnings to old queries:

```typescript
/**
 * @deprecated Use getMyItems from public-auth.ts instead for client-side access.
 * This query will be moved to internal namespace in v1.0.0.
 *
 * For cron/webhook use, use internal.getItemsByUserInternal instead.
 */
export const getItemsByUser = query({
  // ... existing implementation
});
```

**Step 2: Log deprecation warnings**

Add runtime warnings:

```typescript
export const getItemsByUser = query({
  args: { userId: v.string() },
  returns: v.array(plaidItemReturnValidator),
  handler: async (ctx, args) => {
    console.warn(
      "[DEPRECATED] getItemsByUser is deprecated. " +
      "Use getMyItems (client) or internal.getItemsByUserInternal (server)."
    );

    // ... existing implementation
  },
});
```

**Step 3: Commit deprecation warnings**

```bash
git add src/component/public.ts
git commit -m "deprecate: mark userId-param public queries as deprecated"
```

---

## Phase 3: Update Client API

### Task 7: Add Auth-Scoped Client Wrapper Methods

**Files:**
- Modify: `src/client/index.ts`
- Modify: `src/client/types.ts`

**Step 1: Add new client methods**

Update `Plaid` class in `src/client/index.ts`:

```typescript
export class Plaid {
  // ... existing code

  /**
   * Auth-Scoped API - Recommended for client-side use
   *
   * These queries automatically use the authenticated user's ID
   * and cannot be called with arbitrary userId parameters.
   */
  public readonly auth = {
    /**
     * Get all plaidItems for the current authenticated user.
     */
    getMyItems: (ctx: QueryCtx) => {
      return ctx.runQuery(this.component.publicAuth.getMyItems, {});
    },

    /**
     * Get all accounts for the current authenticated user.
     */
    getMyAccounts: (ctx: QueryCtx) => {
      return ctx.runQuery(this.component.publicAuth.getMyAccounts, {});
    },

    /**
     * Get transactions for the current authenticated user.
     */
    getMyTransactions: (
      ctx: QueryCtx,
      args: { startDate?: string; endDate?: string; limit?: number }
    ) => {
      return ctx.runQuery(this.component.publicAuth.getMyTransactions, args);
    },

    // ... add all auth-scoped methods
  };

  /**
   * Internal API - For server-side use only (cron, webhooks, actions)
   *
   * @deprecated Direct access to userId-param queries will be removed in v1.0.0
   * Use auth-scoped API for client queries or internal queries for server use.
   */
  public readonly internal = {
    getItemsByUser: (ctx: QueryCtx, args: { userId: string }) => {
      console.warn("[DEPRECATED] Use auth.getMyItems or internal queries");
      return ctx.runQuery(this.component.public.getItemsByUser, args);
    },
    // ... other internal methods
  };
}
```

**Step 2: Update TypeScript types**

Update `src/client/types.ts`:

```typescript
export interface PlaidAuthAPI {
  getMyItems: () => Promise<PlaidItem[]>;
  getMyAccounts: () => Promise<PlaidAccount[]>;
  getMyTransactions: (args?: {
    startDate?: string;
    endDate?: string;
    limit?: number;
  }) => Promise<PlaidTransaction[]>;
  // ... rest
}
```

**Step 3: Commit client API updates**

```bash
git add src/client/index.ts src/client/types.ts
git commit -m "feat: add auth-scoped client API wrapper"
```

---

## Phase 4: Documentation

### Task 8: Update README

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add security best practices section**

Add new section after "## Overview":

```markdown
## Security Best Practices

**⚠️ IMPORTANT: Use Auth-Scoped APIs for Client Queries**

The component provides two API surfaces:

1. **Auth-Scoped Public APIs** (RECOMMENDED for client-side)
   - `getMyItems`, `getMyAccounts`, `getMyTransactions`, etc.
   - Automatically use the authenticated user's ID from `ctx.auth`
   - Cannot be abused to query other users' data
   - Safe to call directly from React components

2. **Internal Queries** (for server-side use only)
   - `getItemsByUserInternal`, `getAccountsByUserInternal`, etc.
   - Accept `userId` as parameter
   - Intended for cron jobs, webhooks, and server actions
   - **Never call these directly from client code**

### Migration from v0.x

If you're upgrading from v0.5.x, update your query wrappers:

**Before (v0.5.x - INSECURE if called from client):**
```typescript
export const getItemsByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(plaid.api.getItemsByUser, args);
  },
});
```

**After (v1.0.0 - SECURE):**
```typescript
// Client-safe query - derives userId from ctx.auth
export const getMyItems = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(components.plaid.publicAuth.getMyItems, {});
  },
});

// Server-only query - for cron/webhooks
export const getItemsByUserServer = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(
      components.plaid.internal.getItemsByUserInternal,
      args
    );
  },
});
```
```

**Step 2: Update integration examples**

Update all code examples to use auth-scoped APIs:

```markdown
## Integration

### Create Wrapper Queries (v1.0.0+)

```typescript
// convex/plaid.ts
import { query } from "./_generated/server";
import { components } from "./_generated/api";

// === AUTH-SCOPED QUERIES (CLIENT-SAFE) ===

export const getMyItems = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(components.plaid.publicAuth.getMyItems, {});
  },
});

export const getMyAccounts = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(components.plaid.publicAuth.getMyAccounts, {});
  },
});

// ... more auth-scoped queries
```

**Step 3: Add migration guide section**

Create: `docs/migration-v1.md`

```markdown
# Migration Guide: v0.5.x → v1.0.0

## Breaking Changes

### Public API Surface Change

**What changed:**
- Old userId-param queries (`getItemsByUser`, etc.) moved to internal namespace
- New auth-scoped queries (`getMyItems`, etc.) are now recommended for client use

**Why:**
- Prevent accidental data leaks when calling queries from client code
- Enforce viewer-scoped access by default
- Maintain backwards compatibility for legitimate server-side use cases

### Migration Steps

1. **Update client-side query wrappers** to use auth-scoped APIs
2. **Update server-side queries** to use internal namespace
3. **Test authentication** to ensure userId derivation works correctly
4. **Remove deprecated wrapper queries** after verifying migration

### Detailed Examples

See examples in README.md "Security Best Practices" section.
```

**Step 4: Commit documentation updates**

```bash
git add CLAUDE.md docs/migration-v1.md
git commit -m "docs: add security best practices and migration guide"
```

---

## Phase 5: Testing & Validation

### Task 9: Integration Tests

**Files:**
- Create: `src/component/integration.test.ts`

**Step 1: Test auth-scoped access control**

```typescript
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

describe("auth-scoped access control", () => {
  test("user cannot access other user's items via getMyItems", async () => {
    const t = convexTest(schema);

    // Setup: Create items for two users
    await t.run(async (ctx) => {
      await ctx.db.insert("plaidItems", {
        userId: "user1",
        itemId: "item_1",
        accessToken: "token1",
        products: [],
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.insert("plaidItems", {
        userId: "user2",
        itemId: "item_2",
        accessToken: "token2",
        products: [],
        status: "active",
        createdAt: Date.now(),
      });
    });

    // Test: user1 can only see their items
    const user1Items = await t.query(
      api.publicAuth.getMyItems,
      {},
      { auth: { subject: "user1" } }
    );
    expect(user1Items).toHaveLength(1);
    expect(user1Items[0].itemId).toBe("item_1");

    // Test: user2 can only see their items
    const user2Items = await t.query(
      api.publicAuth.getMyItems,
      {},
      { auth: { subject: "user2" } }
    );
    expect(user2Items).toHaveLength(1);
    expect(user2Items[0].itemId).toBe("item_2");
  });

  test("unauthenticated user gets empty results", async () => {
    const t = convexTest(schema);

    // Setup: Create item for user1
    await t.run(async (ctx) => {
      await ctx.db.insert("plaidItems", {
        userId: "user1",
        itemId: "item_1",
        accessToken: "token1",
        products: [],
        status: "active",
        createdAt: Date.now(),
      });
    });

    // Test: no auth returns empty
    const items = await t.query(api.publicAuth.getMyItems, {});
    expect(items).toHaveLength(0);
  });
});
```

**Step 2: Test internal queries work for server use**

```typescript
test("internal queries work with userId param for cron use", async () => {
  const t = convexTest(schema);

  // Setup
  await t.run(async (ctx) => {
    await ctx.db.insert("plaidItems", {
      userId: "user1",
      itemId: "item_1",
      accessToken: "token1",
      products: [],
      status: "active",
      createdAt: Date.now(),
    });
  });

  // Test: Internal query works with userId param
  const items = await t.query(api.internal.getItemsByUserInternal, {
    userId: "user1",
  });
  expect(items).toHaveLength(1);
});
```

**Step 3: Run all integration tests**

Run: `npm test -- integration.test.ts`
Expected: All PASS

**Step 4: Commit integration tests**

```bash
git add src/component/integration.test.ts
git commit -m "test: add integration tests for auth-scoped access control"
```

---

### Task 10: Manual Testing Checklist

**Step 1: Test in example app**

Create test checklist: `docs/testing-checklist.md`

```markdown
# Security Hardening Testing Checklist

## Auth-Scoped Queries (Client)

- [ ] Create example React component using `useQuery` with `getMyItems`
- [ ] Verify it only returns current user's items
- [ ] Test with multiple users in Convex dashboard
- [ ] Verify unauthenticated state returns empty array
- [ ] Test all auth-scoped queries (accounts, transactions, liabilities, etc.)

## Internal Queries (Server)

- [ ] Create cron job that calls `getItemsByUserInternal`
- [ ] Verify it can access any user's data with userId param
- [ ] Test webhook handler using internal queries
- [ ] Verify internal queries cannot be called from client

## Migration Path

- [ ] Upgrade existing app from v0.5.x to v1.0.0
- [ ] Update all query wrappers to use auth-scoped APIs
- [ ] Verify no TypeScript errors
- [ ] Verify all existing functionality still works
- [ ] Remove old userId-param wrappers
- [ ] Deploy and test in production

## Edge Cases

- [ ] Test with Clerk auth provider
- [ ] Test with custom auth provider
- [ ] Test with no auth configured
- [ ] Test rate limiting still works
- [ ] Test circuit breaker still works
- [ ] Test webhook JWT verification still works
```

**Step 2: Execute checklist**

Work through each item, documenting results.

**Step 3: Fix any issues found**

Create bug fix commits as needed.

**Step 4: Commit completed checklist**

```bash
git add docs/testing-checklist.md
git commit -m "test: complete manual testing checklist"
```

---

## Phase 6: Version Bump & Release

### Task 11: Prepare v1.0.0 Release

**Files:**
- Modify: `package.json`
- Create: `CHANGELOG.md`
- Modify: `CLAUDE.md` (update version references)

**Step 1: Update version in package.json**

```json
{
  "version": "1.0.0"
}
```

**Step 2: Create CHANGELOG.md**

```markdown
# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-01-15

### 🔒 Security (Breaking Changes)

#### Auth-Scoped Public APIs

**Added:**
- New auth-scoped public queries that derive userId from `ctx.auth`:
  - `publicAuth.getMyItems` - replaces client usage of `getItemsByUser`
  - `publicAuth.getMyAccounts` - replaces client usage of `getAccountsByUser`
  - `publicAuth.getMyTransactions` - replaces client usage of `getTransactionsByUser`
  - `publicAuth.getMyLiabilities` - replaces client usage of `getLiabilitiesByUser`
  - `publicAuth.getMyRecurringStreams` - replaces client usage of `getRecurringStreamsByUser`
  - `publicAuth.getMySubscriptions` - replaces client usage of `getActiveSubscriptions`
  - `publicAuth.getMyRecurringIncome` - replaces client usage of `getRecurringIncome`
  - `publicAuth.getMySyncLogs` - replaces client usage of `getSyncLogsByUser`

**Moved to Internal:**
- UserId-param queries moved to internal namespace:
  - `internal.getItemsByUserInternal` (was `public.getItemsByUser`)
  - `internal.getAccountsByUserInternal` (was `public.getAccountsByUser`)
  - `internal.getTransactionsByUserInternal` (was `public.getTransactionsByUser`)
  - ... etc

**Why:**
- Prevent accidental data leaks when calling component queries from client code
- Enforce viewer-scoped access by default
- Provide safe-by-default APIs while maintaining server-side flexibility

**Migration:**
- Update client query wrappers to use `publicAuth.*` APIs
- Update server/cron queries to use `internal.*` APIs
- See [Migration Guide](./docs/migration-v1.md)

### Deprecated

- Old userId-param public queries are deprecated and will be removed in v2.0.0
- Runtime warnings added to help migration

## [0.5.3] - 2026-01-13

Previous releases...
```

**Step 3: Update README version badge**

Update any version badges or references to "latest version" in README.

**Step 4: Commit version bump**

```bash
git add package.json CHANGELOG.md CLAUDE.md
git commit -m "chore: bump version to 1.0.0"
```

**Step 5: Create git tag**

```bash
git tag -a v1.0.0 -m "v1.0.0: Security hardening with auth-scoped APIs"
```

**Step 6: Push with tags**

```bash
git push origin main --tags
```

---

## Phase 7: Backwards Compatibility (Optional)

### Task 12: Add Compatibility Layer

If you want to minimize breaking changes, add compatibility layer:

**Files:**
- Create: `src/component/public-compat.ts`

**Step 1: Create compatibility wrapper**

```typescript
/**
 * Backwards Compatibility Layer (v0.5.x → v1.0.0)
 *
 * These queries maintain the old userId-param signature but add
 * optional auth checking for safer defaults.
 *
 * @deprecated Use publicAuth.* for client or internal.* for server
 */

import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { plaidItemReturnValidator } from "./public.js";

export const getItemsByUser = query({
  args: {
    userId: v.string(),
    // Optional: require matching auth
    requireAuth: v.optional(v.boolean()),
  },
  returns: v.array(plaidItemReturnValidator),
  handler: async (ctx, args) => {
    // Log deprecation
    console.warn(
      "[DEPRECATED] getItemsByUser will be removed in v2.0.0. " +
      "Use publicAuth.getMyItems (client) or internal.getItemsByUserInternal (server)."
    );

    // Optional: enforce auth check
    if (args.requireAuth) {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity || identity.subject !== args.userId) {
        throw new Error("Unauthorized: userId does not match authenticated user");
      }
    }

    // Original logic
    const items = await ctx.db
      .query("plaidItems")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return items.map(/* ... */);
  },
});
```

**Step 2: Document compatibility mode**

Add to CLAUDE.md:

```markdown
## Backwards Compatibility Mode (v1.0.0)

For easier migration, v1.0.0 includes a compatibility layer.

**Option 1: Gradual migration (recommended)**
1. Keep old query wrappers working
2. Add `requireAuth: true` parameter for safety
3. Migrate to auth-scoped APIs over time

**Option 2: Immediate migration**
1. Update all wrappers to use auth-scoped APIs
2. Remove compatibility layer
3. Deploy with confidence
```

**Step 3: Commit compatibility layer**

```bash
git add src/component/public-compat.ts CLAUDE.md
git commit -m "feat: add backwards compatibility layer for v0.5.x migration"
```

---

## Summary

**Phases:**
1. ✅ Research ctx.auth support in components
2. ✅ Create auth-scoped public APIs (`getMyItems`, etc.)
3. ✅ Move userId-param queries to internal namespace
4. ✅ Update client API wrapper
5. ✅ Update documentation with security best practices
6. ✅ Write comprehensive tests
7. ✅ Version bump to 1.0.0
8. ✅ (Optional) Add backwards compatibility layer

**Key Files Modified:**
- `src/component/public-auth.ts` (NEW - auth-scoped queries)
- `src/component/internal-queries.ts` (NEW - internal queries)
- `src/component/public.ts` (deprecation warnings)
- `src/client/index.ts` (auth-scoped wrapper methods)
- `CLAUDE.md` (security best practices)
- `docs/migration-v1.md` (NEW - migration guide)
- Tests for all new functionality

**Testing Strategy:**
- Unit tests for each auth-scoped query
- Integration tests for access control
- Manual testing checklist
- Backwards compatibility tests

**Success Criteria:**
- ✅ Auth-scoped APIs work correctly with ctx.auth
- ✅ Unauthenticated users get empty results (no errors)
- ✅ Users cannot access other users' data
- ✅ Internal queries still work for cron/webhook use cases
- ✅ Deprecation warnings guide migration
- ✅ Documentation clearly explains secure usage
- ✅ All tests pass
- ✅ v1.0.0 published to npm
