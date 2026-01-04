/**
 * Encryption Module Tests
 *
 * Tests for JWE encryption/decryption of sensitive tokens.
 * These are security-critical functions requiring 100% coverage.
 */

import { describe, it, expect } from "vitest";
import {
  encryptToken,
  decryptToken,
  isEncryptedToken,
  TokenDecryptionError,
  DecryptionErrorCode,
} from "./encryption.js";

// Valid 32-byte key encoded as base64 (256 bits for A256GCM)
const VALID_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
// Another valid key for wrong-key tests
const DIFFERENT_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
// Invalid key (only 16 bytes)
const SHORT_KEY = "AAAAAAAAAAAAAAAAAAAAAA==";
// Invalid base64
const INVALID_BASE64 = "not-valid-base64!!!";

describe("Encryption Module", () => {
  describe("isEncryptedToken", () => {
    it("should return true for a valid JWE format (5 dot-separated parts)", () => {
      const jwe = "header.encryptedKey.iv.ciphertext.tag";
      expect(isEncryptedToken(jwe)).toBe(true);
    });

    it("should return true for JWE with empty encrypted_key (direct encryption)", () => {
      // In "dir" mode, encrypted_key is empty but dot is still present
      const jwe = "header..iv.ciphertext.tag";
      expect(isEncryptedToken(jwe)).toBe(true);
    });

    it("should return false for plaintext access token", () => {
      const accessToken = "access-sandbox-abc123def456";
      expect(isEncryptedToken(accessToken)).toBe(false);
    });

    it("should return false for JWT format (3 parts)", () => {
      const jwt = "header.payload.signature";
      expect(isEncryptedToken(jwt)).toBe(false);
    });

    it("should return false for string with 4 parts", () => {
      expect(isEncryptedToken("a.b.c.d")).toBe(false);
    });

    it("should return false for string with 6 parts", () => {
      expect(isEncryptedToken("a.b.c.d.e.f")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isEncryptedToken("")).toBe(false);
    });

    it("should return false for string with no dots", () => {
      expect(isEncryptedToken("nodots")).toBe(false);
    });
  });

  describe("encryptToken", () => {
    it("should encrypt a plaintext token", async () => {
      const plaintext = "access-sandbox-abc123";
      const encrypted = await encryptToken(plaintext, VALID_KEY);

      expect(typeof encrypted).toBe("string");
      expect(isEncryptedToken(encrypted)).toBe(true);
      expect(encrypted).not.toBe(plaintext);
    });

    it("should produce different ciphertexts for the same input (random IV)", async () => {
      const plaintext = "same-token";
      const encrypted1 = await encryptToken(plaintext, VALID_KEY);
      const encrypted2 = await encryptToken(plaintext, VALID_KEY);

      // JWE uses random IV, so same plaintext should produce different ciphertext
      expect(encrypted1).not.toBe(encrypted2);
    });

    it("should encrypt empty string", async () => {
      const encrypted = await encryptToken("", VALID_KEY);
      expect(isEncryptedToken(encrypted)).toBe(true);
    });

    it("should encrypt long tokens", async () => {
      const longToken = "a".repeat(10000);
      const encrypted = await encryptToken(longToken, VALID_KEY);
      expect(isEncryptedToken(encrypted)).toBe(true);
    });

    it("should encrypt tokens with special characters", async () => {
      const specialChars = "access-token!@#$%^&*()_+-=[]{}|;':\",./<>?`~";
      const encrypted = await encryptToken(specialChars, VALID_KEY);
      expect(isEncryptedToken(encrypted)).toBe(true);
    });

    it("should encrypt tokens with unicode characters", async () => {
      const unicode = "access-token-日本語-🔐-émoji";
      const encrypted = await encryptToken(unicode, VALID_KEY);
      expect(isEncryptedToken(encrypted)).toBe(true);
    });

    it("should throw error for invalid key (too short)", async () => {
      await expect(encryptToken("test", SHORT_KEY)).rejects.toThrow(
        "Encryption key must be 32 bytes"
      );
    });

    it("should throw error for invalid base64 key", async () => {
      await expect(encryptToken("test", INVALID_BASE64)).rejects.toThrow();
    });
  });

  describe("decryptToken", () => {
    it("should decrypt an encrypted token", async () => {
      const original = "access-sandbox-abc123";
      const encrypted = await encryptToken(original, VALID_KEY);
      const decrypted = await decryptToken(encrypted, VALID_KEY);

      expect(decrypted).toBe(original);
    });

    it("should decrypt empty string", async () => {
      const encrypted = await encryptToken("", VALID_KEY);
      const decrypted = await decryptToken(encrypted, VALID_KEY);
      expect(decrypted).toBe("");
    });

    it("should decrypt long tokens", async () => {
      const longToken = "b".repeat(10000);
      const encrypted = await encryptToken(longToken, VALID_KEY);
      const decrypted = await decryptToken(encrypted, VALID_KEY);
      expect(decrypted).toBe(longToken);
    });

    it("should decrypt tokens with unicode characters", async () => {
      const unicode = "access-token-日本語-🔐-émoji";
      const encrypted = await encryptToken(unicode, VALID_KEY);
      const decrypted = await decryptToken(encrypted, VALID_KEY);
      expect(decrypted).toBe(unicode);
    });

    it("should round-trip multiple tokens correctly", async () => {
      const tokens = [
        "token1",
        "access-sandbox-123",
        "production-token-xyz",
        "",
        "special!@#$%",
      ];

      for (const token of tokens) {
        const encrypted = await encryptToken(token, VALID_KEY);
        const decrypted = await decryptToken(encrypted, VALID_KEY);
        expect(decrypted).toBe(token);
      }
    });
  });

  describe("decryptToken error handling", () => {
    it("should throw INVALID_FORMAT for null input", async () => {
      await expect(
        decryptToken(null as unknown as string, VALID_KEY)
      ).rejects.toMatchObject({
        code: DecryptionErrorCode.INVALID_FORMAT,
        name: "TokenDecryptionError",
      });
    });

    it("should throw INVALID_FORMAT for undefined input", async () => {
      await expect(
        decryptToken(undefined as unknown as string, VALID_KEY)
      ).rejects.toMatchObject({
        code: DecryptionErrorCode.INVALID_FORMAT,
      });
    });

    it("should throw INVALID_FORMAT for empty string", async () => {
      await expect(decryptToken("", VALID_KEY)).rejects.toMatchObject({
        code: DecryptionErrorCode.INVALID_FORMAT,
        message: "Encrypted token must be a non-empty string",
      });
    });

    it("should throw INVALID_FORMAT for non-JWE string", async () => {
      await expect(
        decryptToken("access-sandbox-123", VALID_KEY)
      ).rejects.toMatchObject({
        code: DecryptionErrorCode.INVALID_FORMAT,
        message: expect.stringContaining("JWE compact serialization"),
      });
    });

    it("should throw INVALID_FORMAT for JWT (3 parts)", async () => {
      await expect(
        decryptToken("header.payload.signature", VALID_KEY)
      ).rejects.toMatchObject({
        code: DecryptionErrorCode.INVALID_FORMAT,
      });
    });

    it("should throw INVALID_KEY for short encryption key", async () => {
      const encrypted = await encryptToken("test", VALID_KEY);
      await expect(decryptToken(encrypted, SHORT_KEY)).rejects.toMatchObject({
        code: DecryptionErrorCode.INVALID_KEY,
        message: "Invalid encryption key configuration",
      });
    });

    it("should throw INVALID_KEY for invalid base64 key", async () => {
      const encrypted = await encryptToken("test", VALID_KEY);
      await expect(
        decryptToken(encrypted, INVALID_BASE64)
      ).rejects.toMatchObject({
        code: DecryptionErrorCode.INVALID_KEY,
      });
    });

    it("should throw DECRYPTION_FAILED for wrong key", async () => {
      const encrypted = await encryptToken("test", VALID_KEY);
      await expect(
        decryptToken(encrypted, DIFFERENT_KEY)
      ).rejects.toMatchObject({
        code: DecryptionErrorCode.DECRYPTION_FAILED,
        message: expect.stringContaining("Failed to decrypt token"),
      });
    });

    it("should throw DECRYPTION_FAILED for corrupted ciphertext", async () => {
      const encrypted = await encryptToken("test", VALID_KEY);
      // Corrupt the ciphertext (4th part of JWE)
      const parts = encrypted.split(".");
      parts[3] = "corrupted" + parts[3].slice(9);
      const corrupted = parts.join(".");

      await expect(decryptToken(corrupted, VALID_KEY)).rejects.toMatchObject({
        code: DecryptionErrorCode.DECRYPTION_FAILED,
      });
    });

    it("should throw DECRYPTION_FAILED for corrupted tag", async () => {
      const encrypted = await encryptToken("test", VALID_KEY);
      // Corrupt the tag (5th part of JWE)
      const parts = encrypted.split(".");
      parts[4] = "corrupted";
      const corrupted = parts.join(".");

      await expect(decryptToken(corrupted, VALID_KEY)).rejects.toMatchObject({
        code: DecryptionErrorCode.DECRYPTION_FAILED,
      });
    });
  });

  describe("TokenDecryptionError", () => {
    it("should be an instance of Error", () => {
      const error = new TokenDecryptionError("TEST_CODE", "Test message");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(TokenDecryptionError);
    });

    it("should have correct name", () => {
      const error = new TokenDecryptionError("TEST_CODE", "Test message");
      expect(error.name).toBe("TokenDecryptionError");
    });

    it("should have correct code and message", () => {
      const error = new TokenDecryptionError("MY_CODE", "My message");
      expect(error.code).toBe("MY_CODE");
      expect(error.message).toBe("My message");
    });

    it("should work with instanceof checks", () => {
      const error = new TokenDecryptionError("TEST", "test");
      expect(error instanceof TokenDecryptionError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });

  describe("DecryptionErrorCode", () => {
    it("should have all expected error codes", () => {
      expect(DecryptionErrorCode.INVALID_FORMAT).toBe("INVALID_TOKEN_FORMAT");
      expect(DecryptionErrorCode.INVALID_KEY).toBe("INVALID_ENCRYPTION_KEY");
      expect(DecryptionErrorCode.DECRYPTION_FAILED).toBe("DECRYPTION_FAILED");
    });
  });

  describe("Security properties", () => {
    it("should not leak plaintext in encrypted output", async () => {
      const plaintext = "access-sandbox-secret-token-123";
      const encrypted = await encryptToken(plaintext, VALID_KEY);

      // Encrypted output should not contain the plaintext
      expect(encrypted).not.toContain(plaintext);
      expect(encrypted).not.toContain("secret");
      expect(encrypted).not.toContain("access");
    });

    it("should produce ciphertext longer than plaintext (overhead)", async () => {
      const plaintext = "short";
      const encrypted = await encryptToken(plaintext, VALID_KEY);

      // JWE adds significant overhead (header, IV, tag)
      expect(encrypted.length).toBeGreaterThan(plaintext.length);
    });

    it("should fail silently without revealing crypto details on wrong key", async () => {
      const encrypted = await encryptToken("secret", VALID_KEY);

      try {
        await decryptToken(encrypted, DIFFERENT_KEY);
        expect.fail("Should have thrown");
      } catch (error) {
        const e = error as TokenDecryptionError;
        // Error message should NOT contain:
        // - The actual key
        // - Internal crypto error details
        // - Specific algorithm information
        expect(e.message).not.toContain("A256GCM");
        expect(e.message).not.toContain(VALID_KEY);
        expect(e.message).not.toContain(DIFFERENT_KEY);
        expect(e.message).not.toContain("secret");
      }
    });
  });
});
