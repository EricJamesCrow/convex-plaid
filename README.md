# @crowdevelopment/convex-plaid

A Convex component for integrating Plaid banking into your application.

[![npm version](https://badge.fury.io/js/@crowdevelopment%2Fconvex-plaid.svg)](https://badge.fury.io/js/@crowdevelopment%2Fconvex-plaid)

## Features

- 🔗 **Plaid Link** - Create link tokens and exchange public tokens for access
- 🏦 **Accounts** - Fetch and store bank/credit accounts with real-time balances
- 💸 **Transactions** - Cursor-based incremental sync with merchant and category data
- 💳 **Liabilities** - Credit card APRs, payment due dates, statement balances
- 🔄 **Recurring Streams** - Automatic subscription and income detection
- 🔔 **Webhook Handling** - JWT signature verification and auto-sync triggers
- 🔐 **Re-auth Flow** - Update Link mode for expired credentials
- ⚛️ **React Hooks** - `usePlaidLink` and `useUpdatePlaidLink` for seamless integration
- 🔒 **Encryption** - Access tokens encrypted with JWE (A256GCM) before storage

## Quick Start

### 1. Install the Component

```bash
npm install @crowdevelopment/convex-plaid
```

### 2. Add to Your Convex App

Create or update `convex/convex.config.ts`:

```typescript
import { defineApp } from "convex/server";
import plaid from "@crowdevelopment/convex-plaid/convex.config";

const app = defineApp();
app.use(plaid);

export default app;
```

### 3. Set Up Environment Variables

Add these to your [Convex Dashboard](https://dashboard.convex.dev) → Settings → Environment Variables:

| Variable | Description |
| -------- | ----------- |
| `PLAID_CLIENT_ID` | Your Plaid client ID from [Plaid Dashboard](https://dashboard.plaid.com) → Keys |
| `PLAID_SECRET` | Your Plaid secret key (sandbox/development/production) |
| `PLAID_ENV` | `sandbox`, `development`, or `production` |
| `ENCRYPTION_KEY` | Base64-encoded 256-bit key (see below) |

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 4. Configure Plaid Webhooks

1. Go to [Plaid Dashboard → Developers → Webhooks](https://dashboard.plaid.com/developers/webhooks)
2. Click **"Add webhook"**
3. Enter your webhook URL:
   ```
   https://<your-convex-deployment>.convex.site/plaid/webhook
   ```
   (Find your deployment name in the Convex dashboard)
4. Webhooks are registered per-item when calling `createLinkToken`

### 5. Register Webhook Routes

Create `convex/http.ts`:

```typescript
import { httpRouter } from "convex/server";
import { components } from "./_generated/api";
import { registerRoutes } from "@crowdevelopment/convex-plaid";

const http = httpRouter();

// Register Plaid webhook handler at /plaid/webhook
registerRoutes(http, components.plaid, {
  webhookPath: "/plaid/webhook",
  plaidConfig: {
    PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID!,
    PLAID_SECRET: process.env.PLAID_SECRET!,
    PLAID_ENV: process.env.PLAID_ENV!,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
  },
});

export default http;
```

### 6. Use the Component

Create `convex/plaid.ts`:

```typescript
import { action, query } from "./_generated/server";
import { components } from "./_generated/api";
import { Plaid } from "@crowdevelopment/convex-plaid";
import { v } from "convex/values";

const plaidClient = new Plaid(components.plaid, {
  PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID!,
  PLAID_SECRET: process.env.PLAID_SECRET!,
  PLAID_ENV: process.env.PLAID_ENV!,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
});

// Create a link token for Plaid Link
export const createLinkToken = action({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await plaidClient.createLinkToken(ctx, {
      userId: args.userId,
      products: ["transactions", "liabilities"],
    });
  },
});

// Exchange public token after user completes Plaid Link
export const exchangePublicToken = action({
  args: { publicToken: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    return await plaidClient.exchangePublicToken(ctx, args);
  },
});

// Sync all data for a newly connected item
export const onboardItem = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    return await plaidClient.onboardItem(ctx, args);
  },
});

// Query accounts for a user
export const getAccountsByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(plaidClient.api.getAccountsByUser, args);
  },
});
```

## Security

### Why You Need Wrapper Functions

Convex components are **architecturally isolated** from your app's authentication context - they cannot access `ctx.auth`. This is by design for portability and testability, but it means **you must enforce security in your wrapper functions**.

### The Problem

```typescript
// ❌ INSECURE - Never do this
export const getItemsByUser = query({
  args: { userId: v.string() },  // Client can pass ANY userId!
  handler: async (ctx, args) => {
    return await ctx.runQuery(plaidClient.api.getItemsByUser, args);
  },
});
```

### The Solution

```typescript
// ✅ SECURE - Always derive userId from auth
import { requireAuth } from "@crowdevelopment/convex-plaid/helpers";

export const getMyItems = query({
  args: {},  // No userId argument
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);  // Get from auth
    return await ctx.runQuery(plaidClient.api.getItemsByUser, { userId });
  },
});
```

### Security Helpers

The component provides helper functions to simplify secure implementations:

| Helper | Purpose |
| ------ | ------- |
| `requireAuth(ctx)` | Extract userId from auth, throw if not logged in |
| `requireOwnership(ctx, userId)` | Verify user owns a resource |
| `requireItemOwnership(ctx, plaidItemId, api)` | Verify user owns a Plaid item |
| `requireAccountOwnership(ctx, accountId, api)` | Verify user owns a Plaid account |

Example with item ownership:

```typescript
import { requireItemOwnership } from "@crowdevelopment/convex-plaid/helpers";

export const syncMyItem = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    // Throws if not authenticated or doesn't own the item
    const item = await requireItemOwnership(ctx, args.plaidItemId, plaidClient.api);

    // Safe to proceed
    return await plaidClient.syncTransactions(ctx, { plaidItemId: args.plaidItemId });
  },
});
```

### API Security Classification

| Query/Mutation | Security Requirement |
| -------------- | -------------------- |
| `getItemsByUser`, `getAccountsByUser`, `getTransactionsByUser` | Use `requireAuth` - scopes by userId |
| `getItem`, `deletePlaidItem` | Use `requireItemOwnership` - verify ownership |
| `getTransactionsByAccount` | Use `requireAccountOwnership` - verify ownership |
| `syncTransactions`, `fetchLiabilities` | Use `requireItemOwnership` - verify ownership |

See [`CLAUDE.md`](./CLAUDE.md) for comprehensive security patterns and examples.

## API Reference

### Plaid Client

```typescript
import { Plaid } from "@crowdevelopment/convex-plaid";

const plaidClient = new Plaid(components.plaid, {
  PLAID_CLIENT_ID: "...",      // From Plaid Dashboard
  PLAID_SECRET: "...",         // From Plaid Dashboard
  PLAID_ENV: "sandbox",        // "sandbox" | "development" | "production"
  ENCRYPTION_KEY: "...",       // Base64-encoded 256-bit key
});
```

#### Methods

| Method | Description |
| ------ | ----------- |
| `createLinkToken()` | Create a Plaid Link token |
| `exchangePublicToken()` | Exchange public token, create item |
| `fetchAccounts()` | Fetch and store accounts |
| `syncTransactions()` | Incremental transaction sync |
| `fetchLiabilities()` | Fetch credit card liabilities |
| `fetchRecurringStreams()` | Detect subscriptions/income |
| `createUpdateLinkToken()` | Create re-auth link token |
| `completeReauth()` | Complete re-auth flow |
| `onboardItem()` | Run all sync operations |

### createLinkToken

```typescript
await plaidClient.createLinkToken(ctx, {
  userId: "user_123",              // Required: your user identifier
  products: ["transactions"],       // Optional: Plaid products
  webhookUrl: "https://...",       // Optional: webhook URL
});
```

### syncTransactions

```typescript
const result = await plaidClient.syncTransactions(ctx, {
  plaidItemId: "...",
  maxPages: 10,        // Optional: max pages per call (default: 10)
  maxTransactions: 5000, // Optional: max transactions (default: 5000)
});

if (result.hasMore) {
  // Schedule another sync to continue
}
```

### Component Queries

Access data directly via the component's public queries:

```typescript
import { query } from "./_generated/server";
import { components } from "./_generated/api";
import { Plaid } from "@crowdevelopment/convex-plaid";

const plaidClient = new Plaid(components.plaid, { /* config */ });

// List accounts for a user
export const getUserAccounts = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(plaidClient.api.getAccountsByUser, args);
  },
});

// List transactions for a user
export const getUserTransactions = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(plaidClient.api.getTransactionsByUser, args);
  },
});
```

### Available Public Queries

| Query | Arguments | Description |
| ----- | --------- | ----------- |
| `getItemsByUser` | `userId` | All linked items for a user |
| `getItem` | `plaidItemId` | Single item by ID |
| `getAccountsByUser` | `userId` | All accounts for a user |
| `getAccountsByItem` | `plaidItemId` | Accounts for a specific item |
| `getTransactionsByUser` | `userId, startDate?, endDate?, limit?` | Transactions with filtering |
| `getTransactionsByAccount` | `accountId, limit?` | Transactions for an account |
| `getLiabilitiesByUser` | `userId` | All credit card liabilities |
| `getLiabilitiesByItem` | `plaidItemId` | Liabilities for a specific item |
| `getRecurringStreamsByUser` | `userId` | All recurring streams |
| `getRecurringStreamsByItem` | `plaidItemId` | Streams for a specific item |
| `getActiveSubscriptions` | `userId` | Active subscription streams |
| `getRecurringIncome` | `userId` | Active income streams |
| `getSubscriptionsSummary` | `userId` | Count, monthly total, breakdown |

### Available Public Mutations

| Mutation | Arguments | Description |
| -------- | --------- | ----------- |
| `deletePlaidItem` | `plaidItemId` | Delete item and all associated data |

## React Hooks

### usePlaidLink

Main hook for connecting new bank accounts:

```tsx
import { usePlaidLink } from "@crowdevelopment/convex-plaid/react";
import { api } from "../convex/_generated/api";
import { useAction } from "convex/react";

function ConnectBank({ userId }: { userId: string }) {
  const onboardItem = useAction(api.plaid.onboardItem);

  const { open, ready, isLoading, isExchanging } = usePlaidLink({
    createLinkToken: api.plaid.createLinkToken,
    exchangePublicToken: api.plaid.exchangePublicToken,
    userId,
    products: ["transactions", "liabilities"],
    onSuccess: async (plaidItemId) => {
      await onboardItem({ plaidItemId });
    },
  });

  return (
    <button onClick={open} disabled={!ready || isLoading}>
      {isLoading ? "Loading..." : isExchanging ? "Connecting..." : "Connect Bank"}
    </button>
  );
}
```

### useUpdatePlaidLink

Hook for re-authentication when credentials expire:

```tsx
import { useUpdatePlaidLink } from "@crowdevelopment/convex-plaid/react";

function ReauthBank({ plaidItemId }: { plaidItemId: string }) {
  const { open, ready, refreshToken } = useUpdatePlaidLink({
    createUpdateLinkToken: api.plaid.createUpdateLinkToken,
    completeReauth: api.plaid.completeReauth,
    plaidItemId,
    onSuccess: () => console.log("Re-authenticated!"),
  });

  const handleReauth = async () => {
    await refreshToken();
    open();
  };

  return <button onClick={handleReauth}>Re-authenticate</button>;
}
```

## Webhook Events

The component automatically handles these Plaid webhook events:

| Event | Action |
| ----- | ------ |
| `TRANSACTIONS.SYNC_UPDATES_AVAILABLE` | Auto-triggers `syncTransactions` |
| `ITEM.ERROR` | Updates item status to `error` |
| `ITEM.PENDING_EXPIRATION` | Marks item as `needs_reauth` |
| `ITEM.USER_PERMISSION_REVOKED` | Deactivates item |
| `LIABILITIES.DEFAULT_UPDATE` | Auto-triggers `fetchLiabilities` |

### Custom Webhook Handlers

Add custom logic to webhook events:

```typescript
import { httpRouter } from "convex/server";
import { components } from "./_generated/api";
import { registerRoutes } from "@crowdevelopment/convex-plaid";

const http = httpRouter();

registerRoutes(http, components.plaid, {
  webhookPath: "/plaid/webhook",
  plaidConfig: { /* ... */ },
  onWebhook: async (ctx, webhookType, webhookCode, itemId, payload) => {
    // Called for ALL events - useful for logging/analytics
    console.log("Plaid webhook:", webhookType, webhookCode);
  },
});

export default http;
```

### JWT Verification

Webhooks are verified using Plaid's ES256 JWT signature:

- Fetches Plaid's public key from their JWKS endpoint
- Verifies the JWT signature
- Validates request body hash
- Checks timestamp is within 5 minutes
- Deduplicates webhooks (24-hour window)

## Database Schema

The component creates these tables in its namespace. All monetary values are stored as **MILLIUNITS** (amount × 1000) to avoid floating-point precision errors.

### plaidItems

| Field | Type | Description |
| ----- | ---- | ----------- |
| `userId` | string | Host app user ID |
| `itemId` | string | Plaid item_id |
| `accessToken` | string | JWE encrypted access token |
| `cursor` | string? | Transaction sync cursor |
| `institutionId` | string? | Bank identifier |
| `institutionName` | string? | "Chase", "Wells Fargo", etc. |
| `status` | string | `pending`, `syncing`, `active`, `error`, `needs_reauth` |
| `syncError` | string? | Error message from last sync |
| `createdAt` | number | Unix timestamp |
| `lastSyncedAt` | number? | Last successful sync timestamp |

### plaidAccounts

| Field | Type | Description |
| ----- | ---- | ----------- |
| `userId` | string | Host app user ID |
| `plaidItemId` | string | Reference to plaidItem |
| `accountId` | string | Plaid account_id |
| `name` | string | Account name |
| `type` | string | `credit`, `depository`, `loan` |
| `subtype` | string? | `credit card`, `checking`, `savings` |
| `mask` | string? | Last 4 digits |
| `balances.available` | number? | Available balance (milliunits) |
| `balances.current` | number? | Current balance (milliunits) |
| `balances.limit` | number? | Credit limit (milliunits) |

### plaidTransactions

| Field | Type | Description |
| ----- | ---- | ----------- |
| `transactionId` | string | Plaid transaction_id |
| `accountId` | string | Plaid account_id |
| `amount` | number | Amount in milliunits |
| `date` | string | ISO date (e.g., "2025-01-15") |
| `name` | string | Raw transaction name |
| `merchantName` | string? | Cleaned merchant name |
| `pending` | boolean | Is pending |
| `categoryPrimary` | string? | Primary category |
| `categoryDetailed` | string? | Detailed category |

### plaidCreditCardLiabilities

| Field | Type | Description |
| ----- | ---- | ----------- |
| `accountId` | string | Plaid account_id |
| `aprs` | array | APR entries |
| `isOverdue` | boolean | Payment overdue |
| `minimumPaymentAmount` | number? | Minimum payment (milliunits) |
| `nextPaymentDueDate` | string? | Next due date |
| `lastStatementBalance` | number? | Statement balance (milliunits) |

### plaidRecurringStreams

| Field | Type | Description |
| ----- | ---- | ----------- |
| `streamId` | string | Plaid stream_id |
| `description` | string | Stream name |
| `merchantName` | string? | Cleaned merchant |
| `averageAmount` | number | Average amount (milliunits) |
| `frequency` | string | `WEEKLY`, `BIWEEKLY`, `MONTHLY`, `ANNUALLY` |
| `status` | string | `MATURE`, `EARLY_DETECTION`, `TOMBSTONED` |
| `type` | string | `inflow` (income) or `outflow` (expense) |
| `isActive` | boolean | Currently active |
| `predictedNextDate` | string? | Next expected date |

## Example App

Check out the example setup in the [`example/`](./example) directory.

## Troubleshooting

### "Not authenticated" errors

The component doesn't use `ctx.auth`. Pass `userId` as a string argument to all methods.

### Empty data after connecting

1. Ensure you call `onboardItem` after `exchangePublicToken`
2. Check the item status - if `error`, check `syncError` field
3. Verify environment variables are set correctly

### Webhooks not working

1. Check webhook URL: `https://<deployment>.convex.site/plaid/webhook`
2. Verify `plaidConfig` is passed to `registerRoutes`
3. Check Convex logs for verification errors

### Re-auth required

When item status is `needs_reauth`:

1. Call `createUpdateLinkToken({ plaidItemId })`
2. Open Plaid Link in update mode
3. After user completes, call `completeReauth({ plaidItemId })`

## License

MIT
