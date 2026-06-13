import { createDecipheriv, randomBytes } from "node:crypto";
import { buildPiiAad, encryptPii } from "../crypto.js";
import { formatPii, parsePii } from "../pii.js";

const KEY_VERSION = "0f8fad5b-d9cb-469f-a165-70867728950e.1";
const PROVIDER_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SCHEMA = "au.payslip.v1";

/**
 * Mirrors Verifiabl scan-time decryption exactly: AES-256-GCM,
 * base64url iv/tag/ciphertext, and AAD reconstructed server-side as
 * `<provider-id>|<key_version>|<schema>` (provider id derived from the
 * key_version prefix; schema read from the registered record). If this
 * round-trip breaks, provider integrations would produce barcodes the
 * platform cannot verify.
 */
function decryptLikeVerifiabl(
  ciphertextB64u: string,
  ivB64u: string,
  tagB64u: string,
  key: Buffer,
  aad: Buffer,
): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64u, "base64url"));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(tagB64u, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64u, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

describe("buildPiiAad", () => {
  it("builds the server's AAD layout from key version and schema", () => {
    expect(buildPiiAad(KEY_VERSION, SCHEMA).toString("utf8")).toBe(
      `${PROVIDER_ID}|${KEY_VERSION}|${SCHEMA}`,
    );
  });

  it("rejects key versions that are not <provider-id>.<n>", () => {
    expect(() => buildPiiAad("v1", SCHEMA)).toThrow("provider-id");
    expect(() => buildPiiAad(`${PROVIDER_ID}.0`, SCHEMA)).toThrow("provider-id");
    expect(() => buildPiiAad(`${PROVIDER_ID.toUpperCase()}.1`, SCHEMA)).toThrow("provider-id");
  });

  it("rejects malformed schemas", () => {
    expect(() => buildPiiAad(KEY_VERSION, "payslip")).toThrow("schema");
    expect(() => buildPiiAad(KEY_VERSION, "AU.payslip.v1")).toThrow("schema");
  });
});

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

    const { encrypted_pii, encryption_metadata } = encryptPii(plaintext, key, KEY_VERSION, SCHEMA);
    const decrypted = decryptLikeVerifiabl(
      encrypted_pii,
      encryption_metadata.iv,
      encryption_metadata.tag,
      key,
      buildPiiAad(KEY_VERSION, SCHEMA),
    );

    expect(decrypted).toBe(plaintext);
    expect(parsePii(decrypted)).toMatchObject({ employee_name: "Jane A. Doe" });
  });

  it("binds the ciphertext to the AAD: decryption without it fails", () => {
    const { encrypted_pii, encryption_metadata } = encryptPii(
      "P1|a||||||",
      key,
      KEY_VERSION,
      SCHEMA,
    );
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(encryption_metadata.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encryption_metadata.tag, "base64url"));
    expect(() => {
      decipher.update(Buffer.from(encrypted_pii, "base64url"));
      decipher.final();
    }).toThrow();
  });

  it("binds the ciphertext to the schema: a different schema fails", () => {
    const { encrypted_pii, encryption_metadata } = encryptPii(
      "P1|a||||||",
      key,
      KEY_VERSION,
      SCHEMA,
    );
    expect(() =>
      decryptLikeVerifiabl(
        encrypted_pii,
        encryption_metadata.iv,
        encryption_metadata.tag,
        key,
        buildPiiAad(KEY_VERSION, "au.payslip.v2"),
      ),
    ).toThrow();
  });

  it("emits metadata in the exact wire sizes the API validates", () => {
    const { encrypted_pii, encryption_metadata } = encryptPii(
      "P1|a||||||",
      key,
      KEY_VERSION,
      SCHEMA,
    );
    expect(encryption_metadata.iv).toHaveLength(16); // 96-bit IV
    expect(encryption_metadata.tag).toHaveLength(22); // 128-bit tag
    expect(encryption_metadata.iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encryption_metadata.tag).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encrypted_pii).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encryption_metadata.key_version).toBe(KEY_VERSION);
  });

  it("uses a fresh IV per call", () => {
    const a = encryptPii("P1|a||||||", key, KEY_VERSION, SCHEMA);
    const b = encryptPii("P1|a||||||", key, KEY_VERSION, SCHEMA);
    expect(a.encryption_metadata.iv).not.toBe(b.encryption_metadata.iv);
    expect(a.encrypted_pii).not.toBe(b.encrypted_pii);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptPii("P1|a||||||", randomBytes(16), KEY_VERSION, SCHEMA)).toThrow(
      "32 bytes",
    );
  });

  it("rejects key versions outside the deployed contract", () => {
    expect(() => encryptPii("P1|a||||||", key, "v1", SCHEMA)).toThrow("provider-id");
    expect(() => encryptPii("P1|a||||||", key, "", SCHEMA)).toThrow("provider-id");
    expect(() => encryptPii("P1|a||||||", key, "customer key v1", SCHEMA)).toThrow("provider-id");
  });
});
