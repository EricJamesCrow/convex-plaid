# Security Helpers & Documentation - Revised Implementation Plan

> **Status:** Revised based on Task 1 research findings

**Original Plan:** Auth-scoped queries inside component using `ctx.auth`
**Finding:** Components cannot access `ctx.auth` (architectural constraint)
**Revised Approach:** Helper utilities + documentation for secure host app wrappers

---

## Research Findings Summary

- ✅ **Task 1 Complete:** Verified `ctx.auth` unavailable in components
- 📄 **Research docs:** `docs/auth-support-findings.md`
- 🎯 **New strategy:** Provide tools for secure host app integration

---

## Revised Goals

1. Create TypeScript helper utilities to make secure patterns easy
2. Document security best practices with clear examples
3. Provide anti-pattern warnings
4. Version bump to 0.7.0 (minor - new features, no breaking changes)

---

## Task 2: Create Helper Utilities

**Files:**
- Create: `src/client/helpers.ts`
- Create: `src/client/helpers.test.ts`

### Helper Functions to Implement

#### 1. `withAuth()` - Higher-order function wrapper

```typescript
/**
 * Wraps a component query/mutation to enforce authentication
 *
 * @example
 * export const getMyItems = withAuth(
 *   api.plaid.public.getItemsByUser
 * );
 */
export function withAuth<TArgs, TReturn>(
  componentFn: FunctionReference<"query" | "mutation", "public", TArgs & { userId: string }, TReturn>
) {
  return async (ctx: QueryCtx | MutationCtx): Promise<TReturn> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    return await ctx.runQuery(componentFn, {
      ...args,
      userId: identity.subject,
    });
  };
}
```

#### 2. `requireAuth()` - Extract and validate userId

```typescript
/**
 * Extract userId from ctx.auth and throw if not authenticated
 */
export async function requireAuth(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    throw new Error("Authentication required");
  }
  return identity.subject;
}
```

#### 3. `requireOwnership()` - Verify resource ownership

```typescript
/**
 * Verify that the authenticated user owns a specific resource
 */
export async function requireOwnership(
  ctx: QueryCtx | MutationCtx,
  resourceUserId: string
): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    throw new Error("Authentication required");
  }
  if (identity.subject !== resourceUserId) {
    throw new Error("Unauthorized: You don't own this resource");
  }
}
```

---

## Task 3: Add TypeScript Types

**Files:**
- Modify: `src/client/types.ts`

### Types to Add

```typescript
/**
 * Context with auth available (for host app wrappers)
 */
export type AuthenticatedContext = {
  auth: {
    getUserIdentity: () => Promise<UserIdentity | null>;
  };
  runQuery: <T>(fn: FunctionReference, args: any) => Promise<T>;
  runMutation: <T>(fn: FunctionReference, args: any) => Promise<T>;
};

/**
 * User identity from Convex auth
 */
export type UserIdentity = {
  subject: string;
  email?: string;
  name?: string;
  [key: string]: unknown;
};

/**
 * Secure wrapper pattern signature
 */
export type SecureWrapper<TArgs, TReturn> = (
  ctx: AuthenticatedContext,
  args?: TArgs
) => Promise<TReturn>;
```

---

## Task 4: Update CLAUDE.md - Security Best Practices

**Files:**
- Modify: `CLAUDE.md`

### Add after "## Overview" section:

```markdown
## Security Best Practices

⚠️ **IMPORTANT:** This component is designed to run in a Convex component context, which means it **does not have access to `ctx.auth`**. Security must be enforced in your host app's wrapper functions.

### The Security Pattern

**❌ INSECURE - Direct exposure:**
```typescript
// DON'T DO THIS - Allows arbitrary userId access from client
export const getItemsByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.plaid.public.getItemsByUser, args);
  },
});
```

**✅ SECURE - Auth-scoped wrapper:**
```typescript
// DO THIS - Derives userId from authenticated user
import { requireAuth } from "@crowdevelopment/convex-plaid/helpers";

export const getMyItems = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    return await ctx.runQuery(components.plaid.public.getItemsByUser, { userId });
  },
});
```

### Helper Utilities

The component provides helper functions to simplify secure implementations:

```typescript
import { requireAuth, requireOwnership } from "@crowdevelopment/convex-plaid/helpers";

// Example 1: Simple auth check
export const getMyAccounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    return await ctx.runQuery(components.plaid.public.getAccountsByUser, { userId });
  },
});

// Example 2: Ownership verification
export const getTransactionsByAccount = query({
  args: { accountId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    // Verify user owns this account
    const accounts = await ctx.runQuery(
      components.plaid.public.getAccountsByUser,
      { userId }
    );
    const account = accounts.find(a => a.accountId === args.accountId);
    if (!account) throw new Error("Account not found or unauthorized");

    return await ctx.runQuery(
      components.plaid.public.getTransactionsByAccount,
      { accountId: args.accountId }
    );
  },
});
```

### Why This Pattern?

Convex components are designed for **reusability across different auth providers**. By keeping auth logic in the host app:
- ✅ Component works with Clerk, Auth0, custom auth, etc.
- ✅ Clear separation of concerns
- ✅ Easier testing and debugging
- ✅ Explicit data flow

See `docs/auth-support-findings.md` for detailed architectural rationale.
```

---

## Task 5: Create Example Implementations

**Files:**
- Create: `examples/secure-wrappers.ts`

Full examples showing:
1. Read-only query wrappers
2. Mutation wrappers with ownership checks
3. Action wrappers for sensitive operations
4. Patterns for different auth providers

---

## Task 6: Document Anti-Patterns

**Files:**
- Create: `docs/security-anti-patterns.md`

Document common mistakes:
1. Accepting client-supplied IDs without validation
2. Exposing internal mutations as public actions
3. Not checking ownership before operations
4. Using userId from function args instead of ctx.auth

---

## Task 7: Write Tests

**Files:**
- Create: `src/client/helpers.test.ts`

Test coverage:
- `requireAuth()` throws when not authenticated
- `requireAuth()` returns userId when authenticated
- `requireOwnership()` validates ownership correctly
- `requireOwnership()` rejects non-owners

---

## Task 8: Version Bump to 0.7.0

**Files:**
- Modify: `package.json` (version: "0.7.0")
- Create: `CHANGELOG.md` entry

### Changelog Entry

```markdown
## [0.7.0] - 2026-01-15

### Added

#### Security Helper Utilities
- `requireAuth()` - Extract and validate userId from ctx.auth
- `requireOwnership()` - Verify resource ownership before operations
- TypeScript types for secure wrapper patterns

#### Documentation
- Security Best Practices section in README
- Example secure wrapper implementations
- Anti-patterns documentation
- Research findings on component auth architecture

### Changed
- Clarified that security must be enforced in host app wrappers
- Updated integration examples to show secure patterns

### Security
- Documented secure integration patterns to prevent data leaks
- Added helper utilities to simplify secure implementations

This release provides tools and documentation to help developers integrate
the Plaid component securely, based on findings that Convex components
cannot access `ctx.auth` directly.
```

---

## Success Criteria

- ✅ Helper utilities created and tested
- ✅ TypeScript types provide good developer experience
- ✅ CLAUDE.md has clear security guidance with examples
- ✅ Example implementations demonstrate best practices
- ✅ Anti-patterns documented with explanations
- ✅ All tests passing
- ✅ Version 0.7.0 published with clear changelog
- ✅ No breaking changes to existing users

---

## Timeline

Estimated: 2-3 hours
- Task 2: Helpers (30 min)
- Task 3: Types (15 min)
- Task 4: CLAUDE.md (30 min)
- Task 5: Examples (30 min)
- Task 6: Anti-patterns doc (20 min)
- Task 7: Tests (30 min)
- Task 8: Version bump (15 min)
