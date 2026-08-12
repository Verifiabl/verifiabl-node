import {
  buildBarcodePayload,
  buildScanUrl,
  DEFAULT_SCAN_BASE_URL,
  generateVerifiablReference,
  verifiablReferenceSchema,
} from "../payload.js";

const VERIFIABL_REF = "AbCdEfGhIjKlMnOpQrStUv"; // 22 base64url chars
const CIPHERTEXT = "Zm9vYmFyYmF6cXV4";

describe("buildBarcodePayload", () => {
  it("builds the v1 pipe format", () => {
    expect(
      buildBarcodePayload({ verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT }),
    ).toBe(`1|${VERIFIABL_REF}|${CIPHERTEXT}`);
  });

  it("rejects Verifiabl references that are not 22 chars", () => {
    expect(() =>
      buildBarcodePayload({ verifiablReference: "short", encryptedPii: CIPHERTEXT }),
    ).toThrow();
  });

  it("rejects non-base64url ciphertext", () => {
    expect(() =>
      buildBarcodePayload({ verifiablReference: VERIFIABL_REF, encryptedPii: "not+valid/" }),
    ).toThrow();
  });

  it("rejects empty ciphertext", () => {
    expect(() =>
      buildBarcodePayload({ verifiablReference: VERIFIABL_REF, encryptedPii: "" }),
    ).toThrow();
  });
});

describe("buildScanUrl", () => {
  it("puts the reference in the path and the ciphertext in the fragment", () => {
    const url = buildScanUrl({ verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT });
    expect(url).toBe(`${DEFAULT_SCAN_BASE_URL}/v/${VERIFIABL_REF}#1.${CIPHERTEXT}`);
  });

  // The ciphertext must never sit in a part of the URL that a client sends to a
  // server, or it lands in request logs we do not control (VER-369).
  it("keeps the ciphertext out of everything the server receives", () => {
    const url = new URL(
      buildScanUrl({ verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT }),
    );

    expect(url.pathname).not.toContain(CIPHERTEXT);
    expect(url.search).toBe("");
    expect(url.hash).toBe(`#1.${CIPHERTEXT}`);
  });

  // Scanners linkify only what parses as a URI. ZXing rejects any payload whose
  // characters fall outside this set, which is why the separator is "." and not
  // the wire format's "|".
  it("uses only URI-safe characters so scanners still offer tap-to-open", () => {
    const url = buildScanUrl({ verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT });

    expect(url).toMatch(/^[-._~:/?#[\]@!$&'()*+,;=%A-Za-z0-9]+$/);
  });

  it("uses the sandbox scan URL when environment is sandbox", () => {
    const url = buildScanUrl(
      { verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT },
      { environment: "sandbox" },
    );
    expect(url.startsWith("https://verify.sandbox.verifiabl.io/v/")).toBe(true);
  });

  it("accepts a custom https scan URL origin", () => {
    const url = buildScanUrl(
      { verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT },
      { scanBaseUrl: "https://scan.local.example" },
    );
    expect(url.startsWith("https://scan.local.example/v/")).toBe(true);
  });

  it("rejects http scan URL origins", () => {
    expect(() =>
      buildScanUrl(
        { verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT },
        { scanBaseUrl: "http://evil.example" },
      ),
    ).toThrow("https");
  });
});

describe("generateVerifiablReference", () => {
  it("returns a 22-char base64url string that passes the wire schema", () => {
    const reference = generateVerifiablReference();
    expect(reference).toHaveLength(22);
    expect(reference).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(() => verifiablReferenceSchema.parse(reference)).not.toThrow();
  });

  it("produces unique references across many calls (128 bits of entropy)", () => {
    // 10_000 random 128-bit strings have a collision probability around
    // 1e-31; a duplicate here means the generator is not actually random.
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      seen.add(generateVerifiablReference());
    }
    expect(seen.size).toBe(10_000);
  });
});
