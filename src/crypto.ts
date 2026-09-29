import { randomBytes } from "node:crypto";
import { type EncryptedPii, encryptPiiWithIv } from "./internal/crypto.js";

export type { EncryptedPii };

/**
 * PII encryption helper.
 *
 * Verifiabl decrypts barcode ciphertext with AES-256-GCM using a 96-bit IV
 * and a 128-bit authentication tag. This helper returns the IV, tag, and
 * ciphertext as buffers. The SDK applies the required encoding when it sends
 * an API request or builds a barcode.
 *
 * Each provider has its own encryption key, so a ciphertext can only be
 * decrypted with the key of the provider that issued it. Verifiabl finds
 * the right key at verification time; no key identifier is sent.
 *
 * Key handling rules (ISO 27001-aligned, these are your obligations as a
 * provider):
 *  - The 32-byte key must come from a KMS or secrets manager. Never hard
 *    code it, commit it, or log it.
 *  - The formatted plaintext string is PII. Keep it in memory only; never
 *    log it or persist it.
 */

const IV_BYTES = 12; // 96-bit IV, the NIST-recommended size for GCM
/**
 * Encrypt a formatted PII string with AES-256-GCM.
 *
 * The GCM authentication tag, returned in `encryption_metadata`, lets the
 * verifier detect any tampering with the ciphertext at scan time.
 *
 * Every call draws a fresh random iv. Do not store the returned
 * `encryptionMetadata` and send it again with different content: registration
 * rejects a repeated iv, and the SDK surfaces that as `VerifiablIvReuseError`
 * (or, in a batch, an error result matched by `isIvReuseResult`).
 *
 * @param plaintext The formatted string from `formatPii`.
 * @param key Your 32-byte provider encryption key.
 */
export function encryptPii(plaintext: string, key: Buffer): EncryptedPii {
  return encryptPiiWithIv(plaintext, key, randomBytes(IV_BYTES));
}
