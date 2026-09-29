import { createCipheriv } from "node:crypto";
import type { EncryptionMetadata } from "../types.js";

const IV_BYTES = 12; // 96-bit IV, the NIST-recommended size for GCM
const KEY_BYTES = 32; // AES-256

export interface EncryptedPii {
  /** AES-256-GCM ciphertext bytes to store or pass to the barcode and client APIs. */
  encryptedPii: Uint8Array;
  /** Server-side decryption metadata for registration endpoints. */
  encryptionMetadata: EncryptionMetadata;
}

/** Deterministic test seam for shared cryptographic conformance vectors. @internal */
export function encryptPiiWithIv(plaintext: string, key: Uint8Array, iv: Uint8Array): EncryptedPii {
  validateKey(key);
  if (iv.length !== IV_BYTES) {
    throw new Error(`Encryption IV must be exactly ${IV_BYTES} bytes`);
  }

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

function validateKey(key: Uint8Array): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be exactly ${KEY_BYTES} bytes (AES-256)`);
  }
}
