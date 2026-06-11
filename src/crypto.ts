import { createCipheriv, randomBytes } from "node:crypto";

/**
 * PII encryption helper.
 *
 * Verifiabl's verification service decrypts barcode ciphertext with
 * AES-256-GCM using a 96-bit IV and a 128-bit auth tag, all base64url
 * encoded without padding. This helper produces exactly that shape from a
 * P1 plaintext string and your provider key.
 *
 * Key handling rules (ISO 27001-aligned, these are your obligations as a
 * provider):
 *  - The 32-byte key must come from a KMS or secrets manager. Never hard
 *    code it, commit it, or log it.
 *  - The plaintext P1 string is PII. Keep it in memory only; never log it
 *    or persist it.
 */

const IV_BYTES = 12; // 96-bit IV, the NIST-recommended size for GCM
const KEY_BYTES = 32; // AES-256
const KEY_VERSION_RE = /^[A-Za-z0-9._-]+$/;

export interface EncryptedPii {
  /** Base64url ciphertext to embed in the barcode or send to createPayslipSymbol. */
  encrypted_pii: string;
  /** Server-side decryption metadata for the register endpoints. */
  encryption_metadata: {
    iv: string;
    tag: string;
    key_version: string;
  };
}

function base64Url(buf: Buffer): string {
  return buf.toString("base64url");
}

/**
 * Encrypt a P1 plaintext string with AES-256-GCM.
 *
 * @param plaintext The P1 string from `formatP1`.
 * @param key Your 32-byte provider encryption key.
 * @param keyVersion Identifier of the key version in use (sent to the API
 *   so the matching key can be selected at verification time).
 */
export function encryptPii(plaintext: string, key: Buffer, keyVersion: string): EncryptedPii {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be exactly ${KEY_BYTES} bytes (AES-256)`);
  }
  if (keyVersion.length === 0 || keyVersion.length > 128) {
    throw new Error("keyVersion must be 1-128 characters");
  }
  if (!KEY_VERSION_RE.test(keyVersion)) {
    throw new Error(
      "keyVersion must contain only letters, numbers, dots, underscores, and hyphens",
    );
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted_pii: base64Url(ciphertext),
    encryption_metadata: {
      iv: base64Url(iv),
      tag: base64Url(tag),
      key_version: keyVersion,
    },
  };
}
