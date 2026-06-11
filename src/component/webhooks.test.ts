/**
 * Plaid webhook JWT verification tests.
 *
 * Signs real ES256 JWTs against a mocked Plaid verification-key endpoint and
 * exercises the full verification pipeline: signature validity, body-hash
 * binding, replay (iat) protection, algorithm pinning, key caching, and the
 * key-rotation retry path.
 */
import { describe, expect, it, vi, beforeAll, afterEach } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import {
  computeSha256,
  constantTimeCompare,
  invalidateCachedKey,
  isKeyCached,
  verifyPlaidWebhook,
} from "./webhooks";

const webhookKeyGet = vi.fn();

vi.mock("plaid", async (importOriginal) => {
  const actual = await importOriginal<typeof import("plaid")>();
  return {
    ...actual,
    PlaidApi: class {
      webhookVerificationKeyGet(args: unknown) {
        return webhookKeyGet(args);
      }
    },
  };
});

const PLAID_CONFIG = {
  plaidClientId: "test_client_id",
  plaidSecret: "test_secret",
  plaidEnv: "sandbox",
};

type Pair = Awaited<ReturnType<typeof generateKeyPair>>;
let pairA: Pair;
let pairB: Pair;
let jwkA: JWK;
let jwkB: JWK;

beforeAll(async () => {
  pairA = await generateKeyPair("ES256", { extractable: true });
  pairB = await generateKeyPair("ES256", { extractable: true });
  jwkA = await exportJWK(pairA.publicKey);
  jwkB = await exportJWK(pairB.publicKey);
});

afterEach(() => {
  webhookKeyGet.mockReset();
});

function serveKey(jwk: JWK) {
  webhookKeyGet.mockResolvedValue({ data: { key: jwk } });
}

async function signWebhookJwt(
  body: string,
  privateKey: Pair["privateKey"],
  kid: string,
  opts: { iatOffsetSeconds?: number } = {},
): Promise<string> {
  return await new SignJWT({ request_body_sha256: await computeSha256(body) })
    .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
    .setIssuedAt(Math.floor(Date.now() / 1000) + (opts.iatOffsetSeconds ?? 0))
    .sign(privateKey);
}

const BODY = JSON.stringify({
  webhook_type: "TRANSACTIONS",
  webhook_code: "SYNC_UPDATES_AVAILABLE",
  item_id: "item_webhook_test",
});

describe("verifyPlaidWebhook", () => {
  it("accepts a correctly signed webhook and caches the key", async () => {
    const kid = "kid_valid_case";
    serveKey(jwkA);
    const jwt = await signWebhookJwt(BODY, pairA.privateKey, kid);

    const result = await verifyPlaidWebhook(jwt, BODY, PLAID_CONFIG);
    expect(result.isValid).toBe(true);
    expect(isKeyCached(kid)).toBe(true);
    expect(webhookKeyGet).toHaveBeenCalledTimes(1);

    // Second verification reuses the cached key — no extra fetch.
    const again = await verifyPlaidWebhook(jwt, BODY, PLAID_CONFIG);
    expect(again.isValid).toBe(true);
    expect(webhookKeyGet).toHaveBeenCalledTimes(1);
  });

  it("rejects a tampered body (hash mismatch)", async () => {
    const kid = "kid_tampered_body";
    serveKey(jwkA);
    const jwt = await signWebhookJwt(BODY, pairA.privateKey, kid);

    const result = await verifyPlaidWebhook(jwt, BODY.replace("TRANSACTIONS", "TAMPERED_XX"), PLAID_CONFIG);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/Body hash mismatch/);
  });

  it("rejects webhooks older than 5 minutes (replay protection)", async () => {
    const kid = "kid_stale_iat";
    serveKey(jwkA);
    const jwt = await signWebhookJwt(BODY, pairA.privateKey, kid, { iatOffsetSeconds: -600 });

    const result = await verifyPlaidWebhook(jwt, BODY, PLAID_CONFIG);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/too old/);
  });

  it("rejects non-ES256 algorithms", async () => {
    const kid = "kid_wrong_alg";
    serveKey(jwkA);
    const secret = new TextEncoder().encode("a-shared-secret-of-enough-length!!");
    const jwt = await new SignJWT({ request_body_sha256: await computeSha256(BODY) })
      .setProtectedHeader({ alg: "HS256", kid, typ: "JWT" })
      .setIssuedAt()
      .sign(secret);

    const result = await verifyPlaidWebhook(jwt, BODY, PLAID_CONFIG);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/Invalid JWT algorithm/);
  });

  it("rejects JWTs without a key id", async () => {
    serveKey(jwkA);
    const jwt = await new SignJWT({ request_body_sha256: await computeSha256(BODY) })
      .setProtectedHeader({ alg: "ES256", typ: "JWT" })
      .setIssuedAt()
      .sign(pairA.privateKey);

    const result = await verifyPlaidWebhook(jwt, BODY, PLAID_CONFIG);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/Missing key ID/);
  });

  it("rejects a corrupted signature", async () => {
    const kid = "kid_bad_signature";
    serveKey(jwkA);
    const jwt = await signWebhookJwt(BODY, pairA.privateKey, kid);
    const corrupted = jwt.slice(0, -4) + (jwt.endsWith("AAAA") ? "BBBB" : "AAAA");

    const result = await verifyPlaidWebhook(corrupted, BODY, PLAID_CONFIG);
    expect(result.isValid).toBe(false);
  });

  it("recovers from key rotation by refetching after a cached-key failure", async () => {
    const kid = "kid_rotation";

    // Prime the cache with key A...
    serveKey(jwkA);
    const jwtA = await signWebhookJwt(BODY, pairA.privateKey, kid);
    expect((await verifyPlaidWebhook(jwtA, BODY, PLAID_CONFIG)).isValid).toBe(true);
    expect(isKeyCached(kid)).toBe(true);

    // ...then Plaid rotates to key B. The cached A fails signature check,
    // the verifier invalidates the cache and refetches, getting B.
    serveKey(jwkB);
    const jwtB = await signWebhookJwt(BODY, pairB.privateKey, kid);
    const result = await verifyPlaidWebhook(jwtB, BODY, PLAID_CONFIG);
    expect(result.isValid).toBe(true);
    expect(webhookKeyGet).toHaveBeenCalledTimes(2); // initial prime + rotation refetch

    invalidateCachedKey(kid);
  });
});

describe("constantTimeCompare", () => {
  it("compares equal and unequal strings correctly", () => {
    expect(constantTimeCompare("abc123", "abc123")).toBe(true);
    expect(constantTimeCompare("abc123", "abc124")).toBe(false);
    expect(constantTimeCompare("short", "longer-string")).toBe(false);
  });
});
