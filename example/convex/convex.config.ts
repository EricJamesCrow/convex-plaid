/**
 * Example Host App Configuration
 *
 * Demonstrates how to install the Plaid component in a Convex app.
 */

import { defineApp } from "convex/server";
import plaid from "@ericjamescrow/convex-plaid/convex.config.js";

const app = defineApp();

// Install the Plaid component
app.use(plaid);

export default app;
