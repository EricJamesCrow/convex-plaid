# @crowdevelopment/convex-plaid

A Plaid component for Convex that provides bank account connections, transaction syncing, credit card liabilities, and recurring stream detection.

## Overview

This component wraps the Plaid API and stores all data in Convex tables. It handles:

- **Plaid Link** - Create link tokens, exchange public tokens
- **Accounts** - Fetch and store bank/credit accounts with balances
- **Transactions** - Cursor-based incremental sync with categories
- **Liabilities** - Credit card APRs, payment dates, statement balances
- **Recurring Streams** - Subscription/bill detection, income identification
- **Webhooks** - JWT signature verification, auto-sync triggers
- **Re-auth Flow** - Update Link mode for expired credentials

## Security Best Practices

⚠️ **IMPORTANT:** This component is designed to run in a Convex component context, which means it **does not have access to `ctx.auth`**. Security must be enforced in your host app's wrapper functions.

### Why This Matters

Convex components are **architecturally isolated** from the host app's authentication context. This design provides:
- ✅ **Portability**: Component works with any auth provider (Clerk, Auth0, custom, etc.)
- ✅ **Testability**: Clear boundaries make testing easier
- ✅ **Explicitness**: Data flow is visible and auditable
- ✅ **Reusability**: Same component works across different apps

See `docs/auth-support-findings.md` for detailed architectural rationale.

### The Security Pattern

**❌ INSECURE - Direct exposure:**
```typescript
// DON'T DO THIS - Allows arbitrary userId access from client
import { query } from "./_generated/server";
import { components } from "./_generated/api";

export const getItemsByUser = query({
  args: { userId: v.string() },  // ❌ Client can pass ANY userId
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.plaid.public.getItemsByUser, args);
  },
});
```

**✅ SECURE - Auth-scoped wrapper:**
```typescript
// DO THIS - Derives userId from authenticated user
import { query } from "./_generated/server";
import { components } from "./_generated/api";
import { requireAuth } from "@crowdevelopment/convex-plaid/helpers";

export const getMyItems = query({
  args: {},  // ✅ No userId parameter
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);  // ✅ Get from auth
    return await ctx.runQuery(components.plaid.public.getItemsByUser, { userId });
  },
});
```

### Helper Utilities

The component provides helper functions to simplify secure implementations:

#### `requireAuth(ctx)` - Extract and Validate User ID

```typescript
import { requireAuth } from "@crowdevelopment/convex-plaid/helpers";

export const getMyAccounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    return await ctx.runQuery(components.plaid.public.getAccountsByUser, { userId });
  },
});
```

- **Throws:** `"Authentication required"` if user not logged in
- **Returns:** Authenticated user's ID (`identity.subject`)

#### `requireOwnership(ctx, resourceUserId)` - Verify Resource Ownership

```typescript
import { requireAuth, requireOwnership } from "@crowdevelopment/convex-plaid/helpers";

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
    if (!account) {
      throw new Error("Account not found or unauthorized");
    }

    return await ctx.runQuery(
      components.plaid.public.getTransactionsByAccount,
      { accountId: args.accountId }
    );
  },
});
```

- **Throws:** `"Authentication required"` if not logged in
- **Throws:** `"Unauthorized: You don't own this resource"` if userId mismatch

#### `requireItemOwnership(ctx, plaidItemId, plaidApi)` - Verify Plaid Item Ownership

A convenience helper that combines authentication and item ownership verification in one call:

```typescript
import { requireItemOwnership } from "@crowdevelopment/convex-plaid/helpers";

export const syncMyItem = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    // Verifies auth AND ownership in one call, returns the item
    const item = await requireItemOwnership(ctx, args.plaidItemId, plaidClient.api);

    // Safe to proceed - user owns this item
    return await ctx.runAction(components.plaid.actions.syncTransactions, {
      plaidItemId: args.plaidItemId,
    });
  },
});
```

- **Throws:** `"Authentication required"` if not logged in
- **Throws:** `"Plaid item not found"` if item doesn't exist
- **Throws:** `"Unauthorized: You don't own this item"` if userId mismatch
- **Returns:** The `PlaidItem` object if owned by the user

#### `requireAccountOwnership(ctx, accountId, plaidApi)` - Verify Plaid Account Ownership

A convenience helper that verifies the authenticated user owns a specific account:

```typescript
import { requireAccountOwnership } from "@crowdevelopment/convex-plaid/helpers";

export const getAccountTransactions = query({
  args: { accountId: v.string() },
  handler: async (ctx, args) => {
    // Verifies auth AND ownership in one call, returns the account
    const account = await requireAccountOwnership(ctx, args.accountId, plaidClient.api);

    // Safe to proceed - user owns this account
    return await ctx.runQuery(
      components.plaid.public.getTransactionsByAccount,
      { accountId: args.accountId }
    );
  },
});
```

- **Throws:** `"Authentication required"` if not logged in
- **Throws:** `"Account not found or unauthorized"` if account doesn't exist or user doesn't own it
- **Returns:** The `PlaidAccount` object if owned by the user

### Complete Integration Example

Here's how to create secure wrapper queries for the most common operations:

```typescript
// convex/plaid.ts
import { query, action } from "./_generated/server";
import { components } from "./_generated/api";
import { requireAuth } from "@crowdevelopment/convex-plaid/helpers";
import { v } from "convex/values";

// === SECURE QUERIES ===

export const getMyItems = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    return await ctx.runQuery(components.plaid.public.getItemsByUser, { userId });
  },
});

export const getMyAccounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    return await ctx.runQuery(components.plaid.public.getAccountsByUser, { userId });
  },
});

export const getMyTransactions = query({
  args: {
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    return await ctx.runQuery(components.plaid.public.getTransactionsByUser, {
      userId,
      ...args,
    });
  },
});

// === SECURE ACTIONS ===

export const syncMyTransactions = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    // Verify user owns this item
    const item = await ctx.runQuery(components.plaid.public.getItem, {
      plaidItemId: args.plaidItemId,
    });
    if (!item || item.userId !== userId) {
      throw new Error("Item not found or unauthorized");
    }

    // Proceed with sync
    return await ctx.runAction(components.plaid.actions.syncTransactions, {
      plaidItemId: args.plaidItemId,
    });
  },
});
```

### Common Pitfalls

🚫 **Don't accept client-supplied IDs without validation:**
```typescript
// BAD - Client can access any item
export const getItem = query({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.plaid.public.getItem, args);
  },
});
```

🚫 **Don't use userId from function arguments:**
```typescript
// BAD - Client can pass any userId
export const getAccounts = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(
      components.plaid.public.getAccountsByUser,
      { userId: args.userId }  // ❌ Trusting client input
    );
  },
});
```

✅ **Always derive userId from ctx.auth:**
```typescript
// GOOD - Extract userId from auth
export const getMyAccounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);  // ✅ From auth
    return await ctx.runQuery(
      components.plaid.public.getAccountsByUser,
      { userId }
    );
  },
});
```

### Additional Resources

- **Architecture Details**: `docs/auth-support-findings.md` - Why components can't access ctx.auth
- **Helper Functions**: Import from `@crowdevelopment/convex-plaid/helpers`
  - `requireAuth(ctx)` - Extract userId from auth context
  - `requireOwnership(ctx, resourceUserId)` - Verify generic ownership
  - `requireItemOwnership(ctx, plaidItemId, plaidApi)` - Verify Plaid item ownership
  - `requireAccountOwnership(ctx, accountId, plaidApi)` - Verify Plaid account ownership
- **TypeScript Types**: `AuthenticatedContext`, `UserIdentity`, `SecureWrapper`, `PlaidItem`, `PlaidAccount`

---

## Architecture

This is a **Convex Component** - an isolated module with its own schema and functions that integrates into a host Convex app.

```
Host App (your convex/ folder)
├── convex.config.ts      # Registers the component
├── plaid.ts              # Wrapper actions using Plaid client
├── http.ts               # Webhook route registration
└── _generated/api.js     # Includes components.plaid

Component (node_modules/@crowdevelopment/convex-plaid)
├── src/component/        # Internal tables, actions, queries
├── src/client/           # Plaid class for host app integration
└── src/react/            # usePlaidLink React hook
```

**Key constraints:**
- Components cannot access `process.env` - all config must be passed explicitly
- Components cannot use `ctx.auth` - userId must be passed as a string argument
- All document IDs crossing the component boundary are strings, not `Id<"table">`

---

## Installation

```bash
npm install @crowdevelopment/convex-plaid
```

## Setup

### 1. Register the Component

```typescript
// convex/convex.config.ts
import { defineApp } from "convex/server";
import plaid from "@crowdevelopment/convex-plaid/convex.config";

const app = defineApp();
app.use(plaid);

export default app;
```

### 2. Generate Encryption Key

Access tokens are encrypted using JWE (A256GCM) before storage:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. Configure Environment Variables

Add to your Convex dashboard (Settings > Environment Variables):

| Variable | Description |
|----------|-------------|
| `PLAID_CLIENT_ID` | From Plaid Dashboard > Keys |
| `PLAID_SECRET` | From Plaid Dashboard > Keys (use sandbox/development/production) |
| `PLAID_ENV` | `sandbox`, `development`, or `production` |
| `ENCRYPTION_KEY` | Base64-encoded 256-bit key (from step 2) |

---

## Integration

### Create Wrapper Actions

The component requires explicit config since it can't access `process.env`:

```typescript
// convex/plaid.ts
import { action, query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Plaid } from "@crowdevelopment/convex-plaid";
import { components } from "./_generated/api";

// Initialize client with config
const plaid = new Plaid(components.plaid, {
  PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID!,
  PLAID_SECRET: process.env.PLAID_SECRET!,
  PLAID_ENV: process.env.PLAID_ENV!,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
});

// === LINK FLOW ===

export const createLinkToken = action({
  args: { userId: v.string(), products: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    return await plaid.createLinkToken(ctx, {
      userId: args.userId,
      products: args.products,
      // webhookUrl: "https://your-app.convex.site/plaid/webhook",
    });
  },
});

export const exchangePublicToken = action({
  args: { publicToken: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    return await plaid.exchangePublicToken(ctx, args);
  },
});

// === SYNC OPERATIONS ===

export const onboardItem = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    return await plaid.onboardItem(ctx, args);
  },
});

export const syncTransactions = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    return await plaid.syncTransactions(ctx, args);
  },
});

export const fetchLiabilities = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    return await plaid.fetchLiabilities(ctx, args);
  },
});

export const fetchRecurringStreams = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    return await plaid.fetchRecurringStreams(ctx, args);
  },
});

// === RE-AUTH FLOW ===

export const createUpdateLinkToken = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    return await plaid.createUpdateLinkToken(ctx, args);
  },
});

export const completeReauth = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    return await plaid.completeReauth(ctx, args);
  },
});

// === QUERIES (re-export from component) ===

export const getItemsByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(plaid.api.getItemsByUser, args);
  },
});

export const getAccountsByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(plaid.api.getAccountsByUser, args);
  },
});

export const getTransactionsByUser = query({
  args: {
    userId: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(plaid.api.getTransactionsByUser, args);
  },
});

export const getLiabilitiesByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(plaid.api.getLiabilitiesByUser, args);
  },
});

export const getActiveSubscriptions = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(plaid.api.getActiveSubscriptions, args);
  },
});

export const getRecurringIncome = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(plaid.api.getRecurringIncome, args);
  },
});

export const getSubscriptionsSummary = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(plaid.api.getSubscriptionsSummary, args);
  },
});

// === MUTATIONS ===

export const deletePlaidItem = mutation({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runMutation(plaid.api.deletePlaidItem, args);
  },
});
```

---

## Client API Reference

### `Plaid` Class

```typescript
import { Plaid } from "@crowdevelopment/convex-plaid";

const plaid = new Plaid(components.plaid, {
  PLAID_CLIENT_ID: string,
  PLAID_SECRET: string,
  PLAID_ENV: "sandbox" | "development" | "production",
  ENCRYPTION_KEY: string,  // Base64-encoded 256-bit key
});
```

### Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `createLinkToken(ctx, { userId, products?, webhookUrl? })` | Create Plaid Link token | `{ linkToken }` |
| `exchangePublicToken(ctx, { publicToken, userId })` | Exchange public token, create plaidItem | `{ success, itemId, plaidItemId }` |
| `fetchAccounts(ctx, { plaidItemId })` | Fetch/store accounts | `{ accountCount }` |
| `syncTransactions(ctx, { plaidItemId, maxPages?, maxTransactions? })` | Sync transactions with pagination | `{ added, modified, removed, cursor, hasMore, pagesProcessed }` |
| `fetchLiabilities(ctx, { plaidItemId })` | Fetch credit card liabilities | `{ creditCards }` |
| `fetchRecurringStreams(ctx, { plaidItemId })` | Detect subscriptions/income | `{ inflows, outflows }` |
| `createUpdateLinkToken(ctx, { plaidItemId })` | Create re-auth link token | `{ linkToken }` |
| `completeReauth(ctx, { plaidItemId })` | Complete re-auth flow | `{ success }` |
| `onboardItem(ctx, { plaidItemId })` | Run all sync operations | `{ accounts, transactions, liabilities, recurringStreams?, errors? }` |
| `api` | Access public queries/mutations | Component API |

### Transaction Sync Pagination

The `syncTransactions` method supports pagination to handle large transaction histories:

```typescript
const result = await plaid.syncTransactions(ctx, {
  plaidItemId: "...",
  maxPages: 10,        // Max pages per call (default: 10)
  maxTransactions: 5000, // Max transactions before stopping (default: 5000)
});

if (result.hasMore) {
  // Schedule another sync to continue
  await ctx.scheduler.runAfter(0, api.plaid.syncTransactions, { plaidItemId });
}
```

### Config Validation

The `Plaid` constructor validates configuration at initialization:

- All required fields must be non-empty strings
- `PLAID_ENV` must be `sandbox`, `development`, or `production`
- `ENCRYPTION_KEY` must be valid base64 encoding 32 bytes (256 bits)

Invalid config throws `PlaidConfigError` with a descriptive message.

---

## Public Queries

Access via `plaid.api.*` in query/mutation handlers:

| Query | Args | Description |
|-------|------|-------------|
| `getItemsByUser` | `{ userId }` | All plaidItems for user (excludes accessToken) |
| `getItem` | `{ plaidItemId }` | Single plaidItem by ID |
| `getAccountsByUser` | `{ userId }` | All accounts for user |
| `getAccountsByItem` | `{ plaidItemId }` | Accounts for specific item |
| `getTransactionsByUser` | `{ userId, startDate?, endDate?, limit? }` | Transactions with date filtering |
| `getTransactionsByAccount` | `{ accountId, limit? }` | Transactions for account |
| `getLiabilitiesByUser` | `{ userId }` | All credit card liabilities |
| `getLiabilitiesByItem` | `{ plaidItemId }` | Liabilities for specific item |
| `getRecurringStreamsByUser` | `{ userId }` | All recurring streams |
| `getRecurringStreamsByItem` | `{ plaidItemId }` | Streams for specific item |
| `getActiveSubscriptions` | `{ userId }` | MATURE + outflow + isActive streams |
| `getRecurringIncome` | `{ userId }` | MATURE + inflow + isActive streams |
| `getSubscriptionsSummary` | `{ userId }` | Count, monthlyTotal, frequency breakdown |

### Public Mutations

| Mutation | Args | Description |
|----------|------|-------------|
| `deletePlaidItem` | `{ plaidItemId }` | Delete item + cascade to accounts, transactions, etc. |

---

## React Hooks

```typescript
import { usePlaidLink, useUpdatePlaidLink } from "@crowdevelopment/convex-plaid/react";
```

### `usePlaidLink`

Main hook for connecting new bank accounts:

```tsx
import { usePlaidLink } from "@crowdevelopment/convex-plaid/react";
import { api } from "../convex/_generated/api";

function ConnectBank({ userId }: { userId: string }) {
  const { open, ready, isLoading, isExchanging, error } = usePlaidLink({
    createLinkToken: api.plaid.createLinkToken,
    exchangePublicToken: api.plaid.exchangePublicToken,
    userId,
    products: ["transactions", "liabilities"],
    onSuccess: (plaidItemId, metadata) => {
      console.log("Connected:", plaidItemId);
      // Trigger onboardItem to sync data
    },
    onExit: () => console.log("User exited"),
    onError: (error) => console.error(error),
  });

  return (
    <button onClick={open} disabled={!ready || isLoading}>
      {isLoading ? "Loading..." : isExchanging ? "Connecting..." : "Connect Bank"}
    </button>
  );
}
```

### `useUpdatePlaidLink`

Hook for re-authenticating when credentials expire:

```tsx
import { useUpdatePlaidLink } from "@crowdevelopment/convex-plaid/react";

function ReauthBank({ plaidItemId }: { plaidItemId: string }) {
  const { open, ready, refreshToken } = useUpdatePlaidLink({
    createUpdateLinkToken: api.plaid.createUpdateLinkToken,
    completeReauth: api.plaid.completeReauth,
    plaidItemId,
    autoFetchToken: false,  // Manual trigger for re-auth
    onSuccess: () => console.log("Re-authenticated!"),
  });

  const handleReauth = async () => {
    await refreshToken();  // Fetch update link token
    open();                // Open Plaid Link in update mode
  };

  return <button onClick={handleReauth}>Re-authenticate</button>;
}
```

### Hook Options

```typescript
interface UsePlaidLinkOptions {
  createLinkToken: FunctionReference;    // Your wrapped action
  exchangePublicToken: FunctionReference;
  userId: string;
  products?: string[];                   // Default: ["transactions", "liabilities"]
  webhookUrl?: string;
  onSuccess?: (plaidItemId: string, metadata: any) => void;
  onExit?: () => void;
  onError?: (error: Error) => void;
  autoFetchToken?: boolean;              // Default: true
}

interface UsePlaidLinkResult {
  open: () => void;        // Open Plaid Link modal
  ready: boolean;          // Link is ready to open
  isLoading: boolean;      // Fetching link token
  isExchanging: boolean;   // Exchanging public token
  error: Error | null;
  linkToken: string | null;
  refreshToken: () => Promise<void>;
}
```

---

## Webhooks

### Setup

```typescript
// convex/http.ts
import { httpRouter } from "convex/server";
import { registerRoutes } from "@crowdevelopment/convex-plaid";
import { components } from "./_generated/api";

const http = httpRouter();

registerRoutes(http, components.plaid, {
  webhookPath: "/plaid/webhook",
  plaidConfig: {
    PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID!,
    PLAID_SECRET: process.env.PLAID_SECRET!,
    PLAID_ENV: process.env.PLAID_ENV!,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
  },
  // Optional: custom handler runs after default processing
  onWebhook: async (ctx, webhookType, webhookCode, itemId, payload) => {
    console.log("Custom handler:", webhookType, webhookCode);
  },
});

export default http;
```

### Webhook URL

Configure in Plaid Dashboard or pass to `createLinkToken`:

```
https://your-project.convex.site/plaid/webhook
```

### Handled Webhooks

| Type | Code | Action |
|------|------|--------|
| `TRANSACTIONS` | `SYNC_UPDATES_AVAILABLE` | Auto-triggers `syncTransactions` |
| `ITEM` | `ERROR` | Updates item status to `error` |
| `ITEM` | `PENDING_EXPIRATION` | Marks item as `needs_reauth` |
| `ITEM` | `USER_PERMISSION_REVOKED` | Deactivates item |
| `LIABILITIES` | `DEFAULT_UPDATE` | Auto-triggers `fetchLiabilities` |

### JWT Verification

Webhooks are verified using Plaid's ES256 JWT signature when `plaidConfig` is provided. The component:

1. Fetches Plaid's public key from their JWKS endpoint (cached 24 hours)
2. Verifies the JWT signature (with automatic retry on key rotation)
3. Validates the request body hash matches
4. Checks timestamp is within 5 minutes
5. Deduplicates webhooks using body hash (24-hour window)

---

## Cron Jobs (Scheduled Tasks)

The component provides internal mutations for scheduled maintenance. Set up crons in your host app:

```typescript
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { components } from "./_generated/api";

const crons = cronJobs();

// Sync all active items daily at 2 AM UTC
crons.daily(
  "daily-plaid-sync",
  { hourUTC: 2, minuteUTC: 0 },
  internal.plaidSync.syncAllItems
);

// Prune old webhook logs hourly (keeps table size manageable)
crons.hourly(
  "prune-webhook-logs",
  { minuteUTC: 0 },
  components.plaid.private.pruneOldWebhookLogs
);

export default crons;
```

```typescript
// convex/plaidSync.ts
import { internalAction } from "./_generated/server";
import { components } from "./_generated/api";

export const syncAllItems = internalAction({
  handler: async (ctx) => {
    // Get all active items from your users table
    // For each item, call the sync actions
    const items = await ctx.runQuery(components.plaid.public.getItemsByUser, {
      userId: "..."
    });

    for (const item of items) {
      if (item.status === "active") {
        await ctx.runAction(api.plaid.syncTransactions, {
          plaidItemId: item._id
        });
      }
    }
  },
});
```

### Webhook Log Cleanup

The `pruneOldWebhookLogs` mutation deletes webhook logs older than 24 hours:

```typescript
// Called automatically by cron, or manually:
await ctx.runMutation(components.plaid.private.pruneOldWebhookLogs, {
  retentionMs: 24 * 60 * 60 * 1000, // Optional: default 24 hours
  batchSize: 100,                    // Optional: default 100 per call
});
// Returns: { deleted: number, hasMore: boolean }
```

---

## Data Model

### Tables

All monetary values stored as **MILLIUNITS** (amount × 1000) to avoid float precision errors.

#### `plaidItems`

Connection metadata for each linked bank/institution.

| Field | Type | Description |
|-------|------|-------------|
| `userId` | `string` | Host app user ID |
| `itemId` | `string` | Plaid item_id |
| `accessToken` | `string` | JWE encrypted access token |
| `cursor` | `string?` | Transaction sync cursor |
| `institutionId` | `string?` | Bank identifier |
| `institutionName` | `string?` | "Chase", "Wells Fargo" |
| `status` | `enum` | `pending`, `syncing`, `active`, `error`, `needs_reauth` |
| `syncError` | `string?` | Error message from last sync |
| `syncVersion` | `number?` | Optimistic lock version (prevents race conditions) |
| `syncStartedAt` | `number?` | When current sync started (for timeout detection) |
| `createdAt` | `number` | Unix timestamp |
| `lastSyncedAt` | `number?` | Last successful sync |

#### `plaidAccounts`

Bank/credit accounts from Plaid API.

| Field | Type | Description |
|-------|------|-------------|
| `userId` | `string` | Host app user ID |
| `plaidItemId` | `string` | Reference to plaidItem |
| `accountId` | `string` | Plaid account_id |
| `name` | `string` | "Chase Freedom Unlimited" |
| `type` | `string` | `credit`, `depository`, `loan` |
| `subtype` | `string?` | `credit card`, `checking`, `savings` |
| `mask` | `string?` | Last 4 digits: "1234" |
| `balances.available` | `number?` | MILLIUNITS |
| `balances.current` | `number?` | MILLIUNITS |
| `balances.limit` | `number?` | Credit limit (MILLIUNITS) |

#### `plaidTransactions`

Transaction history with categories.

| Field | Type | Description |
|-------|------|-------------|
| `transactionId` | `string` | Plaid transaction_id |
| `accountId` | `string` | Plaid account_id |
| `amount` | `number` | MILLIUNITS |
| `date` | `string` | ISO date: "2025-01-15" |
| `name` | `string` | Raw transaction name |
| `merchantName` | `string?` | Cleaned merchant name |
| `pending` | `boolean` | Pending transaction |
| `categoryPrimary` | `string?` | "FOOD_AND_DRINK" |
| `categoryDetailed` | `string?` | "FOOD_AND_DRINK_COFFEE" |

#### `plaidCreditCardLiabilities`

Credit card APRs, payments, due dates.

| Field | Type | Description |
|-------|------|-------------|
| `accountId` | `string` | Plaid account_id |
| `aprs` | `array` | APR entries (purchase, cash, balance transfer) |
| `isOverdue` | `boolean` | Payment overdue |
| `minimumPaymentAmount` | `number?` | MILLIUNITS |
| `nextPaymentDueDate` | `string?` | ISO date |
| `lastStatementBalance` | `number?` | MILLIUNITS |

#### `plaidRecurringStreams`

Detected subscriptions, bills, income.

| Field | Type | Description |
|-------|------|-------------|
| `streamId` | `string` | Plaid stream_id |
| `description` | `string` | Stream name |
| `merchantName` | `string?` | Cleaned merchant |
| `averageAmount` | `number` | MILLIUNITS |
| `frequency` | `string` | `WEEKLY`, `BIWEEKLY`, `MONTHLY`, `ANNUALLY` |
| `status` | `enum` | `MATURE`, `EARLY_DETECTION`, `TOMBSTONED` |
| `type` | `enum` | `inflow` (income) or `outflow` (expense) |
| `isActive` | `boolean` | Currently active |
| `predictedNextDate` | `string?` | Next expected date |

---

## Security

### Access Token Encryption

- Access tokens are encrypted using **JWE (A256GCM)** before storage
- Encryption key is a 256-bit key, base64-encoded
- Tokens are decrypted only when making Plaid API calls
- Token format is validated before decryption (throws `TokenDecryptionError` on invalid format)
- Access tokens are **never** returned in query results

### Config Validation

- All config fields validated at `Plaid` class construction
- Invalid config throws `PlaidConfigError` immediately (fail-fast)
- Validates encryption key is proper base64 and correct length (32 bytes)

### Webhook Verification

- All webhooks verified using Plaid's ES256 JWT signature
- Body hash validation prevents tampering
- 5-minute timestamp window prevents replay attacks
- 24-hour deduplication window prevents duplicate processing
- Automatic key cache invalidation and retry on Plaid key rotation
- Failed verification returns 401

### Component Isolation

- Component has its own database tables
- Host app cannot directly modify component tables
- All access through public queries/mutations/actions

### Concurrency Protection

- Optimistic locking prevents transaction sync race conditions
- TOCTOU-safe upsert patterns with duplicate detection and cleanup
- Sync lock timeout detection (stale locks auto-expire after 5 minutes)

---

## Error Handling

### Item Status

| Status | Meaning | Action |
|--------|---------|--------|
| `pending` | Just created | Call `onboardItem` |
| `syncing` | Sync in progress | Wait |
| `active` | Ready to use | Normal operation |
| `error` | Sync failed | Check `syncError`, retry |
| `needs_reauth` | Credentials expired | Open Update Link |

### Re-auth Flow

When item status is `needs_reauth`:

1. Call `createUpdateLinkToken({ plaidItemId })`
2. Open Plaid Link with returned token (update mode)
3. User re-authenticates with their bank
4. Call `completeReauth({ plaidItemId })`
5. Item status returns to `active`

---

## Typical Integration Flow

1. **User clicks "Connect Bank"**
   - Call `createLinkToken` with userId
   - Open Plaid Link with returned token

2. **User completes Plaid Link**
   - `onSuccess` callback receives `publicToken`
   - Call `exchangePublicToken` - returns `plaidItemId`

3. **Initial data sync**
   - Call `onboardItem({ plaidItemId })`
   - Fetches accounts, transactions, liabilities, recurring streams

4. **Ongoing sync**
   - Webhooks auto-trigger on `SYNC_UPDATES_AVAILABLE`
   - Or call `syncTransactions` manually

5. **Re-auth when needed**
   - Check for `status === "needs_reauth"`
   - Use `useUpdatePlaidLink` hook

---

## Files Reference

| Path | Description |
|------|-------------|
| `src/client/index.ts` | `Plaid` class, `registerRoutes()` |
| `src/client/types.ts` | TypeScript interfaces |
| `src/react/index.ts` | React hooks |
| `src/component/schema.ts` | Database tables |
| `src/component/actions.ts` | Plaid API actions |
| `src/component/public.ts` | Public queries/mutations |
| `src/component/private.ts` | Internal mutations |
| `src/component/webhooks.ts` | JWT verification |
| `src/component/crons.ts` | Scheduled sync actions |
| `src/component/rateLimiter.ts` | Backoff/retry logic |
| `src/component/encryption.ts` | JWE encrypt/decrypt |
| `src/component/utils.ts` | Plaid client init, transforms |
| `src/component/errors.ts` | Error categorization |

---

## Publishing to npm

This package is published at [`@crowdevelopment/convex-plaid`](https://www.npmjs.com/package/@crowdevelopment/convex-plaid).

### Release Process

1. Update version: `npm version patch|minor|major`
2. Push with tags: `git push && git push --tags`
3. Create a GitHub release → triggers automatic publish via GitHub Actions

The workflow (`.github/workflows/publish.yml`) runs: test → typecheck → build → publish.

---

## TODO: Future Plaid Products

The component architecture supports adding new Plaid products. Products are already configurable (not hardcoded) - users can pass any product array to `createLinkToken`, and it's stored per-item in the database.

### Currently Supported Products

| Product | Method | Status |
|---------|--------|--------|
| `transactions` | `syncTransactions()` | ✅ Implemented |
| `liabilities` | `fetchLiabilities()` | ✅ Implemented |
| `auth` | via `fetchAccounts()` | ✅ Implicit |
| Recurring | `fetchRecurringStreams()` | ✅ Implemented (no product flag needed) |

### Products NOT Yet Implemented

| Product | Priority | Notes |
|---------|----------|-------|
| `identity` | Low | KYC/verification use cases |
| `assets` | Medium | Wealth management, loan underwriting |
| `investments` | Medium | Brokerage accounts, holdings, securities |
| `income` | Low | Income verification (different API flow) |
| `transfer` | Low | ACH transfers (requires separate Plaid setup) |
| `signal` | Low | ACH return risk scoring |

### How to Add a New Product (e.g., Investments)

1. **No changes to Link** - already accepts any product string via `products` arg

2. **Add schema table** in `src/component/schema.ts`:
   ```typescript
   plaidInvestmentHoldings: defineTable({
     plaidItemId: v.string(),
     accountId: v.string(),
     securityId: v.string(),
     quantity: v.number(),
     costBasis: v.optional(v.number()), // MILLIUNITS
     // ... other fields from Plaid API
   }).index("by_plaidItemId", ["plaidItemId"]),
   ```

3. **Add private mutation** in `src/component/private.ts`:
   ```typescript
   export const upsertInvestmentHolding = internalMutation({ ... })
   ```

4. **Add action** in `src/component/actions.ts`:
   ```typescript
   export const fetchInvestments = action({
     args: { plaidItemId: v.string(), ...plaidConfigArgs },
     handler: async (ctx, args) => {
       const plaidClient = initPlaidClient(...);
       const response = await plaidClient.investmentsHoldingsGet({ access_token });
       // Transform and store holdings
     },
   });
   ```

5. **Add client method** in `src/client/index.ts`:
   ```typescript
   async fetchInvestments(ctx: ActionCtx, args: { plaidItemId: string }) {
     return await ctx.runAction(this.component.actions.fetchInvestments, {
       plaidItemId: args.plaidItemId,
       ...this.config,
     });
   }
   ```

6. **Add public query** in `src/component/public.ts`:
   ```typescript
   export const getInvestmentsByUser = query({ ... })
   ```

7. **Update `onboardItem`** to optionally fetch investments based on stored products

---

## Known Issues & Notes

### Transaction Enrichment in Sandbox Mode

**Status:** Partially working (Jan 2026)

The `enrichTransactions` action is now functional, but **Plaid Sandbox only enriches specific test transactions**. When testing:

- Transactions with names like "Uber", "Target", "Starbucks", "McDonald's" will enrich successfully
- Real/custom transaction names return empty enrichment data (counted as "failed")
- This is a **Plaid sandbox limitation**, not a bug in this component

**Test Results (Sandbox):**
- 50 transactions sent → 50 failed = Expected behavior for real transaction names
- The API call succeeds, but Plaid returns no counterparty data for unrecognized merchants

**To verify enrichment is working:**
1. Create sandbox transactions with known merchant names (Uber, Starbucks, etc.)
2. Or switch to Plaid Development/Production environment

**Fixes applied (Jan 2026):**
1. Added required `direction` field (INFLOW/OUTFLOW) to enrichTransactions API
2. Fixed `formatErrorForLog` to handle raw errors without crashing
3. Public queries now return `enrichmentData` and `merchantId` fields

**Next steps for production:**
- Test with Plaid Development environment (real merchant data)
- Consider adding enrichment step to `onboardNewConnectionAction`
- Add retry logic for failed enrichments
