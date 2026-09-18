import { createCipheriv, randomBytes } from "node:crypto";
import type { EncryptionMetadata } from "./types.js";

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
const KEY_BYTES = 32; // AES-256

export interface EncryptedPii {
  /** AES-256-GCM ciphertext bytes to store or pass to the barcode and client APIs. */
  encryptedPii: Uint8Array;
  /** Server-side decryption metadata for registration endpoints. */
  encryptionMetadata: EncryptionMetadata;
}

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
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be exactly ${KEY_BYTES} bytes (AES-256)`);
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encryptedPii: new Uint8Array(ciphertext),
    encryptionMetadata: {
      iv: new Uint8Array(iv),
      tag: new Uint8Array(tag),
    },
  };
}
