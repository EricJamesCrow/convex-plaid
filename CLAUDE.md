# @ericjamescrow/convex-plaid

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

## Architecture

This is a **Convex Component** - an isolated module with its own schema and functions that integrates into a host Convex app.

```
Host App (your convex/ folder)
├── convex.config.ts      # Registers the component
├── plaid.ts              # Wrapper actions using Plaid client
├── http.ts               # Webhook route registration
└── _generated/api.js     # Includes components.plaid

Component (node_modules/@ericjamescrow/convex-plaid)
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
npm install @ericjamescrow/convex-plaid
```

## Setup

### 1. Register the Component

```typescript
// convex/convex.config.ts
import { defineApp } from "convex/server";
import plaid from "@ericjamescrow/convex-plaid/convex.config";

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
import { Plaid } from "@ericjamescrow/convex-plaid";
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
import { Plaid } from "@ericjamescrow/convex-plaid";

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
import { usePlaidLink, useUpdatePlaidLink } from "@ericjamescrow/convex-plaid/react";
```

### `usePlaidLink`

Main hook for connecting new bank accounts:

```tsx
import { usePlaidLink } from "@ericjamescrow/convex-plaid/react";
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
import { useUpdatePlaidLink } from "@ericjamescrow/convex-plaid/react";

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
import { registerRoutes } from "@ericjamescrow/convex-plaid";
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
