import { createCipheriv, randomBytes } from "node:crypto";
import { KEY_VERSION_RE, SCHEMA_RE } from "./types.js";

/**
 * PII encryption helper.
 *
 * Verifiabl decrypts barcode ciphertext with
 * AES-256-GCM using a 96-bit IV, a 128-bit auth tag, and additional
 * authenticated data (AAD) binding the ciphertext to your provider
 * identity, key version, and payslip schema. IV, tag, and ciphertext are
 * base64url encoded without padding. This helper produces exactly that
 * shape from a formatted PII string and your provider key.
 *
 * Key handling rules (ISO 27001-aligned, these are your obligations as a
 * provider):
 *  - The 32-byte key must come from a KMS or secrets manager. Never hard
 *    code it, commit it, or log it.
 *  - The formatted plaintext string is PII. Keep it in memory only; never log it
 *    or persist it.
 */

const IV_BYTES = 12; // 96-bit IV, the NIST-recommended size for GCM
const KEY_BYTES = 32; // AES-256

export interface EncryptedPii {
  /** Base64url ciphertext to embed in the barcode or send to createBarcode. */
  encrypted_pii: string;
  /** Server-side decryption metadata for registration endpoints. */
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
 * Build the additional authenticated data (AAD) Verifiabl binds into
 * every ciphertext: `<provider-id>|<key_version>|<schema>`,
 * with the provider id taken from the key_version prefix.
 *
 * Exposed so integrations can reproduce the server's decryption in their
 * own round-trip tests. `encryptPii` calls this internally.
 */
export function buildPiiAad(keyVersion: string, schema: string): Buffer {
  const providerId = KEY_VERSION_RE.exec(keyVersion)?.[1];
  if (!providerId) {
    throw new Error(
      "keyVersion must be '<provider-id>.<n>' (lowercase client UUID, rotation counter from 1), " +
        'e.g. "0f8fad5b-d9cb-469f-a165-70867728950e.1"',
    );
  }
  if (!SCHEMA_RE.test(schema)) {
    throw new Error("schema must be in format 'xx.type.vN' (e.g. 'au.payslip.v1')");
  }
  return Buffer.from(`${providerId}|${keyVersion}|${schema}`, "utf8");
}

/**
 * Encrypt a formatted PII string with AES-256-GCM, bound to your provider
 * identity, key version, and payslip schema via AAD.
 *
 * The `keyVersion` and `schema` you pass here are authenticated into the
 * ciphertext and must exactly match the `encryption_metadata.key_version`
 * and `schema` fields of the registration request, or scan-time
 * decryption fails. This is deliberate tamper-binding: a ciphertext cannot
 * be replayed against a different provider, key version, or schema.
 *
 * @param plaintext The formatted string from `formatPii`.
 * @param key Your 32-byte provider encryption key.
 * @param keyVersion The key version assigned during onboarding:
 *   `<provider-id>.<n>`, where provider-id is your client UUID and n starts
 *   at 1 and increments each time you rotate your key (e.g.
 *   "0f8fad5b-d9cb-469f-a165-70867728950e.1"). Scans fail closed on
 *   any other format.
 * @param schema The payslip schema identifier this record is registered
 *   under, e.g. "au.payslip.v1".
 */
export function encryptPii(
  plaintext: string,
  key: Buffer,
  keyVersion: string,
  schema: string,
): EncryptedPii {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be exactly ${KEY_BYTES} bytes (AES-256)`);
  }
  const aad = buildPiiAad(keyVersion, schema);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
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
