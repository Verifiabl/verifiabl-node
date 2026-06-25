import { buildBarcodePayload, buildScanUrl, DEFAULT_SCAN_BASE_URL } from "../payload.js";

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
  it("wraps the payload in the production /v/ URL with URL encoding", () => {
    const url = buildScanUrl({ verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT });
    expect(url).toBe(
      `${DEFAULT_SCAN_BASE_URL}/v/${encodeURIComponent(`1|${VERIFIABL_REF}|${CIPHERTEXT}`)}`,
    );
    expect(url).toContain("%7C"); // pipes must be encoded
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
