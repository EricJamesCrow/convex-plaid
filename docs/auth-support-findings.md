# ctx.auth Support in Convex Components - Research Findings

**Date:** January 15, 2026
**Research Task:** Verify whether Convex components can access `ctx.auth` for security hardening

---

## Summary

**Components CANNOT access `ctx.auth`** - this is a documented constraint of the Convex component architecture.

---

## Official Documentation

According to [Convex Components - Authoring](https://docs.convex.dev/components/authoring):

> "Within a component, `ctx.auth` is not available."

The documentation explicitly states that:

1. **Authentication must occur in the parent app**
2. **Parent app passes identifiers (like `userId`) as arguments to component functions**
3. **This design is intentional** - explicit passing makes data flow clear and components easier to understand and test

---

## Component Context Availability

### Available in Components:
- `ctx.db` - Database operations
- `ctx.runQuery` / `ctx.runMutation` / `ctx.runAction` - Call other component functions
- `ctx.scheduler` - Schedule functions

### NOT Available in Components:
- `ctx.auth` - Authentication context
- `process.env` - Environment variables (must be passed as arguments)

---

## Implications for Security Hardening

### Original Plan (NOT POSSIBLE)
The security hardening plan proposed adding auth-scoped queries that derive `userId` from `ctx.auth`:

```typescript
// ❌ NOT POSSIBLE - ctx.auth is not available in components
export const getMyItems = query({
  handler: async (ctx) => {
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) throw new Error("Not authenticated");
    return await ctx.db.query("plaidItems").filter(q => q.eq(q.field("userId"), userId));
  }
});
```

### Required Pattern (HOST APP WRAPPER)
Components must continue accepting `userId` as a parameter. Security is enforced by the **host app** wrapping component queries:

```typescript
// In host app: convex/plaid.ts
export const getMyItems = query({
  handler: async (ctx) => {
    // Host app has ctx.auth available
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) throw new Error("Not authenticated");

    // Pass userId to component query
    return await ctx.runQuery(plaid.api.getItemsByUser, { userId });
  }
});
```

---

## Component Isolation by Design

The Convex documentation explains this is intentional architecture:

- **Portability**: Components work across different auth providers
- **Testability**: Clear boundaries make testing easier
- **Explicitness**: Data flow is visible and auditable
- **Reusability**: Same component works with any host app's auth setup

---

## Test File Created

Created `src/component/test-auth.ts` to demonstrate the limitation:

```typescript
// This will fail with TypeScript error and runtime error
const identity = await ctx.auth?.getUserIdentity();
```

---

## Recommendation for Security Hardening

Since components cannot access `ctx.auth`, security must be enforced at the **host app integration layer**:

### Strategy 1: Host App Wrapper Pattern (RECOMMENDED)
The host app creates wrapper queries/mutations that:
1. Extract `userId` from `ctx.auth.getUserIdentity()`
2. Validate authentication
3. Pass validated `userId` to component functions

**Pros:**
- Works with component architecture
- Host app controls auth entirely
- Clear separation of concerns

**Cons:**
- Every component query needs a host wrapper
- More boilerplate code

### Strategy 2: Component Documentation Updates
Instead of changing the component code, improve documentation:
1. Add security best practices section
2. Provide host app wrapper templates
3. Include examples of secure integration patterns

**Pros:**
- No breaking changes
- Maintains component portability
- Educates users on proper security

**Cons:**
- Relies on users implementing correctly
- No enforcement mechanism

---

## Related Resources

- [Convex Components - Authoring](https://docs.convex.dev/components/authoring)
- [Auth in Functions | Convex Developer Hub](https://docs.convex.dev/auth/functions-auth)
- [Authentication | Convex Developer Hub](https://docs.convex.dev/auth)

---

## Next Steps

1. **Update security plan** to focus on host app wrapper pattern
2. **Create documentation** showing secure integration examples
3. **Provide TypeScript helpers** to reduce boilerplate for host apps
4. **Consider adding validation utilities** that host apps can import
