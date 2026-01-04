/**
 * Example HTTP Router with Plaid Webhooks
 *
 * Demonstrates how to register Plaid webhook routes.
 */

import { httpRouter } from "convex/server";
import { registerRoutes } from "@crowdevelopment/convex-plaid";
import { components } from "./_generated/api";

const http = httpRouter();

// =============================================================================
// PLAID WEBHOOKS
// =============================================================================

/**
 * Register Plaid webhook handler.
 *
 * Phase 1: Basic logging only.
 * Phase 2 will add signature verification and automatic syncing.
 *
 * Configure this URL in your Plaid Dashboard:
 * https://your-deployment.convex.site/plaid/webhook
 */
registerRoutes(http, components.plaid, {
  webhookPath: "/plaid/webhook",

  // Optional: Provide config for Phase 2 webhook processing
  plaidConfig: {
    PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID!,
    PLAID_SECRET: process.env.PLAID_SECRET!,
    PLAID_ENV: process.env.PLAID_ENV ?? "sandbox",
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
  },

  // Optional: Custom webhook handler
  onWebhook: async (ctx, webhookType, webhookCode, itemId, payload) => {
    console.log(`[Custom Webhook Handler] ${webhookType}.${webhookCode}`);

    // Example: Trigger custom logic based on webhook
    if (webhookType === "TRANSACTIONS" && webhookCode === "SYNC_UPDATES_AVAILABLE") {
      // In Phase 2, you could auto-trigger a sync here
      console.log(`New transactions available for item ${itemId}`);
    }
  },
});

// =============================================================================
// OTHER ROUTES
// =============================================================================

// Add other HTTP routes as needed
// http.route({
//   path: "/api/health",
//   method: "GET",
//   handler: httpAction(async () => {
//     return new Response("OK");
//   }),
// });

export default http;
