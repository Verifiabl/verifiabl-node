import { buildBarcodePayload, buildScanUrl, DEFAULT_SCAN_BASE_URL } from "../payload.js";

const LT = "AbCdEfGhIjKlMnOpQrStUv"; // 22 base64url chars
const CT = "Zm9vYmFyYmF6cXV4";

describe("buildBarcodePayload", () => {
  it("builds the v1 pipe format", () => {
    expect(buildBarcodePayload({ linkingToken: LT, encryptedPii: CT })).toBe(`1|${LT}|${CT}`);
  });

  it("rejects linking tokens that are not 22 chars", () => {
    expect(() => buildBarcodePayload({ linkingToken: "short", encryptedPii: CT })).toThrow();
  });

  it("rejects non-base64url ciphertext", () => {
    expect(() => buildBarcodePayload({ linkingToken: LT, encryptedPii: "not+valid/" })).toThrow();
  });

  it("rejects empty ciphertext", () => {
    expect(() => buildBarcodePayload({ linkingToken: LT, encryptedPii: "" })).toThrow();
  });
});

describe("buildScanUrl", () => {
  it("wraps the payload in the production /v/ URL with URL encoding", () => {
    const url = buildScanUrl({ linkingToken: LT, encryptedPii: CT });
    expect(url).toBe(`${DEFAULT_SCAN_BASE_URL}/v/${encodeURIComponent(`1|${LT}|${CT}`)}`);
    expect(url).toContain("%7C"); // pipes must be encoded
  });

  it("uses the sandbox scan URL when environment is sandbox", () => {
    const url = buildScanUrl({ linkingToken: LT, encryptedPii: CT }, { environment: "sandbox" });
    expect(url.startsWith("https://verify.sandbox.verifiabl.io/v/")).toBe(true);
  });

  it("accepts a custom https scan URL origin", () => {
    const url = buildScanUrl(
      { linkingToken: LT, encryptedPii: CT },
      { scanBaseUrl: "https://scan.local.example" },
    );
    expect(url.startsWith("https://scan.local.example/v/")).toBe(true);
  });

  it("rejects http scan URL origins", () => {
    expect(() =>
      buildScanUrl({ linkingToken: LT, encryptedPii: CT }, { scanBaseUrl: "http://evil.example" }),
    ).toThrow("https");
  });
});
