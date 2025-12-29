# @ericjamescrow/convex-plaid

A Convex component for integrating Plaid into your application - bank connections, transactions, liabilities, and recurring payments.

[![npm version](https://badge.fury.io/js/@ericjamescrow%2Fconvex-plaid.svg)](https://badge.fury.io/js/@ericjamescrow%2Fconvex-plaid)

## Features

- **Plaid Link** - Create link tokens, exchange public tokens for access
- **Accounts** - Fetch and store bank/credit accounts with real-time balances
- **Transactions** - Cursor-based incremental sync with merchant and category data
- **Liabilities** - Credit card APRs, payment due dates, statement balances
- **Recurring Streams** - Automatic subscription and income detection
- **Webhooks** - JWT signature verification and auto-sync triggers
- **Re-auth Flow** - Update Link mode for expired credentials
- **React Hooks** - `usePlaidLink` and `useUpdatePlaidLink` for seamless integration
- **Encryption** - Access tokens encrypted with JWE (A256GCM) before storage

## Quick Start

### 1. Install the Component

```bash
npm install @ericjamescrow/convex-plaid
```

### 2. Initialize with CLI (Recommended)

The easiest way to get started is using the CLI:

```bash
npx @ericjamescrow/convex-plaid init
```

This interactive command will:
- Create `convex/convex.config.ts` (component registration)
- Create `convex/plaid.ts` (wrapper actions with auth)
- Create `convex/http.ts` (webhook routes)
- Generate a secure encryption key
- Create `.env.local.example` with placeholders

**Options:**
```bash
npx @ericjamescrow/convex-plaid init -y          # Skip prompts, use defaults
npx @ericjamescrow/convex-plaid init --auth custom  # Use custom auth (pass userId)
npx @ericjamescrow/convex-plaid init --no-env    # Skip .env.local.example
```

After running `init`, skip to [Step 4](#4-set-up-environment-variables) to configure your environment variables.

---

### Manual Setup

If you prefer manual setup, follow steps 2-5 below.

### 2. Register the Component

Create or update `convex/convex.config.ts`:

```typescript
import { defineApp } from "convex/server";
import plaid from "@ericjamescrow/convex-plaid/convex.config";

const app = defineApp();
app.use(plaid);

export default app;
```

### 3. Generate an Encryption Key

Access tokens are encrypted before storage. Generate a 256-bit key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 4. Set Up Environment Variables

Add to your [Convex Dashboard](https://dashboard.convex.dev) → Settings → Environment Variables:

| Variable | Description |
|----------|-------------|
| `PLAID_CLIENT_ID` | From [Plaid Dashboard](https://dashboard.plaid.com) → Keys |
| `PLAID_SECRET` | From Plaid Dashboard → Keys (sandbox/development/production) |
| `PLAID_ENV` | `sandbox`, `development`, or `production` |
| `ENCRYPTION_KEY` | Base64-encoded 256-bit key (from step 3) |

### 5. Create Wrapper Actions

Create `convex/plaid.ts`:

```typescript
import { action, query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Plaid } from "@ericjamescrow/convex-plaid";
import { components } from "./_generated/api";

const plaid = new Plaid(components.plaid, {
  PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID!,
  PLAID_SECRET: process.env.PLAID_SECRET!,
  PLAID_ENV: process.env.PLAID_ENV!,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
});

// Create a link token for Plaid Link
export const createLinkToken = action({
  args: { userId: v.string(), products: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    return await plaid.createLinkToken(ctx, {
      userId: args.userId,
      products: args.products,
    });
  },
});

// Exchange public token after user completes Plaid Link
export const exchangePublicToken = action({
  args: { publicToken: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    return await plaid.exchangePublicToken(ctx, args);
  },
});

// Sync all data for a newly connected item
export const onboardItem = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    return await plaid.onboardItem(ctx, args);
  },
});

// Sync transactions (incremental, cursor-based)
export const syncTransactions = action({
  args: { plaidItemId: v.string() },
  handler: async (ctx, args) => {
    return await plaid.syncTransactions(ctx, args);
  },
});

// Query accounts for a user
export const getAccountsByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(plaid.api.getAccountsByUser, args);
  },
});

// Query transactions for a user
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
```

### 6. Use React Hooks

```tsx
import { usePlaidLink } from "@ericjamescrow/convex-plaid/react";
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

## API Reference

### Plaid Client

```typescript
import { Plaid } from "@ericjamescrow/convex-plaid";

const plaid = new Plaid(components.plaid, {
  PLAID_CLIENT_ID: string,
  PLAID_SECRET: string,
  PLAID_ENV: "sandbox" | "development" | "production",
  ENCRYPTION_KEY: string,
});
```

### Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `createLinkToken(ctx, { userId, products?, webhookUrl? })` | Create Plaid Link token | `{ linkToken }` |
| `exchangePublicToken(ctx, { publicToken, userId })` | Exchange public token, create item | `{ success, itemId, plaidItemId }` |
| `fetchAccounts(ctx, { plaidItemId })` | Fetch and store accounts | `{ accountCount }` |
| `syncTransactions(ctx, { plaidItemId })` | Incremental transaction sync | `{ added, modified, removed, cursor }` |
| `fetchLiabilities(ctx, { plaidItemId })` | Fetch credit card liabilities | `{ creditCards }` |
| `fetchRecurringStreams(ctx, { plaidItemId })` | Detect subscriptions/income | `{ inflows, outflows }` |
| `createUpdateLinkToken(ctx, { plaidItemId })` | Create re-auth link token | `{ linkToken }` |
| `completeReauth(ctx, { plaidItemId })` | Complete re-auth flow | `{ success }` |
| `onboardItem(ctx, { plaidItemId })` | Run all sync operations | Combined results |

### Public Queries

Access via `plaid.api.*`:

| Query | Arguments | Description |
|-------|-----------|-------------|
| `getItemsByUser` | `{ userId }` | All linked items for a user |
| `getItem` | `{ plaidItemId }` | Single item by ID |
| `getAccountsByUser` | `{ userId }` | All accounts for a user |
| `getAccountsByItem` | `{ plaidItemId }` | Accounts for a specific item |
| `getTransactionsByUser` | `{ userId, startDate?, endDate?, limit? }` | Transactions with filtering |
| `getTransactionsByAccount` | `{ accountId, limit? }` | Transactions for an account |
| `getLiabilitiesByUser` | `{ userId }` | All credit card liabilities |
| `getRecurringStreamsByUser` | `{ userId }` | All recurring streams |
| `getActiveSubscriptions` | `{ userId }` | Active subscription streams |
| `getRecurringIncome` | `{ userId }` | Active income streams |
| `getSubscriptionsSummary` | `{ userId }` | Count, monthly total, breakdown |

### Public Mutations

| Mutation | Arguments | Description |
|----------|-----------|-------------|
| `deletePlaidItem` | `{ plaidItemId }` | Delete item and all associated data |

## React Hooks

### usePlaidLink

Main hook for connecting new bank accounts:

```typescript
const { open, ready, isLoading, isExchanging, error } = usePlaidLink({
  createLinkToken: api.plaid.createLinkToken,
  exchangePublicToken: api.plaid.exchangePublicToken,
  userId: string,
  products?: string[],
  webhookUrl?: string,
  onSuccess?: (plaidItemId: string, metadata: any) => void,
  onExit?: () => void,
  onError?: (error: Error) => void,
  autoFetchToken?: boolean,  // Default: true
});
```

### useUpdatePlaidLink

Hook for re-authentication when credentials expire:

```typescript
const { open, ready, refreshToken } = useUpdatePlaidLink({
  createUpdateLinkToken: api.plaid.createUpdateLinkToken,
  completeReauth: api.plaid.completeReauth,
  plaidItemId: string,
  onSuccess?: () => void,
  autoFetchToken?: boolean,  // Default: false
});

// Usage: await refreshToken(); open();
```

## Webhooks

### Setup

Create `convex/http.ts`:

```typescript
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
  onWebhook: async (ctx, webhookType, webhookCode, itemId, payload) => {
    // Optional: custom handler after default processing
  },
});

export default http;
```

Configure webhook URL in Plaid Dashboard or pass to `createLinkToken`:
```
https://your-project.convex.site/plaid/webhook
```

### Handled Events

| Type | Code | Action |
|------|------|--------|
| `TRANSACTIONS` | `SYNC_UPDATES_AVAILABLE` | Auto-triggers `syncTransactions` |
| `ITEM` | `ERROR` | Updates item status to `error` |
| `ITEM` | `PENDING_EXPIRATION` | Marks item as `needs_reauth` |
| `ITEM` | `USER_PERMISSION_REVOKED` | Deactivates item |
| `LIABILITIES` | `DEFAULT_UPDATE` | Auto-triggers `fetchLiabilities` |

### JWT Verification

Webhooks are verified using Plaid's ES256 JWT signature:
- Fetches Plaid's public key from their JWKS endpoint
- Verifies the JWT signature
- Validates request body hash
- Checks timestamp is within 5 minutes

## Database Schema

All monetary values are stored as **MILLIUNITS** (amount × 1000) to avoid floating-point precision errors.

### plaidItems

| Field | Type | Description |
|-------|------|-------------|
| `userId` | `string` | Host app user ID |
| `itemId` | `string` | Plaid item_id |
| `accessToken` | `string` | JWE encrypted access token |
| `cursor` | `string?` | Transaction sync cursor |
| `institutionId` | `string?` | Bank identifier |
| `institutionName` | `string?` | "Chase", "Wells Fargo", etc. |
| `status` | `enum` | `pending`, `syncing`, `active`, `error`, `needs_reauth` |
| `syncError` | `string?` | Error message from last sync |
| `createdAt` | `number` | Unix timestamp |
| `lastSyncedAt` | `number?` | Last successful sync timestamp |

### plaidAccounts

| Field | Type | Description |
|-------|------|-------------|
| `userId` | `string` | Host app user ID |
| `plaidItemId` | `string` | Reference to plaidItem |
| `accountId` | `string` | Plaid account_id |
| `name` | `string` | Account name |
| `type` | `string` | `credit`, `depository`, `loan` |
| `subtype` | `string?` | `credit card`, `checking`, `savings` |
| `mask` | `string?` | Last 4 digits |
| `balances.available` | `number?` | Available balance (milliunits) |
| `balances.current` | `number?` | Current balance (milliunits) |
| `balances.limit` | `number?` | Credit limit (milliunits) |

### plaidTransactions

| Field | Type | Description |
|-------|------|-------------|
| `transactionId` | `string` | Plaid transaction_id |
| `accountId` | `string` | Plaid account_id |
| `amount` | `number` | Amount in milliunits |
| `date` | `string` | ISO date (e.g., "2025-01-15") |
| `name` | `string` | Raw transaction name |
| `merchantName` | `string?` | Cleaned merchant name |
| `pending` | `boolean` | Is pending |
| `categoryPrimary` | `string?` | Primary category |
| `categoryDetailed` | `string?` | Detailed category |

### plaidCreditCardLiabilities

| Field | Type | Description |
|-------|------|-------------|
| `accountId` | `string` | Plaid account_id |
| `aprs` | `array` | APR entries |
| `isOverdue` | `boolean` | Payment overdue |
| `minimumPaymentAmount` | `number?` | Minimum payment (milliunits) |
| `nextPaymentDueDate` | `string?` | Next due date |
| `lastStatementBalance` | `number?` | Statement balance (milliunits) |

### plaidRecurringStreams

| Field | Type | Description |
|-------|------|-------------|
| `streamId` | `string` | Plaid stream_id |
| `description` | `string` | Stream name |
| `merchantName` | `string?` | Cleaned merchant |
| `averageAmount` | `number` | Average amount (milliunits) |
| `frequency` | `string` | `WEEKLY`, `BIWEEKLY`, `MONTHLY`, `ANNUALLY` |
| `status` | `enum` | `MATURE`, `EARLY_DETECTION`, `TOMBSTONED` |
| `type` | `enum` | `inflow` (income) or `outflow` (expense) |
| `isActive` | `boolean` | Currently active |
| `predictedNextDate` | `string?` | Next expected date |

## Integration Flow

1. **User clicks "Connect Bank"**
   - Call `createLinkToken` with userId
   - Open Plaid Link with returned token

2. **User completes Plaid Link**
   - `onSuccess` receives `publicToken`
   - Call `exchangePublicToken` → returns `plaidItemId`

3. **Initial data sync**
   - Call `onboardItem({ plaidItemId })`
   - Fetches accounts, transactions, liabilities, recurring streams

4. **Ongoing sync**
   - Webhooks auto-trigger on `SYNC_UPDATES_AVAILABLE`
   - Or call `syncTransactions` manually

5. **Re-auth when needed**
   - Check for `status === "needs_reauth"`
   - Use `useUpdatePlaidLink` hook

## Security

- **Access Token Encryption**: Tokens encrypted with JWE (A256GCM) before storage
- **Webhook Verification**: ES256 JWT signature verification with body hash validation
- **Component Isolation**: Isolated database tables, access only through public API
- **No Token Exposure**: Access tokens never returned in query results

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

## Architecture

This is a [Convex Component](https://docs.convex.dev/components) - an isolated module with its own schema that integrates into your Convex app.

```
Your App
├── convex/
│   ├── convex.config.ts    # Registers the component
│   ├── plaid.ts            # Your wrapper actions
│   └── http.ts             # Webhook routes
└── src/
    └── components/         # React components using hooks

Component (node_modules/@ericjamescrow/convex-plaid)
├── src/component/          # Internal tables and actions
├── src/client/             # Plaid class for host app
└── src/react/              # React hooks
```

**Key constraints:**
- Components cannot access `process.env` - config must be passed explicitly
- Components cannot use `ctx.auth` - userId must be passed as string
- Document IDs crossing component boundary are strings, not `Id<"table">`

## License

MIT
