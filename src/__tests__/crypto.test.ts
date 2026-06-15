import { createDecipheriv, randomBytes } from "node:crypto";
import { encryptPii } from "../crypto.js";
import { formatPii, parsePii } from "../pii.js";

const KEY_VERSION = "0f8fad5b-d9cb-469f-a165-70867728950e.1";

/**
 * Mirrors Verifiabl scan-time decryption: AES-256-GCM with base64url
 * iv/tag/ciphertext. If this round-trip breaks, provider integrations would
 * produce barcodes the platform cannot verify.
 */
function decryptLikeVerifiabl(
  ciphertextB64u: string,
  ivB64u: string,
  tagB64u: string,
  key: Buffer,
): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64u, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64u, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64u, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

describe("encryptPii", () => {
  const key = randomBytes(32);

  it("produces ciphertext the Verifiabl decrypt logic can read", () => {
    const plaintext = formatPii({
      employee_name: "Jane A. Doe",
      position: "Senior Developer",
      department: "Engineering",
      employer_abn: "12-345-678-901",
      bsb: "062-000",
      account_number: "12345678",
      account_name: "Jane A Doe",
    });

    const { encrypted_pii, encryption_metadata } = encryptPii(plaintext, key, KEY_VERSION);
    const decrypted = decryptLikeVerifiabl(
      encrypted_pii,
      encryption_metadata.iv,
      encryption_metadata.tag,
      key,
    );

    expect(decrypted).toBe(plaintext);
    expect(parsePii(decrypted)).toMatchObject({ employee_name: "Jane A. Doe" });
  });

  it("detects tampering: a flipped ciphertext byte fails the auth tag", () => {
    const { encrypted_pii, encryption_metadata } = encryptPii("P1|a||||||", key, KEY_VERSION);
    const corrupted = Buffer.from(encrypted_pii, "base64url");
    corrupted.writeUInt8(corrupted.readUInt8(0) ^ 0x01, 0);
    expect(() =>
      decryptLikeVerifiabl(
        corrupted.toString("base64url"),
        encryption_metadata.iv,
        encryption_metadata.tag,
        key,
      ),
    ).toThrow();
  });

  it("only decrypts with the issuing provider's key", () => {
    const { encrypted_pii, encryption_metadata } = encryptPii("P1|a||||||", key, KEY_VERSION);
    const otherProviderKey = randomBytes(32);
    expect(() =>
      decryptLikeVerifiabl(
        encrypted_pii,
        encryption_metadata.iv,
        encryption_metadata.tag,
        otherProviderKey,
      ),
    ).toThrow();
  });

  it("emits metadata in the exact wire sizes the API validates", () => {
    const { encrypted_pii, encryption_metadata } = encryptPii("P1|a||||||", key, KEY_VERSION);
    expect(encryption_metadata.iv).toHaveLength(16); // 96-bit IV
    expect(encryption_metadata.tag).toHaveLength(22); // 128-bit tag
    expect(encryption_metadata.iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encryption_metadata.tag).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encrypted_pii).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encryption_metadata.key_version).toBe(KEY_VERSION);
  });

  it("uses a fresh IV per call", () => {
    const a = encryptPii("P1|a||||||", key, KEY_VERSION);
    const b = encryptPii("P1|a||||||", key, KEY_VERSION);
    expect(a.encryption_metadata.iv).not.toBe(b.encryption_metadata.iv);
    expect(a.encrypted_pii).not.toBe(b.encrypted_pii);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptPii("P1|a||||||", randomBytes(16), KEY_VERSION)).toThrow("32 bytes");
  });

  it("rejects key versions outside the deployed contract", () => {
    expect(() => encryptPii("P1|a||||||", key, "v1")).toThrow("provider-id");
    expect(() => encryptPii("P1|a||||||", key, "")).toThrow("provider-id");
    expect(() => encryptPii("P1|a||||||", key, "customer key v1")).toThrow("provider-id");
  });
});
