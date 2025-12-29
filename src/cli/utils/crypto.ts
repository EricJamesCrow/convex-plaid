/**
 * Crypto Utilities
 *
 * Cryptographic functions for the CLI tool.
 */

import { randomBytes } from "crypto";

/**
 * Generate a cryptographically secure 256-bit encryption key.
 * Returns a base64-encoded string suitable for ENCRYPTION_KEY env var.
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString("base64");
}
