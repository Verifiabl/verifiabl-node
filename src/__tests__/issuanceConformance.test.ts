import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encryptPiiWithIv } from "../internal/crypto.js";
import { buildBarcodePayload, buildScanUrl } from "../payload.js";
import { formatPii, type PiiFields } from "../pii.js";

interface CiphertextInput {
  hex?: string;
  repeatByteHex?: string;
  length?: number;
}

interface ValidVector {
  id: string;
  fields: PiiFields;
  plaintext: string;
  plaintextUtf8Hex: string;
  keyHex: string;
  ivHex: string;
  ciphertextHex: string;
  tagHex: string;
  reference: string;
  xmpPayload: string;
  productionScanUrl: string;
  sandboxScanUrl: string;
}

interface InvalidPayloadVector {
  id: string;
  operations: Array<"payload" | "scan-url">;
  reference: string;
  ciphertext: CiphertextInput;
  scanBaseUrl?: string;
  expectedError: "invalid-reference" | "invalid-ciphertext" | "insecure-scan-base-url";
}

interface Vectors {
  valid: ValidVector[];
  invalidPayloads: InvalidPayloadVector[];
}

const vectors = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/issuance-conformance-vectors-v1.json", import.meta.url)),
    "utf8",
  ),
) as Vectors;

function ciphertext(input: CiphertextInput): Uint8Array {
  if (input.hex !== undefined) return Buffer.from(input.hex, "hex");
  if (input.repeatByteHex !== undefined && input.length !== undefined) {
    return Buffer.alloc(input.length, Number.parseInt(input.repeatByteHex, 16));
  }
  throw new Error("invalid ciphertext fixture");
}

const errorPatterns = {
  "invalid-reference": /reference/i,
  "invalid-ciphertext": /ciphertext/i,
  "insecure-scan-base-url": /https/i,
} as const;

describe("shared issuance conformance vectors", () => {
  it("matches every deterministic issuance stage byte for byte", () => {
    for (const vector of vectors.valid) {
      const plaintext = formatPii(vector.fields);
      expect(plaintext, vector.id).toBe(vector.plaintext);
      expect(Buffer.from(plaintext, "utf8").toString("hex"), vector.id).toBe(
        vector.plaintextUtf8Hex,
      );

      const encrypted = encryptPiiWithIv(
        plaintext,
        Buffer.from(vector.keyHex, "hex"),
        Buffer.from(vector.ivHex, "hex"),
      );
      expect(Buffer.from(encrypted.encryptedPii).toString("hex"), vector.id).toBe(
        vector.ciphertextHex,
      );
      expect(Buffer.from(encrypted.encryptionMetadata.tag).toString("hex"), vector.id).toBe(
        vector.tagHex,
      );
      expect(Buffer.from(encrypted.encryptionMetadata.iv).toString("hex"), vector.id).toBe(
        vector.ivHex,
      );

      const parts = { verifiablReference: vector.reference, encryptedPii: encrypted.encryptedPii };
      expect(buildBarcodePayload(parts), vector.id).toBe(vector.xmpPayload);
      expect(buildScanUrl(parts), vector.id).toBe(vector.productionScanUrl);
      expect(buildScanUrl(parts, { environment: "sandbox" }), vector.id).toBe(
        vector.sandboxScanUrl,
      );
    }
  });

  it("rejects every shared malformed payload case", () => {
    for (const vector of vectors.invalidPayloads) {
      const parts = {
        verifiablReference: vector.reference,
        encryptedPii: ciphertext(vector.ciphertext),
      };
      for (const operation of vector.operations) {
        const invoke = () =>
          operation === "payload"
            ? buildBarcodePayload(parts)
            : buildScanUrl(
                parts,
                vector.scanBaseUrl === undefined ? {} : { scanBaseUrl: vector.scanBaseUrl },
              );
        expect(invoke, `${vector.id}:${operation}`).toThrow(errorPatterns[vector.expectedError]);
      }
    }
  });
});
