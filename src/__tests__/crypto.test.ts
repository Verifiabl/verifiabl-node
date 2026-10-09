import { createDecipheriv, randomBytes } from "node:crypto";
import { encryptPii } from "../crypto.js";
import { formatAustralianPii } from "../pii.js";

/** Mirrors Verifiabl scan-time AES-256-GCM decryption. */
function decryptLikeVerifiabl(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  tag: Uint8Array,
  key: Buffer,
): string {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

describe("encryptPii", () => {
  const key = randomBytes(32);

  it("produces ciphertext the Verifiabl decrypt logic can read", () => {
    const plaintext = formatAustralianPii({
      employeeName: "Jane A. Doe",
      position: "Senior Developer",
      department: "Engineering",
      employerAbn: "12-345-678-901",
      bsb: "062-000",
      accountNumber: "12345678",
      accountName: "Jane A Doe",
    });

    const { encryptedPii, encryptionMetadata } = encryptPii(plaintext, key);
    const decrypted = decryptLikeVerifiabl(
      encryptedPii,
      encryptionMetadata.iv,
      encryptionMetadata.tag,
      key,
    );

    expect(decrypted).toBe(plaintext);
    expect(decrypted.startsWith("AU2|Jane A. Doe|")).toBe(true);
  });

  it("detects tampering: a flipped ciphertext byte fails the auth tag", () => {
    const { encryptedPii, encryptionMetadata } = encryptPii("AU2|a|||||||", key);
    const corrupted = Buffer.from(encryptedPii);
    corrupted.writeUInt8(corrupted.readUInt8(0) ^ 0x01, 0);
    expect(() =>
      decryptLikeVerifiabl(corrupted, encryptionMetadata.iv, encryptionMetadata.tag, key),
    ).toThrow();
  });

  it("only decrypts with the issuing provider's key", () => {
    const { encryptedPii, encryptionMetadata } = encryptPii("AU2|a|||||||", key);
    const otherProviderKey = randomBytes(32);
    expect(() =>
      decryptLikeVerifiabl(
        encryptedPii,
        encryptionMetadata.iv,
        encryptionMetadata.tag,
        otherProviderKey,
      ),
    ).toThrow();
  });

  it("emits binary values in the exact sizes the API validates", () => {
    const { encryptedPii, encryptionMetadata } = encryptPii("AU2|a|||||||", key);
    expect(encryptedPii).toBeInstanceOf(Uint8Array);
    expect(encryptionMetadata.iv).toBeInstanceOf(Uint8Array);
    expect(encryptionMetadata.tag).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(encryptedPii)).toBe(false);
    expect(Buffer.isBuffer(encryptionMetadata.iv)).toBe(false);
    expect(Buffer.isBuffer(encryptionMetadata.tag)).toBe(false);
    expect(encryptionMetadata.iv).toHaveLength(12); // 96-bit IV
    expect(encryptionMetadata.tag).toHaveLength(16); // 128-bit tag
  });

  it("uses a fresh IV per call", () => {
    const a = encryptPii("AU2|a|||||||", key);
    const b = encryptPii("AU2|a|||||||", key);
    expect(a.encryptionMetadata.iv).not.toEqual(b.encryptionMetadata.iv);
    expect(a.encryptedPii).not.toEqual(b.encryptedPii);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptPii("AU2|a|||||||", randomBytes(16))).toThrow("32 bytes");
  });
});
