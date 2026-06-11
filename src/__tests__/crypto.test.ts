import { createDecipheriv, randomBytes } from "node:crypto";
import { encryptPii } from "../crypto.js";
import { formatP1, parseP1 } from "../p1.js";

/**
 * Mirrors the Verifiabl verifier's decryption exactly: AES-256-GCM,
 * base64url iv/tag/ciphertext. If this round-trip breaks, provider
 * integrations would produce barcodes the platform cannot verify.
 */
function decryptLikeVerifier(
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

  it("produces ciphertext the verifier's decrypt logic can read", () => {
    const plaintext = formatP1({
      employee_name: "Jane A. Doe",
      position: "Senior Developer",
      department: "Engineering",
      employer_abn: "12-345-678-901",
      bsb: "062-000",
      account_number: "12345678",
      account_name: "Jane A Doe",
    });

    const { encrypted_pii, encryption_metadata } = encryptPii(plaintext, key, "v1");
    const decrypted = decryptLikeVerifier(
      encrypted_pii,
      encryption_metadata.iv,
      encryption_metadata.tag,
      key,
    );

    expect(decrypted).toBe(plaintext);
    expect(parseP1(decrypted)).toMatchObject({ employee_name: "Jane A. Doe" });
  });

  it("emits metadata in the exact wire sizes the API validates", () => {
    const { encrypted_pii, encryption_metadata } = encryptPii("P1|a||||||", key, "v1");
    expect(encryption_metadata.iv).toHaveLength(16); // 96-bit IV
    expect(encryption_metadata.tag).toHaveLength(22); // 128-bit tag
    expect(encryption_metadata.iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encryption_metadata.tag).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encrypted_pii).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encryption_metadata.key_version).toBe("v1");
  });

  it("uses a fresh IV per call", () => {
    const a = encryptPii("P1|a||||||", key, "v1");
    const b = encryptPii("P1|a||||||", key, "v1");
    expect(a.encryption_metadata.iv).not.toBe(b.encryption_metadata.iv);
    expect(a.encrypted_pii).not.toBe(b.encrypted_pii);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptPii("P1|a||||||", randomBytes(16), "v1")).toThrow("32 bytes");
  });

  it("rejects empty or oversized key versions", () => {
    expect(() => encryptPii("P1|a||||||", key, "")).toThrow();
    expect(() => encryptPii("P1|a||||||", key, "x".repeat(129))).toThrow();
  });

  it("rejects key versions outside the API allow-list", () => {
    expect(() => encryptPii("P1|a||||||", key, "customer key v1")).toThrow("keyVersion");
  });
});
