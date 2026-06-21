import { createCipheriv, randomBytes } from "node:crypto";
import { KEY_VERSION_RE } from "./types.js";

/**
 * PII encryption helper.
 *
 * Verifiabl decrypts barcode ciphertext with AES-256-GCM using a 96-bit IV
 * and a 128-bit authentication tag. The IV, tag, and ciphertext are
 * base64url encoded without padding. This helper produces exactly that
 * shape from a formatted PII string and your provider key.
 *
 * Each provider has its own encryption key, so a ciphertext can only be
 * decrypted with the key of the provider that issued it.
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
  /** Base64url ciphertext to embed in the barcode or send to createBarcode. */
  encryptedPii: string;
  /** Server-side decryption metadata for registration endpoints. */
  encryptionMetadata: {
    iv: string;
    tag: string;
    keyVersion: string;
  };
}

function base64Url(buf: Buffer): string {
  return buf.toString("base64url");
}

/**
 * Encrypt a formatted PII string with AES-256-GCM.
 *
 * The GCM authentication tag, returned in `encryption_metadata`, lets the
 * verifier detect any tampering with the ciphertext at scan time.
 *
 * @param plaintext The formatted string from `formatPii`.
 * @param key Your 32-byte provider encryption key.
 * @param keyVersion The key version assigned during onboarding:
 *   `<provider-id>.<n>`, where provider-id is your provider ID and n starts
 *   at 1 and increments each time you rotate your key (e.g.
 *   "0f8fad5b-d9cb-469f-a165-70867728950e.1").
 */
export function encryptPii(plaintext: string, key: Buffer, keyVersion: string): EncryptedPii {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be exactly ${KEY_BYTES} bytes (AES-256)`);
  }
  if (!KEY_VERSION_RE.test(keyVersion)) {
    throw new Error(
      "keyVersion must be '<provider-id>.<n>' (lowercase provider ID, rotation counter from 1), " +
        'e.g. "0f8fad5b-d9cb-469f-a165-70867728950e.1"',
    );
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encryptedPii: base64Url(ciphertext),
    encryptionMetadata: {
      iv: base64Url(iv),
      tag: base64Url(tag),
      keyVersion,
    },
  };
}
