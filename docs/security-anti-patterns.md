# Security Anti-Patterns

> Common security mistakes when integrating the `@crowdevelopment/convex-plaid` component and how to avoid them.

## Overview

This document catalogs the **four most critical security mistakes** when integrating Convex components. Since Convex components **cannot access `ctx.auth`**, all authentication and authorization must be enforced in your host app's wrapper functions. Failing to do this correctly creates serious security vulnerabilities.

**Why this matters:** Financial data is highly sensitive. A single security mistake could expose users' bank accounts, transactions, and credit card information to unauthorized parties.

**Document Structure:**
- **Core Anti-Patterns (1-4):** The four most critical mistakes that must be avoided
- **Additional Security Concerns:** Other important security considerations

**Related Documentation:**
- [CLAUDE.md - Security Best Practices](../CLAUDE.md#security-best-practices)
- [example/convex/secureWrappers.ts](../example/convex/secureWrappers.ts) - Secure implementation patterns
- [docs/auth-support-findings.md](./auth-support-findings.md) - Why components can't access ctx.auth

---

## Core Anti-Patterns

These four patterns represent the most critical security vulnerabilities when integrating Convex components. Each one has been exploited in real-world applications and can lead to complete data breaches.

---

## Anti-Pattern 1: Trusting Client-Supplied User IDs

### The Problem

Accepting `userId` as a function argument allows clients to forge their identity and access other users' data.

### Why It's Dangerous

- **Complete data breach**: Attacker can enumerate userIds and access all users' financial data
- **No audit trail**: Component stores attacker-supplied userId in logs
- **Bypasses all authentication**: No verification that the requester is who they claim to be

### ❌ Insecure Example

```typescript
// convex/plaid.ts - VULNERABLE
import { query } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";

export const getItemsByUser = query({
  args: { userId: v.string() },  // ❌ Accepting userId from client
  handler: async (ctx, args) => {
    // No authentication check!
    return await ctx.runQuery(components.plaid.public.getItemsByUser, {
      userId: args.userId,  // ❌ Trusting client input
    });
  },
});
```

**Attack scenario:**
```typescript
// Client code - attacker can pass ANY userId
const victimData = await ctx.runQuery(api.plaid.getItemsByUser, {
  userId: "victim-user-id-12345"  // Access another user's data
});
```

### ✅ Secure Alternative

```typescript
import { query } from "./_generated/server";
import { components } from "./_generated/api";
import { requireAuth } from "@crowdevelopment/convex-plaid/helpers";

export const getMyItems = query({
  args: {},  // ✅ No userId parameter
  handler: async (ctx) => {
    // ✅ Extract userId from authenticated session
    const userId = await requireAuth(ctx);

    return await ctx.runQuery(components.plaid.public.getItemsByUser, {
      userId,  // ✅ Verified userId from auth
    });
  },
});
```

**Client code - secure:**
```typescript
// Can only access own data
const myData = await ctx.runQuery(api.plaid.getMyItems, {});
// No way to specify another user's ID
```

### Key Takeaway

⚠️ **NEVER accept `userId` as a function argument from the client. ALWAYS derive it from `ctx.auth.getUserIdentity()`.**

---

## Anti-Pattern 2: Skipping Ownership Verification

### The Problem

Authenticating the user is necessary but not sufficient. You must also verify they own the specific resource they're accessing.

### Why It's Dangerous

- **Horizontal privilege escalation**: Authenticated users can access other users' resources
- **IDOR vulnerability**: Predictable IDs (like Plaid item IDs) can be enumerated
- **Data leakage**: One compromised account can access all accounts

### ❌ Insecure Example

```typescript
// convex/plaid.ts - VULNERABLE
export const deleteItem = mutation({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    // ✅ Authenticates user
    const userId = await requireAuth(ctx);

    // ❌ But doesn't verify they OWN this item!
    return await ctx.runMutation(components.plaid.public.deletePlaidItem, {
      plaidItemId: args.plaidItemId,
    });
  },
});
```

**Attack scenario:**
```typescript
// Attacker deletes another user's bank connection
await ctx.runMutation(api.plaid.deleteItem, {
  plaidItemId: "victim-item-abc123"  // Guessed or enumerated ID
});
// Succeeds because no ownership check!
```

### ✅ Secure Alternative

```typescript
export const deleteMyItem = mutation({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    // 1. Authenticate
    const userId = await requireAuth(ctx);

    // 2. Fetch the item
    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item) {
      throw new Error("Plaid item not found");
    }

    // 3. ✅ Verify ownership
    if (item.userId !== userId) {
      throw new Error("Unauthorized: You don't own this item");
    }

    // 4. Safe to delete
    return await ctx.runMutation(components.plaid.public.deletePlaidItem, {
      plaidItemId: args.plaidItemId,
    });
  },
});
```

### Alternative: Using `requireOwnership()` Helper

```typescript
import { requireAuth, requireOwnership } from "@crowdevelopment/convex-plaid/helpers";

export const deleteMyItem = mutation({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item) {
      throw new Error("Plaid item not found");
    }

    // ✅ Throws if user doesn't own the resource
    await requireOwnership(ctx, item.userId);

    return await ctx.runMutation(components.plaid.public.deletePlaidItem, {
      plaidItemId: args.plaidItemId,
    });
  },
});
```

### Key Takeaway

⚠️ **Authentication (who you are) is NOT authorization (what you can access). Always verify ownership before operations on specific resources.**

---

## Anti-Pattern 3: Exposing Internal Mutations as Public Actions

### The Problem

Internal mutations are designed for component-internal use and bypass security checks. Exposing them directly creates unprotected endpoints.

### Why It's Dangerous

- **Bypasses business logic**: Internal mutations don't validate state transitions
- **Race conditions**: No concurrency protection
- **Data corruption**: Direct database writes without validation

### ❌ Insecure Example

```typescript
// convex/plaid.ts - VULNERABLE
import { internalMutation } from "./_generated/server";
import { components } from "./_generated/api";

// ❌ Exposing an internal mutation directly
export const dangerousUpdateItemStatus = mutation({
  args: { plaidItemId: v.string(), status: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    // ❌ Directly calling internal mutation without validation
    return await ctx.runMutation(components.plaid.private.updateItemStatus, {
      plaidItemId: args.plaidItemId,
      status: args.status,  // Client can set ANY status
    });
  },
});
```

**Attack scenario:**
```typescript
// Attacker bypasses state machine validation
await ctx.runMutation(api.plaid.dangerousUpdateItemStatus, {
  plaidItemId: "item-123",
  status: "active"  // Force status without proper sync workflow
});
```

### ✅ Secure Alternative

```typescript
// Don't expose internal mutations at all.
// Use component actions that enforce proper workflows:

export const syncItem = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    // Verify ownership
    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item || item.userId !== userId) {
      throw new Error("Unauthorized");
    }

    // ✅ Use the proper action with built-in validation
    return await plaid.syncTransactions(ctx, {
      plaidItemId: args.plaidItemId,
    });
    // Status updated safely by component internals
  },
});
```

### Key Takeaway

⚠️ **Never expose component internal mutations. Use the public actions/mutations provided by the component, which include proper validation and state management.**

---

## Anti-Pattern 4: Not Handling Authentication Errors

### The Problem

Failing to handle authentication errors properly can leak information about system state or create denial-of-service conditions.

### Why It's Dangerous

- **Information leakage**: Different errors for "not found" vs "unauthorized" reveal data existence
- **Poor UX**: Generic errors don't guide users to re-authenticate
- **Resource exhaustion**: Unauthenticated requests can trigger expensive operations before failing

### ❌ Insecure Example

```typescript
export const getItem = query({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    let userId: string;
    try {
      userId = await requireAuth(ctx);
    } catch (e) {
      // ❌ Swallowing auth errors
      return null;
    }

    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item) {
      // ❌ Different error than auth failure
      throw new Error("Item not found");
    }

    if (item.userId !== userId) {
      // ❌ Reveals item exists but user doesn't own it
      throw new Error("You don't own this item");
    }

    return item;
  },
});
```

**Information leakage:**
```typescript
// Attacker can determine if items exist:
try {
  await ctx.runQuery(api.plaid.getItem, { plaidItemId: "guess-123" });
} catch (e) {
  if (e.message === "Item not found") {
    // Item doesn't exist
  } else if (e.message === "You don't own this item") {
    // Item EXISTS but belongs to someone else!
  }
}
```

### ✅ Secure Alternative

```typescript
export const getMyItem = query({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    // 1. ✅ Let auth errors propagate (handled by Convex framework)
    const userId = await requireAuth(ctx);

    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    // 2. ✅ Return same response for "not found" and "unauthorized"
    if (!item || item.userId !== userId) {
      return null;  // Don't reveal why
    }

    return item;
  },
});
```

**Better yet - avoid accepting IDs entirely:**
```typescript
export const getMyItems = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);

    // ✅ Only returns user's own items - no ownership check needed
    return await ctx.runQuery(components.plaid.public.getItemsByUser, {
      userId,
    });
  },
});
```

### Key Takeaway

⚠️ **Return consistent errors for "not found" and "unauthorized" to prevent information leakage. Better yet, design APIs that don't require ID-based lookups.**

---

## Additional Security Concerns

The following patterns, while not as immediately critical as the core four, represent important security considerations that can lead to vulnerabilities, performance issues, or data leakage. Consider these as you mature your integration.

---

## Additional Concern 1: Caching User Data Without userId Scoping

### The Problem

Caching data without including `userId` in the cache key allows one user to access another user's cached data.

### Why It's Dangerous

- **Cross-user data leakage**: User A sees User B's financial data
- **Stale data**: Cache doesn't invalidate on user change
- **Session fixation**: Cached data persists after logout

### ❌ Insecure Example

```typescript
// In-memory cache (BAD)
const itemCache = new Map<string, any>();

export const getCachedItem = query({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    // ❌ Cache key doesn't include userId
    const cacheKey = args.plaidItemId;

    if (itemCache.has(cacheKey)) {
      return itemCache.get(cacheKey);  // ❌ Could be another user's data!
    }

    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (item?.userId === userId) {
      itemCache.set(cacheKey, item);
      return item;
    }

    return null;
  },
});
```

**Attack scenario:**
```typescript
// User A requests their item
await ctx.runQuery(api.plaid.getCachedItem, { plaidItemId: "item-123" });
// Cached with key "item-123"

// User B requests same plaidItemId (could be random guess)
await ctx.runQuery(api.plaid.getCachedItem, { plaidItemId: "item-123" });
// Gets User A's cached data before ownership check!
```

### ✅ Secure Alternative

```typescript
// If you must cache (generally not needed with Convex reactivity):
const itemCache = new Map<string, any>();

export const getCachedItem = query({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    // ✅ Include userId in cache key
    const cacheKey = `${userId}:${args.plaidItemId}`;

    if (itemCache.has(cacheKey)) {
      return itemCache.get(cacheKey);
    }

    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (item?.userId === userId) {
      itemCache.set(cacheKey, item);
      return item;
    }

    return null;
  },
});
```

### Even Better: Don't Cache Convex Queries

```typescript
// ✅ Convex has built-in reactive caching - don't add your own
export const getMyItem = query({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item || item.userId !== userId) {
      return null;
    }

    return item;
  },
});
// Convex automatically caches and invalidates based on data dependencies
```

### Key Takeaway

⚠️ **If you cache user-specific data, ALWAYS include `userId` in the cache key. Better yet, rely on Convex's built-in reactive caching instead of rolling your own.**

---

## Additional Concern 2: Using Weak or Predictable Resource IDs

### The Problem

Exposing database-generated IDs or using predictable patterns makes enumeration attacks easy.

### Why It's Dangerous

- **Enumeration attacks**: Attacker can guess valid IDs
- **Timing attacks**: Different response times reveal ID validity
- **Brute force feasible**: Sequential IDs are trivial to enumerate

### ❌ Insecure Example

```typescript
// Using sequential IDs or exposing internal Convex IDs
export const getAccountDetails = query({
  args: { accountNumber: v.number() },  // ❌ Sequential
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    // ❌ Easy to enumerate: 1, 2, 3, 4...
    const account = await ctx.db
      .query("accounts")
      .filter((q) => q.eq(q.field("accountNumber"), args.accountNumber))
      .first();

    if (!account || account.userId !== userId) {
      return null;
    }

    return account;
  },
});
```

**Attack scenario:**
```typescript
// Attacker enumerates all accounts
for (let i = 1; i < 10000; i++) {
  const account = await ctx.runQuery(api.plaid.getAccountDetails, {
    accountNumber: i
  });
  if (account) {
    console.log(`Found account: ${i}`);
  }
}
```

### ✅ Secure Alternative

```typescript
// Use Plaid's opaque accountId strings (already secure)
export const getAccountDetails = query({
  args: { accountId: v.string() },  // ✅ Plaid's opaque ID
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    // ✅ accountId is a long random string like "BxBXxLj1m4HMXBm9WZZmCWVbPjX16EHwv99vp"
    const accounts = await ctx.runQuery(components.plaid.public.getAccountsByUser, {
      userId,
    });

    const account = accounts.find((a) => a.accountId === args.accountId);

    if (!account) {
      return null;
    }

    return account;
  },
});
```

### Even Better: Avoid ID Parameters

```typescript
// ✅ Return all user's accounts - no ID needed
export const getMyAccounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);

    return await ctx.runQuery(components.plaid.public.getAccountsByUser, {
      userId,
    });
  },
});

// Client filters by accountId locally
const accounts = useQuery(api.plaid.getMyAccounts);
const targetAccount = accounts?.find(a => a.accountId === accountId);
```

### Key Takeaway

⚠️ **Use long, random, opaque identifiers for resources. Better yet, design APIs that return all user resources and let clients filter locally.**

---

## Additional Concern 3: Not Rate-Limiting Sensitive Operations

### The Problem

Sensitive operations (like sync triggers, Link token generation) without rate limiting enable abuse and DOS attacks.

### Why It's Dangerous

- **Plaid API quota exhaustion**: Component consumes your Plaid API limits
- **Cost attacks**: Attacker triggers expensive operations repeatedly
- **Service degradation**: Database/network overload affects all users

### ❌ Insecure Example

```typescript
export const syncMyItem = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item || item.userId !== userId) {
      throw new Error("Unauthorized");
    }

    // ❌ No rate limiting - user can trigger this in a loop
    return await plaid.syncTransactions(ctx, {
      plaidItemId: args.plaidItemId,
    });
  },
});
```

**Attack scenario:**
```typescript
// Attacker triggers sync 1000x per second
while (true) {
  await ctx.runAction(api.plaid.syncMyItem, { plaidItemId: "my-item" });
}
// Exhausts Plaid API quota, racks up costs
```

### ✅ Secure Alternative

```typescript
import { RateLimiter } from "@convex-dev/rate-limiter";

const rateLimiter = new RateLimiter(components.rateLimiter, {
  syncTransactions: { kind: "token bucket", rate: 1, period: 60000 }, // 1/min
});

export const syncMyItem = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    // ✅ Rate limit per user + item
    const rateLimitKey = `sync:${userId}:${args.plaidItemId}`;
    await rateLimiter.limit(ctx, rateLimitKey, { throws: true });

    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item || item.userId !== userId) {
      throw new Error("Unauthorized");
    }

    return await plaid.syncTransactions(ctx, {
      plaidItemId: args.plaidItemId,
    });
  },
});
```

### Alternative: Check Last Sync Time

```typescript
export const syncMyItem = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item || item.userId !== userId) {
      throw new Error("Unauthorized");
    }

    // ✅ Enforce minimum sync interval
    const lastSync = item.lastSyncedAt ?? 0;
    const minInterval = 5 * 60 * 1000; // 5 minutes
    if (Date.now() - lastSync < minInterval) {
      throw new Error("Sync already triggered recently. Please wait.");
    }

    return await plaid.syncTransactions(ctx, {
      plaidItemId: args.plaidItemId,
    });
  },
});
```

### Key Takeaway

⚠️ **Always rate-limit sensitive operations that call external APIs, trigger expensive computations, or modify state. Consider both per-user and global limits.**

---

## Additional Concern 4: Leaking Sensitive Data in Error Messages

### The Problem

Verbose error messages can reveal system internals, user data, or security mechanisms.

### Why It's Dangerous

- **Schema leakage**: Error messages reveal database structure
- **User enumeration**: Different errors for "user exists" vs "user not found"
- **Stack traces**: Expose code paths and internal logic

### ❌ Insecure Example

```typescript
export const getItem = query({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item) {
      // ❌ Reveals item doesn't exist
      throw new Error(`Plaid item ${args.plaidItemId} not found in database`);
    }

    if (item.userId !== userId) {
      // ❌ Reveals item exists but user doesn't own it
      throw new Error(
        `Access denied: Item ${args.plaidItemId} belongs to user ${item.userId}, not ${userId}`
      );
    }

    return item;
  },
});
```

### ✅ Secure Alternative

```typescript
export const getMyItem = query({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    // ✅ Same response for both cases
    if (!item || item.userId !== userId) {
      return null;  // Or: throw new Error("Item not found")
    }

    return item;
  },
});
```

### Log Internally, Return Generic Errors

```typescript
export const syncItem = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    try {
      return await plaid.syncTransactions(ctx, {
        plaidItemId: args.plaidItemId,
      });
    } catch (error) {
      // ✅ Log full error internally
      console.error("Sync failed:", {
        userId,
        plaidItemId: args.plaidItemId,
        error,
      });

      // ✅ Return generic error to client
      throw new Error("Sync failed. Please try again later.");
    }
  },
});
```

### Key Takeaway

⚠️ **Return generic error messages to clients. Log detailed errors server-side for debugging. Never expose internal IDs, user data, or system structure in error messages.**

---

## Additional Concern 5: Not Validating Resource State Before Operations

### The Problem

Performing operations without checking resource state can corrupt data or bypass business logic.

### Why It's Dangerous

- **State machine violations**: Skip required steps in workflows
- **Race conditions**: Concurrent operations conflict
- **Data corruption**: Invalid state transitions

### ❌ Insecure Example

```typescript
export const reauthItem = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item || item.userId !== userId) {
      throw new Error("Unauthorized");
    }

    // ❌ Doesn't check if item actually needs reauth
    return await plaid.createUpdateLinkToken(ctx, {
      plaidItemId: args.plaidItemId,
    });
  },
});
```

**Problem:**
```typescript
// User can generate update link tokens for active items
// Wastes Plaid API quota, confuses users
await ctx.runAction(api.plaid.reauthItem, {
  plaidItemId: "active-item-123"
});
// Succeeds even though item doesn't need reauth!
```

### ✅ Secure Alternative

```typescript
export const reauthItem = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item || item.userId !== userId) {
      throw new Error("Unauthorized");
    }

    // ✅ Validate state before operation
    if (item.status !== "needs_reauth") {
      throw new Error(
        `Item does not need re-authentication. Current status: ${item.status}`
      );
    }

    return await plaid.createUpdateLinkToken(ctx, {
      plaidItemId: args.plaidItemId,
    });
  },
});
```

### Key Takeaway

⚠️ **Always validate resource state before operations. Enforce business logic constraints and state machine rules in your wrapper functions.**

---

## Additional Concern 6: Exposing Access Tokens or Encryption Keys

### The Problem

Access tokens (even encrypted) and encryption keys must NEVER be returned to clients or logged.

### Why It's Dangerous

- **Complete account takeover**: Access tokens grant full Plaid API access
- **Bypasses all security**: Attacker can make direct Plaid API calls
- **Irreversible damage**: Can't revoke access tokens without user re-auth

### ❌ Insecure Example

```typescript
export const debugItem = query({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    // Hypothetically accessing internal mutation (you shouldn't do this)
    const item = await ctx.runQuery(components.plaid.private.getItemWithToken, {
      plaidItemId: args.plaidItemId,
    });

    if (item?.userId !== userId) {
      throw new Error("Unauthorized");
    }

    // ❌ NEVER return accessToken (even if encrypted)
    console.log("Debug item:", item.accessToken);  // ❌ Logged
    return item;  // ❌ Returned to client
  },
});
```

### ✅ Secure Alternative

```typescript
// The component already handles this correctly:
export const getMyItem = query({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    // ✅ Component's public.getItem NEVER returns accessToken
    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });

    if (!item || item.userId !== userId) {
      return null;
    }

    // ✅ Safe to return - accessToken excluded by component
    return item;
  },
});
```

### Never Log Sensitive Data

```typescript
// ❌ BAD
console.log("Exchanging token:", publicToken);  // Logs sensitive token

// ✅ GOOD
console.log("Exchanging token for user:", userId);  // Safe metadata only
```

### Key Takeaway

⚠️ **The component already excludes `accessToken` from all public queries. Never try to access or expose it. Never log sensitive data like tokens, keys, or full error objects from Plaid API.**

---

## Summary: Security Checklist

### ✅ Core Security Requirements (MUST DO)

These four requirements correspond to the core anti-patterns and must be enforced in every wrapper function:

1. **Derive userId from `ctx.auth`** - Use `requireAuth()`, never accept from client (Anti-Pattern 1)
2. **Verify ownership** - Check `resource.userId === authenticatedUserId` before operations (Anti-Pattern 2)
3. **Never expose internal mutations** - Only use component's public API with proper validation (Anti-Pattern 3)
4. **Return consistent errors** - Don't leak information about resource existence (Anti-Pattern 4)

### ✅ Additional Best Practices (SHOULD DO)

These recommendations address the additional security concerns:

5. **Cache with userId scoping** - Include userId in cache keys if caching is necessary
6. **Use opaque resource IDs** - Prefer long random IDs over sequential ones
7. **Rate limit sensitive operations** - Prevent abuse of external APIs
8. **Return generic errors** - Log detailed errors server-side only
9. **Validate resource state** - Check status/state before operations
10. **Protect sensitive data** - Never log or return access tokens or encryption keys

### ❌ NEVER Do These

1. **Accept userId from client** - Would allow complete data breach
2. **Skip ownership checks** - Would enable horizontal privilege escalation
3. **Expose internal mutations** - Would bypass validation and state management
4. **Return different errors for "not found" vs "unauthorized"** - Leaks information about system state
5. **Log sensitive data** - Would expose tokens/keys in logs
6. **Trust client input without validation** - Would enable injection attacks

### 📚 Additional Resources

- **Secure Examples**: [example/convex/secureWrappers.ts](../example/convex/secureWrappers.ts)
- **Security Overview**: [CLAUDE.md - Security Best Practices](../CLAUDE.md#security-best-practices)
- **Architecture**: [docs/auth-support-findings.md](./auth-support-findings.md)
- **Helper Functions**: Import from `@crowdevelopment/convex-plaid/helpers`

### 🔍 Security Review Checklist

Before deploying, verify these **critical requirements** (Core Anti-Patterns 1-4):

- [ ] **No functions accept `userId` as an argument** - All userId values derived from `ctx.auth`
- [ ] **All queries/mutations call `requireAuth()` first** - No unauthenticated access
- [ ] **Resource-specific operations verify ownership** - Check `resource.userId === authenticatedUserId`
- [ ] **No internal mutations exposed directly** - Only use component's public actions/mutations
- [ ] **Consistent error responses** - Same error for "not found" and "unauthorized"

**Additional checks (recommended):**

- [ ] Sensitive operations are rate-limited
- [ ] No access tokens or keys in logs or responses
- [ ] State transitions are validated before operations
- [ ] Cache keys include userId if caching is used

---

**Remember:** Financial data security is not optional. Every mistake in this document has been exploited in real-world applications. The core four anti-patterns can lead to complete data breaches. Review your code carefully and test authorization thoroughly.
