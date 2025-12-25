/**
 * Token Encryption Utilities
 *
 * Provides JWE (JSON Web Encryption) functions for encrypting sensitive
 * data like Plaid access tokens at rest. Uses A256GCM algorithm.
 *
 * COMPONENT NOTE: Encryption key is passed as parameter, not read from process.env.
 * This enables component isolation - the host app provides the key.
 *
 * @see https://github.com/panva/jose
 */

import { CompactEncrypt, compactDecrypt } from "jose";

const ALGORITHM = "A256GCM";

/**
 * Parse base64-encoded encryption key to Uint8Array.
 *
 * @param base64Key - Base64-encoded 32-byte key
 * @returns 32-byte Uint8Array key for A256GCM
 * @throws Error if key is not 32 bytes
 */
function parseKey(base64Key: string): Uint8Array {
  const key = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  if (key.length !== 32) {
    throw new Error(`Encryption key must be 32 bytes, got ${key.length}`);
  }
  return key;
}

/**
 * Encrypt a plaintext string using JWE compact serialization.
 *
 * @param plaintext - The string to encrypt (e.g., Plaid access token)
 * @param base64Key - Base64-encoded 32-byte encryption key
 * @returns JWE compact serialization string (5 dot-separated parts)
 */
export async function encryptToken(
  plaintext: string,
  base64Key: string
): Promise<string> {
  const key = parseKey(base64Key);
  const encoder = new TextEncoder();
  const jwe = await new CompactEncrypt(encoder.encode(plaintext))
    .setProtectedHeader({ alg: "dir", enc: ALGORITHM })
    .encrypt(key);
  return jwe;
}

/**
 * Decrypt a JWE compact serialization string.
 *
 * @param jwe - The encrypted JWE string
 * @param base64Key - Base64-encoded 32-byte encryption key
 * @returns Original plaintext string
 */
export async function decryptToken(
  jwe: string,
  base64Key: string
): Promise<string> {
  const key = parseKey(base64Key);
  const { plaintext } = await compactDecrypt(jwe, key);
  return new TextDecoder().decode(plaintext);
}

/**
 * Check if a string is an encrypted JWE token.
 *
 * JWE compact format has exactly 5 parts separated by dots:
 * header.encrypted_key.iv.ciphertext.tag
 *
 * For "dir" (direct encryption), encrypted_key is empty but the dot is still present.
 *
 * @param value - The string to check
 * @returns true if the string appears to be a JWE
 */
export function isEncryptedToken(value: string): boolean {
  return value.split(".").length === 5;
}
