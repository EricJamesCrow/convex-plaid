/**
 * Plaid Webhook Signature Verification
 *
 * Verifies that incoming webhooks are genuinely from Plaid using JWT signatures.
 * Uses jose library for JWT verification (Web Crypto compatible).
 *
 * Security flow:
 * 1. Extract JWT from Plaid-Verification header
 * 2. Decode header to get key ID (kid)
 * 3. Fetch public key from Plaid (cached)
 * 4. Verify JWT signature (ES256)
 * 5. Verify body SHA-256 hash matches
 * 6. Verify timestamp is recent (< 5 minutes)
 *
 * COMPONENT NOTE: This module is called from client/index.ts registerRoutes.
 * Plaid credentials are passed at call time, not read from process.env.
 *
 * @see https://plaid.com/docs/api/webhooks/webhook-verification/
 */

import { decodeProtectedHeader, jwtVerify, importJWK, type JWK } from "jose";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

// =============================================================================
// TYPES
// =============================================================================

export interface WebhookVerificationResult {
  isValid: boolean;
  error?: string;
}

export interface PlaidWebhookPayload {
  webhook_type: string;
  webhook_code: string;
  item_id: string;
  error?: {
    error_code: string;
    error_message: string;
    error_type: string;
  };
  new_transactions?: number;
  removed_transactions?: string[];
  consent_expiration_time?: string;
}

// =============================================================================
// KEY CACHE
// =============================================================================

// Cache verification keys (Plaid recommends caching)
// Map<kid, { key: CryptoKey, expires: number }>
const keyCache = new Map<string, { key: CryptoKey; expires: number }>();
const KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// =============================================================================
// MAIN VERIFICATION FUNCTION
// =============================================================================

/**
 * Verify a Plaid webhook signature.
 *
 * @param jwt - The JWT from the Plaid-Verification header
 * @param rawBody - The raw request body as a string (NOT parsed JSON)
 * @param plaidConfig - Plaid API credentials for key fetching
 * @returns Verification result with isValid and optional error
 */
export async function verifyPlaidWebhook(
  jwt: string,
  rawBody: string,
  plaidConfig: {
    plaidClientId: string;
    plaidSecret: string;
    plaidEnv: string;
  }
): Promise<WebhookVerificationResult> {
  try {
    // Step 1: Decode JWT header to get key ID (without verification)
    const protectedHeader = decodeProtectedHeader(jwt);

    // Step 2: Verify algorithm is ES256 (Plaid uses ECDSA with P-256)
    if (protectedHeader.alg !== "ES256") {
      return {
        isValid: false,
        error: `Invalid JWT algorithm: ${protectedHeader.alg}, expected ES256`,
      };
    }

    const kid = protectedHeader.kid;
    if (!kid) {
      return {
        isValid: false,
        error: "Missing key ID (kid) in JWT header",
      };
    }

    // Step 3: Get public key (with caching)
    const publicKey = await getVerificationKey(kid, plaidConfig);

    // Step 4: Verify JWT signature and get payload
    const { payload } = await jwtVerify(jwt, publicKey, {
      algorithms: ["ES256"],
    });

    // Step 5: Verify timestamp is recent (< 5 minutes)
    const iat = payload.iat as number;
    const now = Math.floor(Date.now() / 1000);
    const maxAge = 5 * 60; // 5 minutes in seconds

    if (now - iat > maxAge) {
      return {
        isValid: false,
        error: `Webhook too old: ${now - iat} seconds (max ${maxAge})`,
      };
    }

    // Step 6: Verify body hash matches
    const expectedHash = payload.request_body_sha256 as string;
    if (!expectedHash) {
      return {
        isValid: false,
        error: "Missing request_body_sha256 in JWT payload",
      };
    }

    const actualHash = await computeSha256(rawBody);

    if (!constantTimeCompare(expectedHash, actualHash)) {
      return {
        isValid: false,
        error: "Body hash mismatch - request may have been tampered",
      };
    }

    return { isValid: true };
  } catch (err) {
    return {
      isValid: false,
      error: err instanceof Error ? err.message : "Unknown verification error",
    };
  }
}

// =============================================================================
// KEY MANAGEMENT
// =============================================================================

/**
 * Get Plaid's verification key by key ID (with caching).
 *
 * @param kid - Key ID from JWT header
 * @param plaidConfig - Plaid API credentials
 * @returns Public key for verification
 */
async function getVerificationKey(
  kid: string,
  plaidConfig: {
    plaidClientId: string;
    plaidSecret: string;
    plaidEnv: string;
  }
): Promise<CryptoKey> {
  // Check cache first
  const cached = keyCache.get(kid);
  if (cached && cached.expires > Date.now()) {
    return cached.key;
  }

  // Create Plaid client for key fetch
  const configuration = new Configuration({
    basePath:
      PlaidEnvironments[
        plaidConfig.plaidEnv as keyof typeof PlaidEnvironments
      ] || PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": plaidConfig.plaidClientId,
        "PLAID-SECRET": plaidConfig.plaidSecret,
      },
    },
  });

  const plaidClient = new PlaidApi(configuration);

  // Fetch from Plaid API
  const response = await plaidClient.webhookVerificationKeyGet({
    key_id: kid,
  });

  // Import the JWK
  const jwk = response.data.key;
  const key = await importJWK(jwk as JWK, "ES256");

  // Cache the key
  keyCache.set(kid, {
    key: key as CryptoKey,
    expires: Date.now() + KEY_CACHE_TTL_MS,
  });

  return key as CryptoKey;
}

// =============================================================================
// CRYPTOGRAPHIC UTILITIES
// =============================================================================

/**
 * Compute SHA-256 hash of a string using Web Crypto API.
 *
 * @param data - String to hash
 * @returns Hex-encoded SHA-256 hash
 */
export async function computeSha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(data)
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time string comparison to prevent timing attacks.
 *
 * @param a - First string
 * @param b - Second string
 * @returns true if strings are equal
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// =============================================================================
// WEBHOOK PAYLOAD PARSING
// =============================================================================

/**
 * Parse and validate a Plaid webhook payload.
 *
 * @param body - Raw JSON body string
 * @returns Parsed webhook payload
 * @throws Error if parsing fails
 */
export function parseWebhookPayload(body: string): PlaidWebhookPayload {
  const payload = JSON.parse(body);

  // Validate required fields
  if (!payload.webhook_type || typeof payload.webhook_type !== "string") {
    throw new Error("Missing or invalid webhook_type");
  }
  if (!payload.webhook_code || typeof payload.webhook_code !== "string") {
    throw new Error("Missing or invalid webhook_code");
  }
  if (!payload.item_id || typeof payload.item_id !== "string") {
    throw new Error("Missing or invalid item_id");
  }

  return payload as PlaidWebhookPayload;
}

// =============================================================================
// WEBHOOK TYPE HELPERS
// =============================================================================

/**
 * Check if this is a transaction sync webhook.
 */
export function isTransactionSyncWebhook(
  webhookType: string,
  webhookCode: string
): boolean {
  return (
    webhookType === "TRANSACTIONS" && webhookCode === "SYNC_UPDATES_AVAILABLE"
  );
}

/**
 * Check if this is an item error webhook.
 */
export function isItemErrorWebhook(
  webhookType: string,
  webhookCode: string
): boolean {
  return webhookType === "ITEM" && webhookCode === "ERROR";
}

/**
 * Check if this is a pending expiration webhook (needs re-auth).
 */
export function isPendingExpirationWebhook(
  webhookType: string,
  webhookCode: string
): boolean {
  return webhookType === "ITEM" && webhookCode === "PENDING_EXPIRATION";
}

/**
 * Check if user has revoked permission.
 */
export function isUserPermissionRevokedWebhook(
  webhookType: string,
  webhookCode: string
): boolean {
  return webhookType === "ITEM" && webhookCode === "USER_PERMISSION_REVOKED";
}

/**
 * Check if this is a liabilities update webhook.
 */
export function isLiabilitiesUpdateWebhook(
  webhookType: string,
  webhookCode: string
): boolean {
  return webhookType === "LIABILITIES" && webhookCode === "DEFAULT_UPDATE";
}

/**
 * Check if this is an initial transactions update (historical sync complete).
 */
export function isInitialUpdateWebhook(
  webhookType: string,
  webhookCode: string
): boolean {
  return webhookType === "TRANSACTIONS" && webhookCode === "INITIAL_UPDATE";
}

/**
 * Check if this is a historical transactions update.
 */
export function isHistoricalUpdateWebhook(
  webhookType: string,
  webhookCode: string
): boolean {
  return webhookType === "TRANSACTIONS" && webhookCode === "HISTORICAL_UPDATE";
}

// =============================================================================
// WEBHOOK DEDUPLICATION
// =============================================================================

/**
 * Configuration for webhook deduplication
 */
export const DEDUP_CONFIG = {
  /** Time window in ms to check for duplicates (5 minutes) */
  windowMs: 5 * 60 * 1000,
} as const;

/**
 * Generate a unique webhook ID for logging and tracking.
 *
 * @param itemId - Plaid item_id
 * @param webhookCode - Webhook code (e.g., "SYNC_UPDATES_AVAILABLE")
 * @param timestamp - Unix timestamp
 * @returns Unique webhook ID string
 */
export function generateWebhookId(
  itemId: string,
  webhookCode: string,
  timestamp: number
): string {
  return `${itemId}_${webhookCode}_${timestamp}`;
}

/**
 * Create a webhook log entry structure.
 *
 * @param params - Webhook parameters
 * @returns Webhook log entry (ready for mutation)
 */
export function createWebhookLogEntry(params: {
  itemId: string;
  webhookType: string;
  webhookCode: string;
  bodyHash: string;
  status?: "received" | "processing" | "processed" | "duplicate" | "failed";
}): {
  webhookId: string;
  itemId: string;
  webhookType: string;
  webhookCode: string;
  bodyHash: string;
  receivedAt: number;
  status: "received" | "processing" | "processed" | "duplicate" | "failed";
} {
  const receivedAt = Date.now();
  return {
    webhookId: generateWebhookId(params.itemId, params.webhookCode, receivedAt),
    itemId: params.itemId,
    webhookType: params.webhookType,
    webhookCode: params.webhookCode,
    bodyHash: params.bodyHash,
    receivedAt,
    status: params.status ?? "received",
  };
}
