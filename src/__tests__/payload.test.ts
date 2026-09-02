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
  it("builds the v2 XMP payload by default", () => {
    expect(
      buildBarcodePayload({ verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT }),
    ).toBe(`2|${VERIFIABL_REF}|MZXW6YTBOJRGC6TROV4A`);
  });

  it("builds the v1 pipe format for rollback", () => {
    expect(
      buildBarcodePayload(
        { verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT },
        { format: "v1" },
      ),
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

  it("rejects non-canonical base64url before writing v2", () => {
    expect(() =>
      buildBarcodePayload({ verifiablReference: VERIFIABL_REF, encryptedPii: "Zh" }),
    ).toThrow("canonical unpadded base64url");
  });

  it("builds the v2 XMP payload from exact ciphertext bytes", () => {
    const encryptedPii = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
    expect(buildBarcodePayload({ verifiablReference: VERIFIABL_REF, encryptedPii })).toBe(
      `2|${VERIFIABL_REF}|AAAQEAYEAUDAOCAJBIFQYDIOB4IBCEQTCQKRMFYYDENBWHA5DYPQ`,
    );
  });
});

describe("buildScanUrl", () => {
  it("puts the reference in the path and the ciphertext in the fragment", () => {
    const url = buildScanUrl({ verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT });
    expect(url).toBe(`https://v.verifiabl.io/v/${VERIFIABL_REF}#2.MZXW6YTBOJRGC6TROV4A`);
  });

  // The ciphertext must never sit in a part of the URL that a client sends to a
  // server, or it lands in request logs we do not control (VER-369).
  it("keeps the ciphertext out of everything the server receives", () => {
    const url = new URL(
      buildScanUrl({ verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT }),
    );

    expect(url.pathname).not.toContain(CIPHERTEXT);
    expect(url.search).toBe("");
    expect(url.hash).toBe("#2.MZXW6YTBOJRGC6TROV4A");
  });

  // Scanners linkify only what parses as a URI. ZXing rejects any payload whose
  // characters fall outside this set, which is why the separator is "." and not
  // the wire format's "|".
  it("uses only URI-safe characters so scanners still offer tap-to-open", () => {
    const url = buildScanUrl({ verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT });

    expect(url).toMatch(/^[-._~:/?#[\]@!$&'()*+,;=%A-Za-z0-9]+$/);
  });

  it("builds the v2 short-host URL with canonical Base32", () => {
    const url = buildScanUrl({ verifiablReference: VERIFIABL_REF, encryptedPii: "Zm9vYmFy" });
    expect(url).toBe(`https://v.verifiabl.io/v/${VERIFIABL_REF}#2.MZXW6YTBOI`);
  });

  it("uses the v2 sandbox short host", () => {
    const url = buildScanUrl(
      { verifiablReference: VERIFIABL_REF, encryptedPii: "Zm9vYmFy" },
      { environment: "sandbox" },
    );
    expect(url).toBe(`https://v.sandbox.verifiabl.io/v/${VERIFIABL_REF}#2.MZXW6YTBOI`);
  });

  it("uses the sandbox scan URL when environment is sandbox", () => {
    const url = buildScanUrl(
      { verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT },
      { environment: "sandbox" },
    );
    expect(url.startsWith("https://v.sandbox.verifiabl.io/v/")).toBe(true);
  });

  it("builds the v1 long-host URL for rollback", () => {
    const url = buildScanUrl(
      { verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT },
      { format: "v1" },
    );
    expect(url).toBe(`${DEFAULT_SCAN_BASE_URL}/v/${VERIFIABL_REF}#1.${CIPHERTEXT}`);
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
