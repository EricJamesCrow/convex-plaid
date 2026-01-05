# Convex Component Integration Patterns: A Complete Architecture Guide

Third-party SDK integrations in Convex follow a consistent, elegant pattern: components are sandboxed modules with their own database tables, accessed through auto-generated APIs and wrapped in TypeScript client classes. This architecture enables **transactional guarantees**, **type safety**, and **clean separation of concerns** while the host application maintains full control over HTTP routing and authentication flow.

## The canonical component architecture

Every Convex component follows a five-step integration pattern that establishes isolation while enabling seamless communication. First, install the npm package. Second, register it in `convex/convex.config.ts` using `app.use()`. Third, run `npx convex dev` to generate the `components.*` API types. Fourth, instantiate the component's client class. Fifth, wrap component functionality in your application's queries, mutations, and actions.

The key insight is that **components cannot access your app's tables or environment variables directly**—they operate in isolated sandboxes. Your app passes data to components through explicit function calls, and components expose their functionality through public functions accessed via `ctx.runQuery()`, `ctx.runMutation()`, and `ctx.runAction()`.

## Stripe component: payments with isolated billing tables

The `@convex-dev/stripe` component demonstrates the full integration pattern for payment processing. Registration happens in the app configuration:

```typescript
// convex/convex.config.ts
import { defineApp } from "convex/server";
import stripe from "@convex-dev/stripe/convex.config.js";

const app = defineApp();
app.use(stripe);
export default app;
```

The component creates **four sandboxed tables**—`customers`, `subscriptions`, `payments`, and `invoices`—completely isolated from your application schema. The `StripeSubscriptions` client class wraps all Stripe operations:

```typescript
// convex/stripe.ts
import { components } from "./_generated/api";
import { StripeSubscriptions } from "@convex-dev/stripe";
import { action } from "./_generated/server";

const stripeClient = new StripeSubscriptions(components.stripe, {});

export const createCheckout = action({
  args: { priceId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const customer = await stripeClient.getOrCreateCustomer(ctx, {
      userId: identity.subject,
      email: identity.email,
    });
    return await stripeClient.createCheckoutSession(ctx, {
      priceId: args.priceId,
      customerId: customer.customerId,
      mode: "subscription",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
  },
});
```

Webhook handling follows a **registration pattern** in `convex/http.ts` where the component provides the handler but your app controls routing:

```typescript
import { httpRouter } from "convex/server";
import { registerRoutes } from "@convex-dev/stripe";
import { components } from "./_generated/api";

const http = httpRouter();
registerRoutes(http, components.stripe, {
  webhookPath: "/stripe/webhook",
  events: {
    "customer.subscription.updated": async (ctx, event) => {
      // Custom handling logic
    },
  },
});
export default http;
```

**Sensitive data management** uses Convex's environment variable system: set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in the Convex Dashboard, and the component reads them automatically via `process.env`.

## Resend component: transactional email with durability guarantees

The `@convex-dev/resend` component wraps the Resend email API with **built-in batching, retry logic, and idempotency**. The wrapper class pattern is identical to Stripe:

```typescript
import { Resend } from "@convex-dev/resend";
import { components } from "./_generated/api";

export const resend = new Resend(components.resend, {
  testMode: false,  // Safety default prevents real emails in development
  onEmailEvent: internal.handleEmailEvent,  // Callback for delivery status
});

export const sendWelcome = internalMutation({
  handler: async (ctx) => {
    await resend.sendEmail(ctx, {
      from: "Team <hello@example.com>",
      to: "user@example.com",
      subject: "Welcome!",
      html: "<h1>Thanks for signing up</h1>",
    });
  },
});
```

The component provides **durability guarantees** by queuing emails and handling Resend's API rate limits internally. For complex templates, you can use React Email with Node action runtime:

```typescript
"use node";
import { render } from "@react-email/render";
import WelcomeEmail from "./templates/Welcome";

export const sendReactEmail = action({
  handler: async (ctx) => {
    const html = await render(<WelcomeEmail name="John" />);
    await resend.sendEmail(ctx, { from, to, subject, html });
  },
});
```

## Clerk integration: authentication without a component

Clerk follows a different pattern—it's not a Convex component but a **JWT-based authentication provider** configured through `convex/auth.config.ts`:

```typescript
// convex/auth.config.ts
export default {
  providers: [{
    domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
    applicationID: "convex",
  }],
};
```

The client-side uses `ConvexProviderWithClerk` from `convex/react-clerk`, which bridges Clerk's authentication state with Convex:

```tsx
import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

<ClerkProvider publishableKey="pk_...">
  <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
    <App />
  </ConvexProviderWithClerk>
</ClerkProvider>
```

The critical configuration step is creating a **JWT template named "convex"** in Clerk's dashboard—this template must include the `aud: "convex"` claim. Server-side, Convex functions access the authenticated user via `ctx.auth.getUserIdentity()`, which returns JWT claims including `subject` (Clerk user ID), `email`, `name`, and `tokenIdentifier`.

## The official @convex-dev ecosystem

The `@convex-dev` npm namespace contains **30+ official components** spanning five categories:

**AI and machine learning** includes `@convex-dev/agent` (10,969 weekly downloads) for building AI agents with message history and tool use, `@convex-dev/rag` for retrieval-augmented generation, and `@convex-dev/persistent-text-streaming` for real-time AI responses.

**Durable functions** provides `@convex-dev/workflow` (9,056 downloads) for long-running orchestration, `@convex-dev/workpool` (19,660 downloads) for parallel work queues, and `@convex-dev/action-retrier` for idempotent retry logic.

**Database utilities** offers `@convex-dev/migrations` (11,952 downloads) for schema migrations, `@convex-dev/aggregate` for denormalized counters and sums, `@convex-dev/sharded-counter` for high-throughput counting, and `@convex-dev/geospatial` for location queries.

**Third-party integrations** include `@convex-dev/resend` (10,380 downloads), `@convex-dev/r2` for Cloudflare storage, `@convex-dev/twilio` for SMS, `@convex-dev/expo-push-notifications`, and `@convex-dev/launchdarkly` for feature flags.

**Payments and auth** spans `@convex-dev/stripe`, `@convex-dev/polar` for subscriptions, `@convex-dev/workos` for enterprise SSO, and `@convex-dev/better-auth`.

## Component structure for package authors

Published components follow a standard NPM export structure:

```json
{
  "exports": {
    ".": "./src/client/index.ts",
    "./convex.config.js": "./src/component/convex.config.ts",
    "./_generated/component.js": "./src/component/_generated/component.ts"
  }
}
```

The component definition uses `defineComponent()` rather than `defineApp()`:

```typescript
// src/component/convex.config.ts
import { defineComponent } from "convex/server";
const component = defineComponent("myComponent");
export default component;
```

Key isolation characteristics to understand: component tables are **completely separate** from app tables, environment variables must be **passed explicitly** (components can't read `process.env` from the host), `ctx.auth` is **not available** in component functions (pass user IDs as arguments), and each component mutation runs as a **sub-transaction** that rolls back independently if it throws.

## Wrapper file best practices

The canonical pattern for exposing component functionality to your app involves creating a wrapper file that:

1. **Instantiates the client class** with `components.*` reference
2. **Wraps each operation** in typed Convex functions (query/mutation/action)
3. **Handles authentication** by calling `ctx.auth.getUserIdentity()` before component calls
4. **Maps user identity** to the component's expected identifiers (userId, email, etc.)

```typescript
// convex/payments.ts - canonical wrapper pattern
import { components } from "./_generated/api";
import { StripeSubscriptions } from "@convex-dev/stripe";
import { action, query } from "./_generated/server";

const stripe = new StripeSubscriptions(components.stripe, {});

// Wrap queries
export const getMySubscriptions = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return ctx.runQuery(components.stripe.public.listSubscriptionsByUserId, {
      userId: identity.subject,
    });
  },
});

// Wrap actions
export const createPortalSession = action({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return stripe.createCustomerPortalSession(ctx, {
      userId: identity.subject,
      returnUrl: "https://example.com/settings",
    });
  },
});
```

## Conclusion

Convex's component architecture achieves remarkable elegance through consistent patterns: **registration** via `app.use()`, **access** via auto-generated `components.*` APIs, **wrapping** via TypeScript client classes, and **isolation** via sandboxed tables and sub-transactions. Whether integrating payments (Stripe), email (Resend), authentication (Clerk), or building custom functionality, the pattern remains the same—enabling teams to compose sophisticated backends from battle-tested modules while maintaining full type safety and transactional guarantees.